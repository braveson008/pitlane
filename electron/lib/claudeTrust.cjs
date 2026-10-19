const fs = require("node:fs");
const path = require("node:path");
const { writeJsonAtomic } = require("./atomicJson.cjs");

/**
 * Claude asks "do you trust this folder?" for any folder it has not seen, and an unattended agent in a
 * fresh workspace would sit on that screen forever. Workspaces are checkouts of the owner's own project,
 * so they are trusted the way the owner trusts the project. Returns whether the file was written.
 */
function ensureClaudeTrust(cwd, home) {
  const file = path.join(home, ".claude.json");
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  const data = JSON.parse(raw);
  if (!data.projects || typeof data.projects !== "object") data.projects = {};
  const existing = data.projects[cwd] || {};
  if (existing.hasTrustDialogAccepted === true) return false;
  const backup = `${file}.pitlane.bak`;
  if (!fs.existsSync(backup)) fs.writeFileSync(backup, raw, { mode: 0o600 });
  data.projects[cwd] = { ...existing, hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true };
  writeJsonAtomic(file, data);
  return true;
}

module.exports = { ensureClaudeTrust };
