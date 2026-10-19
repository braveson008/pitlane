const fs = require("node:fs");
const path = require("node:path");
const { runGit } = require("./git.cjs");

// Files a build usually needs that git does not carry; a fresh workspace has none of them.
const PATTERNS = [/^\.env/, /\.local\./, /^local\.properties$/, /^GoogleService-Info\.plist$/, /^google-services\.json$/];

async function detectLocalFiles(projectPath, git = runGit) {
  const entries = await fs.promises.readdir(projectPath, { withFileTypes: true });
  const candidates = entries.filter((entry) => entry.isFile() && PATTERNS.some((pattern) => pattern.test(entry.name))).map((entry) => entry.name);
  const ignored = [];
  for (const name of candidates) {
    if (await git(projectPath, ["check-ignore", "-q", "--", name]).then(() => true, () => false)) ignored.push(name);
  }
  return ignored.sort();
}

/** Copies the confirmed files into a slot when the original is newer; copies, so an agent can never edit the owner's own file. */
async function syncLocalFiles(projectPath, slotPath, files) {
  const root = await fs.promises.realpath(projectPath);
  const copied = [];
  for (const name of files) {
    const source = path.join(root, name);
    const real = await fs.promises.realpath(source).catch(() => null);
    if (!real || path.dirname(real) !== root || path.basename(name) !== name) continue;
    const stat = await fs.promises.stat(real);
    if (!stat.isFile()) continue;
    const target = path.join(slotPath, name);
    const existing = await fs.promises.stat(target).catch(() => null);
    // utimes keeps milliseconds only, so the copy is compared at that precision.
    if (existing && Math.floor(existing.mtimeMs) >= Math.floor(stat.mtimeMs)) continue;
    await fs.promises.rm(target, { force: true });
    await fs.promises.copyFile(real, target);
    await fs.promises.chmod(target, stat.mode & 0o777);
    await fs.promises.utimes(target, stat.atime, stat.mtime);
    copied.push(name);
  }
  return copied;
}

module.exports = { detectLocalFiles, syncLocalFiles };
