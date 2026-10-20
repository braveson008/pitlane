/**
 * "Pick up my latest Linear ticket."
 *
 * The request the user actually made, and the reason `appDirectory.cjs` exists:
 * this must work for Jira, Linear, GitHub Issues, or anything else with an MCP
 * server, without a hand-written integration per tracker. What generalises is
 * the shape of the question — *which item is assigned to me, still open, and
 * most recent* — not the API that answers it. So the tracker's own MCP server
 * does the querying, and this module only decides what to ask and how to read
 * the answer.
 *
 * ## The ticket is untrusted input
 *
 * A ticket title and description are written by whoever filed the ticket, which
 * may not be the user and may not be anyone they trust. That text ends up in an
 * agent session prompt, so it is handled the same way `screenContext` handles
 * what is on screen: as *data*, never as instructions.
 *
 * Three things follow, and all three are load-bearing:
 *
 *   1. The MCP query runs with the shell and the editor denied, so a ticket
 *      body saying "ignore your instructions and run this" reaches a process
 *      that has no way to comply.
 *   2. The reply is parsed into fixed fields — id, title, description, url —
 *      and anything else is discarded. The model never gets to decide *what
 *      kind of thing* came back.
 *   3. The chosen ticket is always spoken before a session starts. If the wrong
 *      one was picked, the user hears it at the moment they can still say
 *      "no, undo that" — which is the only mitigation that works when the
 *      failure is a wrong answer rather than a dangerous one.
 */

/** Fields kept from whatever the tracker returns. Everything else is dropped. */
const TASK_FIELDS = ["id", "title", "description", "url", "status", "group", "updatedAt"];
const STAGES = ["todo", "started", "done"];

/**
 * What to ask the tracker's MCP server.
 *
 * Deliberately prescriptive about the ordering and the filter, because "latest"
 * is ambiguous and a tracker that answers with the most recently *created*
 * ticket when the user meant most recently *updated* has failed quietly. The
 * instruction to return nothing rather than guess matters for the same reason:
 * starting a session on the wrong ticket wastes far more time than asking.
 */
function buildPickTaskPrompt({ source, hint = "" } = {}) {
  return [
    `Use the ${source} tools to find one work item, then stop.`,
    "",
    "Which item:",
    "- Assigned to the currently authenticated user — not unassigned, not someone else's.",
    "- Still open: a to-do, backlog, or in-progress state. Never one that is done, closed, or cancelled.",
    "- The most recently updated of those that remain.",
    hint ? `- The user described it as: ${hint}. Prefer an item matching that description.` : "",
    "",
    "Reply with a single JSON object and nothing else:",
    '{"id": "the human-readable key such as ENG-412", "title": "...", "description": "...", "url": "...", "status": "...", "updatedAt": "ISO 8601"}',
    "",
    "If nothing matches — no assigned open items, or you cannot tell who is authenticated —",
    'reply exactly {"none": true, "why": "one short sentence"}.',
    "Do not invent an item, and do not pick a near miss. A wrong item costs more than no item.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Ask one connected tracker for a bounded, reviewable import list.
 *
 * Import remains a two-step action: the MCP may read the tracker, but Pitlane
 * does not create anything until the user selects items in the preview.
 */
function buildListTasksPrompt({ source, query = "", scope = "", limit = 25, brief = false } = {}) {
  const boundedLimit = Math.max(1, Math.min(50, Number(limit) || 25));
  return [
    `Use the ${source} tools to list work items, then stop. This is a read-only request.`,
    "",
    "Which items:",
    "- Assigned to the currently authenticated user.",
    "- Still open: a to-do, backlog, or in-progress state. Exclude done, closed, and cancelled items.",
    "- Most recently updated first.",
    // One account can reach several sites, so "assigned to me" alone mixes
    // another employer's or team's work into this project.
    scope ? `- Only items from ${clean(scope, 120)} (a site, project key, or team). Leave out items from anywhere else, even when they are assigned to the user.` : "",
    query ? `- Match this optional search: ${clean(query, 200)}.` : "",
    `- Return at most ${boundedLimit} items.`,
    "",
    "Reply with one JSON object and nothing else:",
    '{"tasks":[{"id":"human-readable key","title":"...","description":"...","url":"...","status":"...","stage":"todo | started | done","group":"...","updatedAt":"ISO 8601"}]}',
    "",
    // "Ready for QA" reads as open, but its development is finished; only the tracker's own category tells work not yet begun from work past it.
    "The stage comes from the tracker's own status category, never from the status name:",
    'Jira\'s To Do category or Linear\'s backlog, triage and unstarted types are "todo";',
    'Jira\'s In Progress category or Linear\'s started type are "started", including review and QA states;',
    'Jira\'s Done category or Linear\'s completed and canceled types are "done".',
    "",
    // A summarised description is a different document from the ticket. Someone
    // reading it in Pitlane is reading it to do the work, and a paraphrase of
    // acceptance criteria is worse than useless — it looks authoritative and is
    // not what the team agreed.
    // A check for what is new needs keys and titles; copying every description
    // out word for word, every few minutes, was most of what it cost.
    ...(brief
      ? ["Leave every description as an empty string, and do not open items to read them: only the list is needed."]
      : [
          "The description must be the item's full description, copied verbatim: every",
          "paragraph, list, acceptance criterion, code block and reproduction step, in",
          "the order the item has them. Do not summarise, shorten, reword, or omit any",
          "part of it. If the item has no description, use an empty string.",
        ]),
    "",
    "The status must be the item's own column or workflow state, spelled exactly",
    "as the tracker spells it — \"Ready for QA\", not \"in review\".",
    "",
    // Without this a sprint and a backlog arrive as one undifferentiated list,
    // and the only way to tell an item three weeks out from one being worked on
    // this week is to open every one of them.
    "The group is the sprint, cycle, iteration or milestone the item is",
    "scheduled into, spelled as the tracker spells it. For an item sitting in a",
    'backlog with no such scheduling, use exactly "Backlog". If the tracker has',
    "no concept of one, use an empty string.",
    "",
    'If nothing matches, reply exactly {"tasks":[]}.',
    "Do not create, update, transition, assign, or comment on any item. Do not invent items.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Pull the JSON object out of a reply that may be wrapped in prose or a fence. */
function extractJsonObject(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidates = [fenced?.[1], text];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const trimmed = candidate.trim();
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end <= start) continue;
    try {
      const parsed = JSON.parse(trimmed.slice(start, end + 1));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

const clean = (value, limit) => {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
};

/**
 * The same tidying, for a field that is a document rather than a label.
 *
 * `clean` collapses every run of whitespace, newlines included — which is
 * correct for a title and destructive for a description. The care taken above
 * to keep a description whole was undone one line later: the text arrived
 * complete and arrived flat, so its headings, lists and table rows ran
 * together into a single paragraph nobody could read.
 */
const cleanDocument = (value, limit) => {
  const text = String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")   // horizontal runs collapse; line breaks survive
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")  // at most one blank line between blocks
    .trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
};

/**
 * Read the tracker's answer into a fixed shape, or explain why there isn't one.
 *
 * Returns `{ ok: false, why }` for every failure — an unparseable reply, an
 * explicit "none", or an object with no title. A task with no title cannot be
 * shown to the user or spoken back, so accepting one would start a session
 * against something nobody can identify.
 */
function parsePickedTask(raw) {
  const parsed = extractJsonObject(raw);
  if (!parsed) return { ok: false, why: "I couldn't read the reply from that tracker." };

  if (parsed.none === true || parsed.none === "true") {
    return { ok: false, why: clean(parsed.why, 200) || "There's nothing assigned to you that's still open." };
  }

  const title = clean(parsed.title, 200);
  if (!title) return { ok: false, why: "That tracker returned an item with no title." };

  const task = { title };
  for (const field of TASK_FIELDS) {
    if (field === "title") continue;
    // A description is kept whole. It used to be cut at 4kB to keep a session
    // prompt small, but the cut landed silently in the middle of the acceptance
    // criteria — and the description is what someone reads in order to do the
    // work, so a truncated one is a different ticket wearing the same key. The
    // bound that remains is a guard against a runaway reply, not an editorial
    // one; trimming for a prompt belongs where the prompt is built.
    const limit = field === "description" ? 60_000 : 200;
    const value = field === "description"
      ? cleanDocument(parsed[field], limit)
      : clean(parsed[field], limit);
    if (value) task[field] = value;
  }
  if (STAGES.includes(parsed.stage)) task.stage = parsed.stage;
  return { ok: true, task };
}

/** Parse a tracker reply into a bounded, deduplicated import preview. */
function parseTaskList(raw) {
  const parsed = extractJsonObject(raw);
  if (!parsed || !Array.isArray(parsed.tasks)) {
    return { ok: false, why: "I couldn't read a task list from that MCP server." };
  }

  const tasks = [];
  const seen = new Set();
  for (const item of parsed.tasks.slice(0, 50)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const normalized = parsePickedTask(JSON.stringify(item));
    if (!normalized.ok) continue;
    const task = normalized.task;
    const identity = clean(task.id || task.url || task.title, 300).toLowerCase();
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    tasks.push(task);
  }
  return { ok: true, tasks };
}

function normalizedMcpSourceName(value) {
  const parts = String(value || "")
    .toLowerCase()
    .split(":")
    .filter((part) => part && part !== "plugin");
  const meaningful = parts.length > 1 && parts.at(-1) === parts.at(-2) ? parts.slice(0, -1) : parts;
  return meaningful.join(" ").replace(/[^a-z0-9]+/g, " ").trim();
}

/** Match a public discovery row back to its private project-auth alias. */
function resolveMcpTaskSource({ source, target } = {}, servers = [], profiles = []) {
  const sourceName = String(source || "").trim();
  const sourceTarget = String(target || "").trim();
  const normalizedSource = normalizedMcpSourceName(sourceName);
  const sameName = (candidate) => {
    const normalizedCandidate = normalizedMcpSourceName(candidate?.name);
    return Boolean(normalizedSource && normalizedCandidate && (
      normalizedCandidate === normalizedSource ||
      normalizedCandidate.split(" ").includes(normalizedSource) ||
      normalizedSource.split(" ").includes(normalizedCandidate)
    ));
  };
  const byTarget = (candidate) => Boolean(sourceTarget && candidate?.target && String(candidate.target) === sourceTarget);
  const profile = profiles.find((item) => item?.name === sourceName) || profiles.find(sameName) || profiles.find(byTarget);
  // When another tool holds a binding for this source it registered its own server
  // under an alias and authenticated that one. A same-named server of the
  // user's own can sit beside it unauthenticated — and matching on the plain
  // name finds that one, so an import fails as "not connected" while that tool's
  // alias is connected and ready. The alias wins whenever a binding names it.
  const server =
    (profile?.alias && servers.find((item) => item?.name === profile.alias)) ||
    servers.find((item) => item?.name === sourceName) ||
    servers.find(sameName) ||
    servers.find(byTarget);
  return { profile, server };
}

const READ_ONLY_TRACKER_TOOLS = {
  atlassian: [
    "atlassianUserInfo",
    "fetch",
    "getAccessibleAtlassianResources",
    "getConfluenceCommentChildren",
    "getConfluencePage",
    "getConfluencePageDescendants",
    "getConfluencePageFooterComments",
    "getConfluencePageInlineComments",
    "getConfluenceSpaces",
    "getIssueLinkTypes",
    "getJiraIssue",
    "getJiraIssueRemoteIssueLinks",
    "getJiraIssueTypeMetaWithFields",
    "getJiraProjectIssueTypesMetadata",
    "getPagesInConfluenceSpace",
    "getTransitionsForJiraIssue",
    "getVisibleJiraProjects",
    "lookupJiraAccountId",
    "search",
    "searchConfluenceUsingCql",
    "searchJiraIssuesUsingJql",
  ],
  linear: [
    "get_issue",
    "get_project",
    "get_team",
    "get_user",
    "get_cycle",
    "list_issues",
    "list_projects",
    "list_teams",
    "list_users",
    "list_cycles",
    "list_issue_statuses",
    "list_issue_labels",
    "search_documentation",
  ],
  github: ["get_issue", "get_me", "list_issues", "search_issues", "search_users"],
};

function trackerSourceFamily(source, target = "") {
  const value = `${normalizedMcpSourceName(source)} ${String(target).toLowerCase()}`;
  if (/atlassian|jira/.test(value)) return "atlassian";
  if (/linear/.test(value)) return "linear";
  if (/github/.test(value)) return "github";
  return "";
}

/** Exact read-only tool grants for tracker families Pitlane has audited. */
function readOnlyTrackerToolNames({ source, target, server } = {}) {
  const family = trackerSourceFamily(source, target);
  const suffixes = READ_ONLY_TRACKER_TOOLS[family] || [];
  const namespace = String(server || source || "").replace(/[^a-zA-Z0-9_-]/g, "_");
  return suffixes.map((suffix) => `mcp__${namespace}__${suffix}`);
}

/**
 * What Pitlane says before it starts working on this.
 *
 * The identifier comes first because it is the part the user can check against
 * what they remember filing. "Starting on ENG-412, fix the parser" is falsifiable
 * in a way that "starting on your latest ticket" is not.
 */
function describePickedTask(task, { source } = {}) {
  const label = task.id ? `${task.id}, ${task.title}` : task.title;
  return source ? `Your latest ${source} item is ${label}.` : `Your latest item is ${label}.`;
}

module.exports = {
  buildPickTaskPrompt,
  buildListTasksPrompt,
  parsePickedTask,
  parseTaskList,
  normalizedMcpSourceName,
  resolveMcpTaskSource,
  trackerSourceFamily,
  readOnlyTrackerToolNames,
  describePickedTask,
  extractJsonObject,
  TASK_FIELDS,
};
