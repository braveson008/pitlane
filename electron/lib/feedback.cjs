const { execFile } = require("node:child_process");
const { agentEnv } = require("./agents.cjs");

const run = (cmd, args, { cwd, env } = {}) => new Promise((resolve, reject) => {
  const command = process.env.PITLANE_E2E === "1" && process.env.PITLANE_GH_COMMAND && cmd === "gh" ? JSON.parse(process.env.PITLANE_GH_COMMAND) : [cmd];
  execFile(command[0], [...command.slice(1), ...args], { cwd, env: { ...agentEnv(process.env), ...env }, timeout: 30_000 }, (error, stdout, stderr) => (error ? reject(new Error(String(stderr || error.message).trim().split("\n")[0])) : resolve(String(stdout))));
});

const FAILED = new Set(["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED"]);
const newer = (iso, since) => Date.parse(iso || "") > since;
const TEAM = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
// An unattended agent acts on what it is told, so only the team's words reach it: no bots, no passers-by.
const heard = (login, association, owner, isBot) => Boolean(login) && login !== owner && !isBot && !login.endsWith("[bot]") && TEAM.has(String(association || "").toUpperCase());

/**
 * What reviewers and CI have said on one of Pitlane's PRs since `since`: changes requested, comments by anyone
 * but the owner, and failing checks. The owner's own comments are notes, not instructions for an unattended agent.
 */
async function readFeedback({ cwd, url, since, owner, env = {}, exec = run }) {
  const checkedAt = Date.now();
  let pr;
  try {
    pr = JSON.parse(await exec("gh", ["pr", "view", url, "--json", "reviewDecision,reviews,comments,statusCheckRollup"], { cwd, env }) || "{}");
  } catch {
    return { trigger: false, text: "", checkedAt: since };
  }
  const lines = [];
  for (const review of pr.reviews || []) {
    const author = review.author?.login;
    if (!heard(author, review.authorAssociation, owner) || !newer(review.submittedAt, since)) continue;
    if (review.state === "CHANGES_REQUESTED") lines.push(`${author} requested changes: ${String(review.body || "").trim() || "(no text)"}`);
    else if (review.body?.trim()) lines.push(`${author} commented: ${review.body.trim()}`);
  }
  for (const comment of pr.comments || []) {
    const author = comment.author?.login;
    if (!heard(author, comment.authorAssociation, owner) || !newer(comment.createdAt, since) || !comment.body?.trim()) continue;
    lines.push(`${author} commented: ${comment.body.trim()}`);
  }
  const where = /github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(String(url));
  if (where) {
    let inline = [];
    try {
      inline = JSON.parse(await exec("gh", ["api", `repos/${where[1]}/pulls/${where[2]}/comments?per_page=100`], { cwd, env }) || "[]");
    } catch {}
    for (const comment of Array.isArray(inline) ? inline : []) {
      const author = comment.user?.login;
      if (!heard(author, comment.author_association, owner, comment.user?.type === "Bot") || !newer(comment.created_at, since) || !comment.body?.trim()) continue;
      lines.push(`${author} on ${comment.path}:${comment.line ?? comment.original_line ?? "?"}: ${comment.body.trim()}`);
    }
  }
  for (const check of pr.statusCheckRollup || []) {
    // A failure from before the last look is the one the agent was already told about (or is fixing now).
    if (check.completedAt && !newer(check.completedAt, since)) continue;
    if (FAILED.has(String(check.conclusion || check.state || "").toUpperCase())) lines.push(`Failing check: ${check.name || check.context || "unnamed"}`);
  }
  return { trigger: lines.length > 0, text: lines.join("\n\n"), checkedAt };
}

/** The owner's login on GitHub, so their own comments on Pitlane's PRs are not taken as feedback. */
async function githubLogin({ env = {}, exec = run } = {}) {
  try {
    return String(await exec("gh", ["api", "user", "-q", ".login"], { env })).trim() || null;
  } catch {
    return null;
  }
}

module.exports = { readFeedback, githubLogin };
