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

// Focus reports, device attributes, cursor position and colour answers: xterm sends these itself.
const REPLIES = [/^\x1b\[[IO]$/, /^\x1b\[\?[\d;]*c$/, /^\x1b\[>[\d;]*c$/, /^\x1b\[\d+;\d+R$/, /^\x1b\][\d;]*[^\x07\x1b]*(\x07|\x1b\\)$/];

/** Data the terminal wrote by itself, which must not count as the owner answering the agent. */
function isTerminalReply(data) {
  return REPLIES.some((reply) => reply.test(String(data)));
}

module.exports = { afterTurn, usageLimitHit, isTerminalReply };
