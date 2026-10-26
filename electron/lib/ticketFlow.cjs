const ANSI = /\x1b\[[0-9;?<>=]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

// The CLIs' own words when the account's limit is hit; ordinary work about rate limits must not match.
const LIMIT_BANNERS = [/usage limit reached/i, /you've hit your usage limit/i, /\b\d+-hour limit reached/i, /weekly limit reached/i];

/** Whether the last lines the agent printed are a usage-limit banner. */
function usageLimitHit(output) {
  const tail = String(output).replace(ANSI, "").slice(-600);
  return LIMIT_BANNERS.some((banner) => banner.test(tail));
}

/**
 * What the end of one of the agent's turns means for its ticket. Agents sit at their prompt when done rather
 * than exiting, so a finished turn with an open PR is the end of the ticket's work: the session is ended so
 * its workspace and its place under the agent cap are given back. A PR is looked at before any banner.
 */
function afterTurn({ pr, tail }) {
  if (pr?.url && pr.state === "open") return { state: "in-review", prUrl: pr.url, end: true };
  if (pr?.url) return { state: "done", prUrl: pr.url, end: true };
  if (usageLimitHit(tail)) return { pause: true };
  return null;
}

/** Whether a queued ticket goes to the lead agent; otherwise it is planned first. Work under way before plans existed carries on. */
function wantsWork(ticket) {
  return Boolean(ticket.approved || ticket.priority === "feedback" || ticket.branch);
}

/** What the end of a planning turn means: a plan is ready for the owner, or the limit was hit before one was written. */
function afterPlanTurn({ planned, tail }) {
  if (planned) return { state: "plan-ready" };
  if (usageLimitHit(tail)) return { pause: true };
  return null;
}

/** Whether a planning session's plan still belongs to its ticket: still planning, or waiting on the owner after the planner asked. */
function ownsPlan(ticket, sessionId) {
  return Boolean(ticket && ticket.sessionId === sessionId && (ticket.state === "planning" || ticket.state === "needs-you"));
}

/** What a ticket the last run left mid-flight becomes: work needs the owner; a plan is simply made again. */
function afterRestart(ticket) {
  if (ticket.state === "working") return { state: "needs-you", reason: "Pitlane was closed while it worked" };
  if (ticket.state === "planning") return { state: "queued", sessionId: undefined };
  return null;
}

// Focus reports, device attributes, cursor position and colour answers: xterm sends these itself.
const REPLIES = [/^\x1b\[[IO]$/, /^\x1b\[\?[\d;]*c$/, /^\x1b\[>[\d;]*c$/, /^\x1b\[\d+;\d+R$/, /^\x1b\][\d;]*[^\x07\x1b]*(\x07|\x1b\\)$/];

/** Data the terminal wrote by itself, which must not count as the owner answering the agent. */
function isTerminalReply(data) {
  return REPLIES.some((reply) => reply.test(String(data)));
}

module.exports = { afterTurn, afterPlanTurn, wantsWork, ownsPlan, afterRestart, usageLimitHit, isTerminalReply };
