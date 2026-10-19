const { runGit } = require("./git.cjs");

const CONVENTION = /^(feature|fix|bugfix|chore)\/[A-Za-z][A-Za-z0-9]*-\d+-/;

function ticketSlug(title) {
  return String(title || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

const safeKey = (key) => String(key).replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "ticket";

/** A branch name in the repository's own style: `feature/KEY-title` when its branches look like that, `key-title` otherwise. */
function ticketBranch({ key, title, remoteBranches = [] }) {
  const slug = ticketSlug(title);
  const counts = new Map();
  for (const branch of remoteBranches) {
    const match = branch.match(CONVENTION);
    if (match) counts.set(match[1], (counts.get(match[1]) || 0) + 1);
  }
  const [prefix, uses] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] || [];
  const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
  if (prefix && total >= 2 && uses >= 1) return `${prefix}/${safeKey(key)}${slug ? `-${slug}` : ""}`;
  return `${safeKey(key).toLowerCase()}${slug ? `-${slug}` : ""}`;
}

/** A remote branch already made for this ticket, so it is continued instead of a second one being started. */
function adoptableBranch({ key, remoteBranches = [] }) {
  const escaped = safeKey(key).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const whole = new RegExp(`(^|[/_-])${escaped}(?![0-9])`, "i");
  return remoteBranches.find((branch) => whole.test(branch)) || null;
}

async function remoteBranches(cwd, git = runGit) {
  const out = await git(cwd, ["ls-remote", "--heads", "origin"], { timeout: 20_000 }).catch(() => "");
  return out.split("\n").map((line) => line.split("\trefs/heads/")[1]).filter(Boolean);
}

module.exports = { ticketBranch, adoptableBranch, ticketSlug, remoteBranches };
