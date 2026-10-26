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

const asTask = ({ number, title, url, author, trusted, own, head }) => ({
  id: `review:${number}`,
  title,
  url,
  description: "",
  status: "",
  group: "",
  updatedAt: "",
  pr: { number, author, trusted, ...(own ? { own: true, head } : {}) },
});

/** Requested reviews first, then the owner's own PRs not already listed and not on a branch one of Pitlane's tickets owns. */
function withOwn(requested, own, skipBranches) {
  const listed = new Set(requested.map((task) => task.pr.number));
  return [...requested, ...own.filter((task) => !listed.has(task.pr.number) && !skipBranches.has(task.pr.head))];
}

/** Open PRs in this repository where the owner is a requested reviewer, or the author, as queue items keyed `review:<n>`. */
async function findReviewRequests({ cwd, kind, env = {}, exec = run, skipBranches = new Set() }) {
  try {
    const remote = await exec("git", ["remote", "get-url", "origin"], { cwd, env });
    if (kind === "gitlab") {
      const list = JSON.parse(await exec("glab", ["mr", "list", "--reviewer=@me", "-F", "json"], { cwd, env }) || "[]");
      // glab's list has no author association; a project's merge requests come from its members.
      const mine = JSON.parse(await exec("glab", ["mr", "list", "--author=@me", "-F", "json"], { cwd, env }) || "[]");
      return {
        ok: true,
        tasks: withOwn(
          list.map((mr) => asTask({ number: mr.iid, title: mr.title, url: mr.web_url, author: mr.author?.username, trusted: true })),
          mine.map((mr) => asTask({ number: mr.iid, title: mr.title, url: mr.web_url, author: mr.author?.username, trusted: true, own: true, head: mr.source_branch })),
          skipBranches,
        ),
      };
    }
    const slug = repoSlug(remote);
    if (!slug) return { ok: false, error: "the origin remote is not a GitHub repository" };
    const list = JSON.parse(await exec("gh", ["search", "prs", "--review-requested=@me", "--state=open", "--repo", slug, "--json", "number,title,url,author,authorAssociation", "--limit", "30"], { cwd, env }) || "[]");
    // `gh search prs` has no branch names; `gh pr list` does, and the owner's own PRs need theirs.
    const mine = JSON.parse(await exec("gh", ["pr", "list", "--author", "@me", "--state", "open", "--repo", slug, "--json", "number,title,url,author,headRefName", "--limit", "30"], { cwd, env }) || "[]");
    return {
      ok: true,
      tasks: withOwn(
        list.map((pr) => asTask({ number: pr.number, title: pr.title, url: pr.url, author: pr.author?.login, trusted: TRUSTED.has(pr.authorAssociation) })),
        mine.map((pr) => asTask({ number: pr.number, title: pr.title, url: pr.url, author: pr.author?.login, trusted: true, own: true, head: pr.headRefName })),
        skipBranches,
      ),
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

module.exports = { findReviewRequests, repoSlug };
