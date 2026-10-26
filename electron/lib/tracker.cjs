const { spawn } = require("node:child_process");
const { agentEnv, resolveCommand } = require("./agents.cjs");
const { buildListTasksPrompt, parseTaskList, readOnlyTrackerToolNames, trackerSourceFamily } = require("./trackerTasks.cjs");

// Reading someone else's words (a ticket) must not be able to act or reach the network, so every tool but the
// tracker's audited read-only ones is denied by how the process runs, not by asking it nicely.
const DENIED = ["Bash", "Edit", "Write", "NotebookEdit", "Read", "Glob", "Grep", "WebFetch", "WebSearch", "Task"];
const TIMEOUT_MS = 240_000;

function claudeCommand(env = process.env) {
  if (env.PITLANE_E2E === "1" && env.PITLANE_CLAUDE_COMMAND) {
    const [command, ...args] = JSON.parse(env.PITLANE_CLAUDE_COMMAND);
    return { command, args };
  }
  return resolveCommand("claude", env);
}

function runClaude(args, input, { cwd, timeoutMs }) {
  return new Promise((resolve) => {
    const claude = claudeCommand();
    if (claude.error) return resolve({ ok: false, stdout: "", stderr: claude.error });
    const child = spawn(claude.command, [...claude.args, ...args], { cwd, env: agentEnv(process.env), stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ ok: false, stdout, stderr: `timed out after ${timeoutMs}ms` });
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, stdout, stderr });
    });
    child.stdin.end(input);
  });
}

async function ask({ cwd, server, scope, model = "sonnet", run = runClaude, key, instructions, brief }) {
  if (!["atlassian", "linear"].includes(trackerSourceFamily(server))) {
    return { ok: false, error: `${server} is not a Jira or Linear MCP server` };
  }
  const allowed = readOnlyTrackerToolNames({ source: server, server });
  // dontAsk refuses every tool not explicitly allowed, whatever default mode the owner set (auto would pass them
  // to a classifier); no session persistence, or each poll would add a conversation to the project's resume list.
  const args = ["-p", "--output-format", "json", "--model", model, "--permission-mode", "dontAsk", "--no-session-persistence", "--disallowedTools", ...DENIED, "--allowedTools", ...allowed];
  const prompt = `Use only the explicitly allowed read-only tools in MCP namespace ${server}.\n\n${buildListTasksPrompt({ source: server, brief, scope: scope || "", instructions: instructions || "", ...(key ? { key, limit: 3 } : {}) })}`;
  const result = await run(args, prompt, { cwd, timeoutMs: TIMEOUT_MS });
  if (!result.ok) return { ok: false, error: String(result.stderr || "Claude did not answer").trim().split("\n").pop() };
  let reply = result.stdout;
  try {
    const envelope = JSON.parse(result.stdout);
    if (envelope && typeof envelope.result === "string") reply = envelope.result;
  } catch {
    // Not an envelope; read the reply as it is.
  }
  const parsed = parseTaskList(reply);
  return parsed.ok ? { ok: true, tasks: parsed.tasks } : { ok: false, error: parsed.why };
}

/** Keys and titles of the open items assigned to the owner; brief, because this runs every few minutes. */
function pollAssigned(options) {
  return ask({ ...options, brief: true });
}

/** One ticket in full, with its description verbatim, for the agent that will work on it. Asked for by key alone: a watch with its own instructions finds tickets that are not assigned to the owner. */
async function readTicket({ key, ...options }) {
  const result = await ask({ ...options, key, brief: false });
  if (!result.ok) return null;
  return result.tasks.find((task) => String(task.id).toLowerCase() === String(key).toLowerCase()) || null;
}

module.exports = { pollAssigned, readTicket, runClaude, claudeCommand };
