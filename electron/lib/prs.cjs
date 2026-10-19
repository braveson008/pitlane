const { execFile } = require("node:child_process");
const { agentEnv } = require("./agents.cjs");

const run = (cmd, args, { cwd, env }) => new Promise((resolve, reject) => {
  const command = process.env.PITLANE_E2E === "1" && process.env.PITLANE_GH_COMMAND && cmd === "gh" ? JSON.parse(process.env.PITLANE_GH_COMMAND) : [cmd];
  execFile(command[0], [...command.slice(1), ...args], { cwd, env: { ...agentEnv(process.env), ...env }, timeout: 30_000 }, (error, stdout) => (error ? reject(error) : resolve(String(stdout))));
});

const STATE = { open: "open", opened: "open", merged: "merged", closed: "closed" };

/** The pull or merge request for a branch, so a ticket can follow it to review and to done. */
async function prForBranch({ cwd, branch, kind, env = {}, exec = run }) {
  const gitlab = kind === "gitlab";
  const cmd = gitlab ? "glab" : "gh";
  const args = gitlab
    ? ["mr", "list", "--source-branch", branch, "--all", "-F", "json"]
    : ["pr", "list", "--head", branch, "--state", "all", "--json", "url,state", "--limit", "1"];
  let out;
  try {
    out = await exec(cmd, args, { cwd, env });
  } catch (error) {
    return { error: error.code === "ENOENT" ? `${cmd} is not installed` : String(error.message).split("\n")[0] };
  }
  let list;
  try {
    list = JSON.parse(out || "[]");
  } catch {
    return { error: `${cmd} gave an answer that could not be read` };
  }
  const first = Array.isArray(list) ? list[0] : null;
  if (!first) return null;
  const state = STATE[String(first.state || "").toLowerCase()];
  return state ? { url: first.url || first.web_url, state } : null;
}

/** Every recent PR of the project by branch, in one call, so following many tickets costs one request. */
async function prsForProject({ cwd, kind, env = {}, exec = run }) {
  const gitlab = kind === "gitlab";
  const cmd = gitlab ? "glab" : "gh";
  const args = gitlab ? ["mr", "list", "--all", "-F", "json"] : ["pr", "list", "--state", "all", "--json", "headRefName,url,state", "--limit", "100"];
  const map = new Map();
  let list;
  try {
    list = JSON.parse((await exec(cmd, args, { cwd, env })) || "[]");
  } catch {
    return map;
  }
  for (const item of Array.isArray(list) ? list : []) {
    const branch = item.headRefName || item.source_branch;
    const state = STATE[String(item.state || "").toLowerCase()];
    if (branch && state && !map.has(branch)) map.set(branch, { url: item.url || item.web_url, state });
  }
  return map;
}

module.exports = { prForBranch, prsForProject };
