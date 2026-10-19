const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const AGENTS = {
  claude: { label: "claude", command: "claude", args: [] },
  codex: { label: "codex", command: "codex", args: [] },
};

// An app started from the Dock gets launchd's short PATH, without the folders CLIs install into.
const USUAL_BIN_DIRS = [path.join(os.homedir(), ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin"];

function isExecutable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function resolveCommand(agentId, env = process.env, extraDirs = USUAL_BIN_DIRS) {
  const agent = AGENTS[agentId];
  if (!agent) return { error: `Unknown agent: ${agentId}` };
  if (env.PITLANE_E2E === "1" && env.PITLANE_AGENT_COMMAND) {
    const [command, ...args] = JSON.parse(env.PITLANE_AGENT_COMMAND);
    return { command, args };
  }
  const dirs = [...String(env.PATH || "").split(path.delimiter).filter(Boolean), ...extraDirs];
  for (const dir of dirs) {
    const candidate = path.join(dir, agent.command);
    if (isExecutable(candidate)) return { command: candidate, args: agent.args.slice() };
  }
  return { error: `${agent.command} was not found on PATH` };
}

/** The agent's environment, with the usual bin folders on PATH so `#!/usr/bin/env node` CLIs run from a Dock launch. */
function agentEnv(env = process.env, extraDirs = USUAL_BIN_DIRS) {
  const dirs = String(env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const dir of extraDirs) if (!dirs.includes(dir)) dirs.push(dir);
  const clean = { ...env, PATH: dirs.join(path.delimiter) };
  // Claude marks its own child processes; an agent inheriting that from a Claude-launched Pitlane
  // would run as a child session, with transcripts (and so resuming) turned off.
  // Only the session markers: other CLAUDE_CODE_* variables are settings the owner chose (Bedrock, output limits).
  for (const key of ["CLAUDECODE", "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_SSE_PORT"]) delete clean[key];
  return clean;
}

module.exports = { AGENTS, USUAL_BIN_DIRS, agentEnv, resolveCommand };
