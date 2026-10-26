const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { createHash, randomUUID } = require("node:crypto");

// What an agent changed, live, like an editor's agent diff. Plain Node and git,
// no Electron, so another front end can drive the same thing.
//
// A session's starting point is a git tree written through a throwaway index:
// it captures uncommitted and untracked work too, and never touches the
// agent's own index or takes its lock. The diff is that tree against a fresh
// one, so commits the agent makes do not hide what it changed.

const STATUS = { A: "added", M: "modified", D: "deleted", R: "renamed", C: "copied", T: "typechange", U: "conflicted" };
const IGNORED_SEGMENTS = new Set([".git", "node_modules", "dist", "build", ".next", ".expo", ".turbo", ".cache", "Pods", "DerivedData", "coverage"]);
const MAX_FILES = 500;

function runGit(cwd, args, { env, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile("git", args, {
      cwd,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", ...env },
      maxBuffer: 64 * 1024 * 1024,
      timeout: 60_000,
    }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(new Error(String(stderr || error.message).trim()), { code: error.code }));
      else resolve(stdout);
    });
    if (input !== undefined) child.stdin.end(input);
  });
}

async function withScratchIndex(cwd, git, seed, work) {
  const index = path.join(os.tmpdir(), `pitlane-live-${randomUUID()}.index`);
  try {
    if (seed) {
      // Seeded from the real index so only files whose stat changed are re-hashed.
      const real = path.resolve(cwd, (await git(cwd, ["rev-parse", "--git-path", "index"])).trim());
      const stat = await fs.promises.stat(real).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
      if (stat) {
        await fs.promises.copyFile(real, index);
        // Git trusts an entry's timestamps only when the index is newer than it; a copy
        // stamped "now" would hide an edit made in the same second as the last refresh.
        await fs.promises.utimes(index, stat.atime, stat.mtime);
      }
    }
    return await work({ GIT_INDEX_FILE: index });
  } finally {
    await fs.promises.rm(index, { force: true });
  }
}

/** The worktree as it is now, including uncommitted and untracked files, as a tree id. */
function snapshot(cwd, git = runGit) {
  return withScratchIndex(cwd, git, true, async (env) => {
    await git(cwd, ["add", "-A", "--", "."], { env });
    return (await git(cwd, ["write-tree"], { env })).trim();
  });
}

function parseChanges(nameStatus, numstat) {
  const counts = new Map();
  const numParts = numstat.split("\0");
  for (let i = 0; i < numParts.length - 1;) {
    const [added, deleted, inline] = numParts[i].split("\t");
    let file = inline;
    i += 1;
    if (!inline) {
      file = numParts[i + 1];
      i += 2;
    }
    counts.set(file, { binary: added === "-", additions: Number(added) || 0, deletions: Number(deleted) || 0 });
  }
  const files = [];
  const parts = nameStatus.split("\0");
  for (let i = 0; i < parts.length - 1;) {
    const code = parts[i][0];
    const moved = code === "R" || code === "C";
    const from = moved ? parts[i + 1] : null;
    const file = moved ? parts[i + 2] : parts[i + 1];
    i += moved ? 3 : 2;
    files.push({ path: file, from, status: STATUS[code] || "modified", ...(counts.get(file) || { binary: false, additions: 0, deletions: 0 }) });
  }
  return files;
}

/** Files that differ between two trees, with line counts. */
async function changesBetween(cwd, base, current, git = runGit) {
  const [nameStatus, numstat] = await Promise.all([
    git(cwd, ["diff", "--name-status", "-z", "--find-renames", base, current]),
    git(cwd, ["diff", "--numstat", "-z", "--find-renames", base, current]),
  ]);
  const files = parseChanges(nameStatus, numstat);
  return {
    files: files.slice(0, MAX_FILES),
    truncated: files.length > MAX_FILES,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
  };
}

const hunkId = (text) => createHash("sha1").update(text).digest("hex").slice(0, 12);

/** A file patch split into its header and hunks, each hunk with a stable id. */
function splitPatch(patch) {
  const lines = patch.split("\n");
  const first = lines.findIndex((line) => line.startsWith("@@"));
  if (first === -1) return { header: patch, hunks: [] };
  const hunks = [];
  for (let i = first; i < lines.length; i += 1) {
    if (lines[i].startsWith("@@")) hunks.push([]);
    hunks[hunks.length - 1].push(lines[i]);
  }
  return {
    header: lines.slice(0, first).join("\n"),
    hunks: hunks.map((body) => {
      while (body.length > 1 && body[body.length - 1] === "") body.pop();
      const text = body.join("\n");
      return { id: hunkId(text), text };
    }),
  };
}

function filePaths(file) {
  return file.from ? [file.from, file.path] : [file.path];
}

async function fileDiff(cwd, base, current, file, git = runGit) {
  const patch = await git(cwd, ["diff", "--find-renames", base, current, "--", ...filePaths(file)]);
  return { diff: patch, hunks: splitPatch(patch).hunks.map((hunk) => hunk.id) };
}

function insideWorktree(cwd, relative) {
  const target = path.resolve(cwd, relative);
  if (path.isAbsolute(relative) || (target !== cwd && !target.startsWith(cwd + path.sep))) {
    throw new Error(`${relative} is outside the worktree`);
  }
  return target;
}

async function inTree(cwd, tree, relative, git) {
  return (await git(cwd, ["ls-tree", "-z", tree, "--", relative])).length > 0;
}

/** Puts the file back as it was in `base`: restored if it existed there, removed if it did not. */
async function revertFile(cwd, base, file, git = runGit) {
  for (const relative of filePaths(file)) insideWorktree(cwd, relative);
  await withScratchIndex(cwd, git, false, async (env) => {
    await git(cwd, ["read-tree", base], { env });
    for (const relative of filePaths(file)) {
      if (await inTree(cwd, base, relative, git)) await git(cwd, ["checkout-index", "-f", "--", relative], { env });
      else await fs.promises.rm(insideWorktree(cwd, relative), { force: true });
    }
  });
}

/** Undoes one hunk in the working tree; fails, rather than guessing, if the file moved on since it was shown. */
async function revertHunk(cwd, base, current, file, id, git = runGit) {
  const patch = await git(cwd, ["diff", "--find-renames", base, current, "--", ...filePaths(file)]);
  const { header, hunks } = splitPatch(patch);
  const hunk = hunks.find((candidate) => candidate.id === id);
  if (!hunk) throw new Error("That change has moved on since it was shown. Look again and retry.");
  await git(cwd, ["apply", "-R", "--whitespace=nowarn", "-"], { input: `${header}\n${hunk.text}\n` });
}

/** A new starting point: `base` with the file taken as it is in `current`, so it stops showing as changed. */
async function keepFile(cwd, base, current, file, git = runGit) {
  return withScratchIndex(cwd, git, false, async (env) => {
    await git(cwd, ["read-tree", base], { env });
    for (const relative of filePaths(file)) {
      const entry = (await git(cwd, ["ls-tree", "-z", current, "--", relative])).replace(/\0$/, "");
      if (entry) {
        const [meta] = entry.split("\t");
        const [mode, , object] = meta.split(" ");
        await git(cwd, ["update-index", "--add", "--cacheinfo", `${mode},${object},${relative}`], { env });
      } else {
        await git(cwd, ["update-index", "--force-remove", "--", relative], { env });
      }
    }
    return (await git(cwd, ["write-tree"], { env })).trim();
  });
}

function ignoredEvent(filename) {
  if (!filename) return false;
  return String(filename).split(/[\\/]/).some((segment) => IGNORED_SEGMENTS.has(segment));
}

function watchTree(cwd, onChange, { debounceMs = 400, pollMs = 3000 } = {}) {
  let timer = null;
  const fire = () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, debounceMs);
  };
  let watcher = null;
  let poll = null;
  try {
    watcher = fs.watch(cwd, { recursive: true }, (_event, filename) => { if (!ignoredEvent(filename)) fire(); });
    watcher.on("error", () => {
      watcher?.close();
      watcher = null;
      poll ??= setInterval(onChange, pollMs);
    });
  } catch {
    poll = setInterval(onChange, pollMs);
  }
  return () => {
    clearTimeout(timer);
    watcher?.close();
    clearInterval(poll);
  };
}

/**
 * Sessions' starting points, kept across restarts, and live summaries for
 * whoever is subscribed. Work for one session is serialised so a revert never
 * races the snapshot that follows it.
 */
function createLiveChanges({ storePath, git = runGit, watch = watchTree, now = Date.now, log = () => {} } = {}) {
  let baselines = {};
  try { baselines = JSON.parse(fs.readFileSync(storePath, "utf8")) || {}; } catch { baselines = {}; }
  const queues = new Map();
  const live = new Map();

  function persist() {
    if (!storePath) return;
    const tmp = `${storePath}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(baselines), { mode: 0o600 });
      fs.renameSync(tmp, storePath);
    } catch (error) {
      fs.rmSync(tmp, { force: true });
      log(`[live-changes] could not save starting points: ${error.message}`);
    }
  }

  function serial(sessionId, work) {
    const next = (queues.get(sessionId) || Promise.resolve()).catch(() => {}).then(work);
    queues.set(sessionId, next);
    return next.finally(() => { if (queues.get(sessionId) === next) queues.delete(sessionId); });
  }

  async function baseline(sessionId, cwd) {
    // Paths in a tree are relative to the repository root, so everything runs from there.
    const root = (await git(cwd, ["rev-parse", "--show-toplevel"])).trim();
    const known = baselines[sessionId];
    if (known && known.cwd === root) {
      const present = await git(root, ["cat-file", "-e", `${known.tree}^{tree}`]).then(() => true, () => false);
      if (present) return known;
    }
    const record = { cwd: root, tree: await snapshot(root, git), at: now() };
    baselines[sessionId] = record;
    persist();
    return record;
  }

  async function compute(sessionId, cwd) {
    try {
      const base = await baseline(sessionId, cwd);
      const current = await snapshot(base.cwd, git);
      return { sessionId, ok: true, since: base.at, ...(await changesBetween(base.cwd, base.tree, current, git)) };
    } catch (error) {
      return { sessionId, ok: false, error: error.message, files: [], additions: 0, deletions: 0 };
    }
  }

  function refresh(sessionId) {
    const entry = live.get(sessionId);
    if (!entry) return Promise.resolve();
    return serial(sessionId, async () => {
      const summary = await compute(sessionId, entry.cwd);
      entry.last = summary;
      for (const listener of entry.listeners) listener(summary);
      return summary;
    });
  }

  function recordFor(sessionId) {
    const record = baselines[sessionId];
    if (!record) throw new Error("This session has no starting point yet.");
    return record;
  }

  return {
    /** Records where a session started, if it has no starting point yet. */
    start(sessionId, cwd) {
      return serial(sessionId, () => baseline(sessionId, cwd)).catch((error) => log(`[live-changes] ${sessionId}: ${error.message}`));
    },
    subscribe(sessionId, cwd, listener) {
      let entry = live.get(sessionId);
      if (entry && entry.cwd !== cwd) {
        entry.stop();
        live.delete(sessionId);
        entry = null;
      }
      if (!entry) {
        entry = { cwd, listeners: new Set(), last: null, stop: () => {} };
        live.set(sessionId, entry);
        entry.stop = watch(cwd, () => void refresh(sessionId));
      }
      entry.listeners.add(listener);
      if (entry.last) listener(entry.last);
      void refresh(sessionId);
      return () => {
        entry.listeners.delete(listener);
        if (entry.listeners.size || live.get(sessionId) !== entry) return;
        entry.stop();
        live.delete(sessionId);
      };
    },
    refresh,
    fileDiff(sessionId, file) {
      return serial(sessionId, async () => {
        const { cwd, tree } = recordFor(sessionId);
        return fileDiff(cwd, tree, await snapshot(cwd, git), file, git);
      });
    },
    async revert(sessionId, file, hunk) {
      await serial(sessionId, async () => {
        const { cwd, tree } = recordFor(sessionId);
        if (hunk) await revertHunk(cwd, tree, await snapshot(cwd, git), file, hunk, git);
        else await revertFile(cwd, tree, file, git);
      });
      return refresh(sessionId);
    },
    /** Accepts a file, or with no file everything, as the new starting point. */
    async keep(sessionId, file) {
      await serial(sessionId, async () => {
        const record = recordFor(sessionId);
        const current = await snapshot(record.cwd, git);
        record.tree = file ? await keepFile(record.cwd, record.tree, current, file, git) : current;
        if (!file) record.at = now();
        persist();
      });
      return refresh(sessionId);
    },
    forget(sessionId) {
      live.get(sessionId)?.stop();
      live.delete(sessionId);
      if (baselines[sessionId]) {
        delete baselines[sessionId];
        persist();
      }
    },
    /** Forgets the starting points of every session not in `ids`; returns how many went. */
    retain(ids) {
      const gone = Object.keys(baselines).filter((sessionId) => !ids.has(sessionId));
      for (const sessionId of gone) {
        live.get(sessionId)?.stop();
        live.delete(sessionId);
        delete baselines[sessionId];
      }
      if (gone.length) persist();
      return gone.length;
    },
    close() {
      for (const entry of live.values()) entry.stop();
      live.clear();
    },
  };
}

module.exports = { createLiveChanges, snapshot, changesBetween, fileDiff, revertFile, revertHunk, keepFile, splitPatch, watchTree };
