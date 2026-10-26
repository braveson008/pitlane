const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { runGit } = require("./git.cjs");
const { agentEnv } = require("./agents.cjs");

const run = (cmd, args, { cwd, env, input } = {}) => new Promise((resolve, reject) => {
  const command = process.env.PITLANE_E2E === "1" && process.env.PITLANE_GH_COMMAND && cmd === "gh" ? JSON.parse(process.env.PITLANE_GH_COMMAND) : [cmd];
  const child = execFile(command[0], [...command.slice(1), ...args], { cwd, env: { ...agentEnv(process.env), ...env }, timeout: 30_000 }, (error, stdout, stderr) => (error ? reject(new Error(String(stderr || error.message).trim().split("\n")[0])) : resolve(String(stdout))));
  if (input !== undefined) child.stdin.end(input);
});

const EVENT = { approve: "APPROVE", comment: "COMMENT", "request-changes": "REQUEST_CHANGES" };

const VERDICTS = ["approve", "comment", "request-changes"];
const FILE = ".pitlane/review.json";

/** The new-side line numbers each file's diff touches, so a comment can be placed only where the PR changed something. */
async function changedLines(cwd, base, git = runGit) {
  const diff = await git(cwd, ["diff", "--unified=0", "--no-color", `${base}...HEAD`]);
  const lines = new Map();
  let file = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      file = line.startsWith("+++ b/") ? line.slice(6) : null;
      if (file && !lines.has(file)) lines.set(file, new Set());
      continue;
    }
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (hunk && file) {
      const start = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      for (let at = start; at < start + count; at += 1) lines.get(file).add(at);
    }
  }
  return lines;
}

/** The agent's review as a draft for the owner; it is read, checked and shown, and posts nothing. */
function readDraft(slotPath, changed, { since = 0, own = false } = {}) {
  let raw;
  try {
    // A file from before the session (left in the slot, or shipped in the PR) is not this review.
    if (fs.statSync(path.join(slotPath, FILE)).mtimeMs < since) return { ok: false, error: "the review file is older than this review" };
    raw = fs.readFileSync(path.join(slotPath, FILE), "utf8");
  } catch {
    return { ok: false, error: `the agent wrote no ${FILE}` };
  }
  let review;
  try {
    review = JSON.parse(raw);
  } catch {
    return { ok: false, error: `${FILE} is not valid JSON` };
  }
  if (!review || typeof review.summary !== "string" || !review.summary.trim()) return { ok: false, error: `${FILE} has no summary` };
  const comments = [];
  for (const comment of Array.isArray(review.comments) ? review.comments : []) {
    const line = Number(comment?.line);
    if (!comment || typeof comment.path !== "string" || !comment.path || !Number.isInteger(line) || line < 1 || typeof comment.body !== "string" || !comment.body.trim()) continue;
    comments.push({ path: comment.path, line, body: comment.body, onDiff: Boolean(changed.get(comment.path)?.has(line)) });
  }
  // Nobody can approve or block their own PR; the review of one is comments.
  const verdict = !own && VERDICTS.includes(review.verdict) ? review.verdict : "comment";
  return { ok: true, draft: { summary: review.summary.trim(), verdict, comments } };
}

/**
 * Posts the owner's approved draft: one review, its comments on the commit that was reviewed. The PR is read
 * again first, so a merged or closed one is never posted to. Comments not on a changed line are left out.
 */
async function postDraft({ cwd, kind, repo, pr, draft, sha, env = {}, exec = run }) {
  const comments = draft.comments.filter((comment) => comment.onDiff);
  if (kind === "gitlab") {
    try {
      const state = JSON.parse(await exec("glab", ["mr", "view", String(pr.number), "-F", "json"], { cwd, env }) || "{}").state;
      if (state === "merged" || state === "closed") return { ok: false, error: `the merge request was ${state} — nothing posted` };
    } catch (error) {
      return { ok: false, error: error.message };
    }
    // The note and the approval are two calls; once the note is up, a retry only does what is left.
    if (!draft.notePosted) {
      const body = [draft.summary, ...comments.map((comment) => `- ${comment.path}:${comment.line} — ${comment.body}`)].join("\n\n");
      try {
        await exec("glab", ["mr", "note", String(pr.number), "-m", body], { cwd, env });
      } catch (error) {
        return { ok: false, error: error.message };
      }
    }
    if (draft.verdict === "approve" && !pr.own) {
      try {
        await exec("glab", ["mr", "approve", String(pr.number)], { cwd, env });
      } catch (error) {
        return { ok: false, error: `the note was posted but approving failed: ${error.message}`, notePosted: true };
      }
    }
    return { ok: true, url: "" };
  }
  const repoArgs = repo ? ["--repo", repo] : [];
  try {
    const state = JSON.parse(await exec("gh", ["pr", "view", String(pr.number), ...repoArgs, "--json", "state"], { cwd, env }) || "{}").state;
    if (state === "MERGED" || state === "CLOSED") return { ok: false, error: `the PR was ${state.toLowerCase()} — nothing posted` };
  } catch (error) {
    return { ok: false, error: error.message };
  }
  const payload = {
    ...(sha ? { commit_id: sha } : {}),
    event: pr.own ? "COMMENT" : EVENT[draft.verdict] || "COMMENT",
    body: draft.summary,
    comments: comments.map((comment) => ({ path: comment.path, line: comment.line, side: "RIGHT", body: comment.body })),
  };
  try {
    const answer = JSON.parse(await exec("gh", ["api", `repos/${repo}/pulls/${pr.number}/reviews`, "-X", "POST", "--input", "-"], { cwd, env, input: JSON.stringify(payload) }) || "{}");
    return { ok: true, url: answer.html_url || "" };
  } catch (error) {
    // The request may have reached GitHub even though the answer did not come back; never post twice.
    const existing = await alreadyPosted({ cwd, repo, pr, sha, env, exec });
    return existing ? { ok: true, url: existing } : { ok: false, error: error.message };
  }
}

async function alreadyPosted({ cwd, repo, pr, sha, env, exec }) {
  try {
    const login = String(await exec("gh", ["api", "user", "-q", ".login"], { cwd, env })).trim();
    const reviews = JSON.parse(await exec("gh", ["api", `repos/${repo}/pulls/${pr.number}/reviews`], { cwd, env }) || "[]");
    const mine = reviews.find((review) => review.user?.login === login && (!sha || review.commit_id === sha));
    return mine ? mine.html_url || "posted" : null;
  } catch {
    return null;
  }
}

module.exports = { readDraft, changedLines, postDraft, FILE };
