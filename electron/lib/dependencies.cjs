const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { execFile } = require("node:child_process");
const { agentEnv } = require("./agents.cjs");

const LOCKFILES = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb"];
const INSTALL = {
  "package-lock.json": ["npm", ["ci"]],
  "pnpm-lock.yaml": ["pnpm", ["install", "--frozen-lockfile"]],
  "yarn.lock": ["yarn", ["install", "--frozen-lockfile"]],
  "bun.lockb": ["bun", ["install", "--frozen-lockfile"]],
};
const SKIP = new Set(["node_modules", ".git", "dist", "build"]);
const MAX_DEPTH = 4;

async function walk(dir, visit, depth = 0, rel = "") {
  const entries = await fs.promises.readdir(path.join(dir, rel), { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const child = path.join(rel, entry.name);
    visit(entry, child);
    if (entry.isDirectory() && !SKIP.has(entry.name) && depth < MAX_DEPTH) await walk(dir, visit, depth + 1, child);
  }
}

async function lockfiles(dir) {
  const found = [];
  await walk(dir, (entry, rel) => { if (entry.isFile() && LOCKFILES.includes(entry.name)) found.push(rel); });
  return found.sort();
}

async function lockfileHash(dir) {
  const files = await lockfiles(dir);
  if (!files.length) return null;
  const hash = createHash("sha256");
  for (const file of files) hash.update(`${file}\0`).update(await fs.promises.readFile(path.join(dir, file))).update("\0");
  return hash.digest("hex");
}

async function nodeModulesDirs(dir) {
  const found = [];
  await walk(dir, (entry, rel) => { if (entry.isDirectory() && entry.name === "node_modules") found.push(rel); });
  return found;
}

const run = (cmd, args, options) => new Promise((resolve, reject) => {
  execFile(cmd, args, { ...options, env: agentEnv(process.env), timeout: 15 * 60_000, maxBuffer: 64 * 1024 * 1024 }, (error, _stdout, stderr) => {
    if (error) reject(new Error(String(stderr || error.message).trim().split("\n").slice(-3).join("\n")));
    else resolve();
  });
});

// APFS clones share blocks until something writes, so a cloned node_modules costs almost no disk.
const cloneTree = (from, to) => run("cp", ["-c", "-R", from, to], {}).catch(() => run("cp", ["-R", from, to], {}));

/** Gives a slot working dependencies: cloned from the owner's checkout when the lockfiles match, installed otherwise. */
async function prepareDependencies({ projectPath, slotPath, previousHash, exec = run, clone = cloneTree }) {
  const hash = await lockfileHash(slotPath);
  if (!hash) return { hash: null, action: "none" };
  if (hash === previousHash) return { hash, action: "unchanged" };
  if (hash === (await lockfileHash(projectPath))) {
    for (const rel of await nodeModulesDirs(projectPath)) {
      const target = path.join(slotPath, rel);
      if (!fs.existsSync(path.dirname(target))) continue;
      await fs.promises.rm(target, { recursive: true, force: true });
      await clone(path.join(projectPath, rel), target);
    }
    return { hash, action: "cloned" };
  }
  const root = LOCKFILES.find((file) => fs.existsSync(path.join(slotPath, file)));
  const [cmd, args] = INSTALL[root || "package-lock.json"];
  await exec(cmd, args, { cwd: slotPath });
  return { hash, action: "installed" };
}

module.exports = { lockfileHash, prepareDependencies };
