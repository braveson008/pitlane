const { execFile } = require("node:child_process");
const { agentEnv } = require("./agents.cjs");

const run = (cmd, args) => new Promise((resolve, reject) => {
  execFile(cmd, args, { env: agentEnv(process.env), timeout: 15_000 }, (error, stdout) => (error ? reject(error) : resolve(String(stdout))));
});

/**
 * The project's own GitHub or GitLab account for one agent, through the environment only.
 * `gh auth switch` would change the account for every terminal on the machine, and the token is never written anywhere.
 */
async function credentialEnv(project, { exec = run } = {}) {
  const account = project?.github;
  if (!account) return project?.signInNeeded ? { env: {}, warning: "no GitHub login" } : { env: {} };
  const token = await exec("gh", ["auth", "token", "--hostname", account.host, "--user", account.login]).then((out) => out.trim(), () => "");
  if (!token) return { env: {}, warning: "no GitHub login" };
  const gitlab = account.kind === "gitlab";
  const variable = gitlab ? "GITLAB_TOKEN" : "GH_TOKEN";
  const key = `credential.https://${account.host}.helper`;
  return {
    env: {
      [variable]: token,
      GIT_CONFIG_COUNT: "2",
      // An empty helper resets the list: otherwise the system keychain helper is asked first,
      // answers with the owner's personal account, and stores the project token for every terminal.
      GIT_CONFIG_KEY_0: key,
      GIT_CONFIG_VALUE_0: "",
      GIT_CONFIG_KEY_1: key,
      GIT_CONFIG_VALUE_1: `!f(){ echo username=${gitlab ? "oauth2" : "x-access-token"}; echo password=$${variable}; }; f`,
    },
  };
}

/**
 * The environment of an agent reviewing someone else's PR: it reads code and writes a draft, and needs no access
 * to the host. No tokens, empty gh/glab config, no credential helper, no SSH, and origin's push URL points nowhere,
 * so neither a crafted diff nor the PR's own scripts can push or post as the owner.
 */
function reviewerEnv({ emptyDir }) {
  return {
    GH_TOKEN: "",
    GITHUB_TOKEN: "",
    GITLAB_TOKEN: "",
    GH_CONFIG_DIR: emptyDir,
    GLAB_CONFIG_DIR: emptyDir,
    GIT_SSH_COMMAND: "false",
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "credential.helper",
    GIT_CONFIG_VALUE_0: "",
    GIT_CONFIG_KEY_1: "remote.origin.pushurl",
    GIT_CONFIG_VALUE_1: "disabled://pitlane-review",
  };
}

module.exports = { credentialEnv, reviewerEnv };
