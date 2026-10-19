const { execFile } = require("node:child_process");
const { agentEnv } = require("./agents.cjs");

const run = (cmd, args, { cwd, env }) => new Promise((resolve, reject) => {
  const command = process.env.PITLANE_E2E === "1" && process.env.PITLANE_GH_COMMAND && cmd === "gh" ? JSON.parse(process.env.PITLANE_GH_COMMAND) : [cmd];
  execFile(command[0], [...command.slice(1), ...args], { cwd, env: { ...agentEnv(process.env), ...env }, timeout: 30_000 }, (error, stdout, stderr) => (error ? reject(new Error(String(stderr || error.message).trim().split("\n")[0])) : resolve(String(stdout))));
});

function repoSlug(remoteUrl) {
  const match = String(remoteUrl).trim().match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?\/?$/);
  return match ? match[1] : null;
}

// Only people with a hand in the repository get an unattended review; anyone else's PR waits for the owner.
const TRUSTED = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

const asTask = ({ number, title, url, author, trusted }) => ({
  id: `review:${number}`,
  title,
  url,
  description: "",
  status: "",
  group: "",
  updatedAt: "",
  pr: { number, author, trusted },
});

/** Open PRs in this repository where the owner is a requested reviewer, as queue items keyed `review:<n>`. */
async function findReviewRequests({ cwd, kind, env = {}, exec = run }) {
  try {
    const remote = await exec("git", ["remote", "get-url", "origin"], { cwd, env });
    if (kind === "gitlab") {
      const list = JSON.parse(await exec("glab", ["mr", "list", "--reviewer=@me", "-F", "json"], { cwd, env }) || "[]");
      // glab's list has no author association; a project's merge requests come from its members.
      return { ok: true, tasks: list.map((mr) => asTask({ number: mr.iid, title: mr.title, url: mr.web_url, author: mr.author?.username, trusted: true })) };
    }
    const slug = repoSlug(remote);
    if (!slug) return { ok: false, error: "the origin remote is not a GitHub repository" };
    const list = JSON.parse(await exec("gh", ["search", "prs", "--review-requested=@me", "--state=open", "--repo", slug, "--json", "number,title,url,author,authorAssociation", "--limit", "30"], { cwd, env }) || "[]");
    return { ok: true, tasks: list.map((pr) => asTask({ number: pr.number, title: pr.title, url: pr.url, author: pr.author?.login, trusted: TRUSTED.has(pr.authorAssociation) })) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

module.exports = { findReviewRequests, repoSlug };
