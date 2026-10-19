const fs = require("node:fs");
const path = require("node:path");
const { writeJsonAtomic } = require("./atomicJson.cjs");

const CARRIED_LISTS = ["allowedTools", "enabledMcpjsonServers", "disabledMcpjsonServers", "mcpContextUris"];

// Claude Code's folder name for a project's transcripts under ~/.claude/projects.
function claudeProjectFolder(projectPath) {
  return projectPath.replace(/[^a-zA-Z0-9]/g, "-");
}

/** Gives `to` the MCP servers, tool approvals and trust Claude recorded for `from`; `to`'s own entries win. */
function carryClaudeConfig(from, to, home) {
  const file = path.join(home, ".claude.json");
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  const data = JSON.parse(raw);
  const source = data?.projects?.[from];
  if (!source || typeof source !== "object") return false;
  const target = data.projects[to] || {};
  const next = { ...source, ...target, mcpServers: { ...(source.mcpServers || {}), ...(target.mcpServers || {}) } };
  for (const key of CARRIED_LISTS) next[key] = [...new Set([...(source[key] || []), ...(target[key] || [])])];
  if (source.hasTrustDialogAccepted === true) next.hasTrustDialogAccepted = true;
  if (JSON.stringify(next) === JSON.stringify(data.projects[to])) return false;
  const backup = `${file}.pitlane.bak`;
  if (!fs.existsSync(backup)) fs.writeFileSync(backup, raw, { mode: 0o600 });
  data.projects[to] = next;
  writeJsonAtomic(file, data);
  return true;
}

function linkTranscripts(home, from, to) {
  const root = path.join(home, ".claude", "projects");
  const source = path.join(root, claudeProjectFolder(from));
  const target = path.join(root, claudeProjectFolder(to));
  let names = [];
  try {
    names = fs.readdirSync(source);
  } catch {
    return 0;
  }
  if (!names.length) return 0;
  fs.mkdirSync(target, { recursive: true });
  let linked = 0;
  for (const name of names) {
    try {
      fs.symlinkSync(path.join(source, name), path.join(target, name));
      linked += 1;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  return linked;
}

/** Claude keys MCP servers, trust and resumable conversations by path, so a moved project would look like it lost them. */
async function carryMovedProjects({ moves, home, store, log = () => {} }) {
  const carried = [];
  for (const { from, to } of moves) {
    if (!from || !to || from === to) continue;
    // Each move is carried once: carrying again would bring back a server or approval the owner has since removed.
    const key = `${from}\0${to}`;
    if (store?.has(key)) continue;
    try {
      const config = carryClaudeConfig(from, to, home);
      const transcripts = linkTranscripts(home, from, to);
      store?.add(key);
      if (config || transcripts) carried.push(to);
    } catch (error) {
      log(`[projects] could not carry ${from} -> ${to}: ${error.message}`);
    }
  }
  return carried;
}

module.exports = { carryMovedProjects, claudeProjectFolder };
