const fs = require("node:fs");
const path = require("node:path");
const { runGit } = require("./git.cjs");
const { prepareDependencies } = require("./dependencies.cjs");

// Reusable checkouts per project: a session switches a free one to its branch instead of making a new copy.
// One clean slot is kept warm for the next session; any other is removed once its session lets it go.
function createWorkspacePool({ root, git = runGit, store, prepare = prepareDependencies, log = () => {} }) {
  let all = store.get() || {};
  const save = () => store.set(all);
  const slotsOf = (project) => (all[project.id] ||= []);
  const queue = new Map();

  // Work on one project's slots runs one at a time, so two sessions starting together never pick the same slot.
  function serial(projectId, work) {
    const next = (queue.get(projectId) || Promise.resolve()).catch(() => {}).then(work);
    queue.set(projectId, next);
    return next;
  }

  async function base(project) {
    const remote = await git(project.path, ["rev-parse", "--verify", "-q", `refs/remotes/origin/${project.trunk}`]).catch(() => "");
    return remote ? `origin/${project.trunk}` : project.trunk;
  }

  async function exists(cwd, ref) {
    return Boolean(await git(cwd, ["rev-parse", "--verify", "-q", ref]).catch(() => ""));
  }

  async function createSlot(project, index) {
    const slotPath = path.join(root, project.id, String(index));
    if (!fs.existsSync(path.join(slotPath, ".git"))) {
      fs.mkdirSync(path.dirname(slotPath), { recursive: true });
      await git(project.path, ["worktree", "add", "--detach", slotPath, await base(project)]);
    }
    const slot = { index, path: slotPath, state: "free" };
    slotsOf(project).push(slot);
    slotsOf(project).sort((a, b) => a.index - b.index);
    return slot;
  }

  async function checkoutBranch(project, slot, branch) {
    if (await exists(slot.path, `refs/heads/${branch}`)) return git(slot.path, ["switch", branch]);
    if (await exists(slot.path, `refs/remotes/origin/${branch}`)) return git(slot.path, ["switch", "-c", branch, "--track", `origin/${branch}`]);
    // No tracking: a session branch following origin/<trunk> would let a plain push land on the trunk.
    return git(slot.path, ["switch", "--no-track", "-c", branch, await base(project)]);
  }

  async function reset(project, slot) {
    await git(slot.path, ["switch", "--detach", "--discard-changes", await base(project)]);
    // A review slot also loses ignored files (its review draft, test output); a ticket slot keeps its dependencies.
    await git(slot.path, ["clean", slot.detached ? "-fdx" : "-fd"]);
    if (slot.detached) delete slot.depsHash;
    Object.assign(slot, { state: "free" });
    delete slot.sessionId;
    delete slot.branch;
    delete slot.heldReason;
    delete slot.detached;
    delete slot.head;
    delete slot.base;
    save();
  }

  async function why(project, slot) {
    // Nothing in a review slot is the owner's: it is reset whatever was left in it.
    if (slot.detached) return null;
    if (await git(slot.path, ["status", "--porcelain"])) return "uncommitted";
    const ahead = await git(slot.path, ["rev-list", "--count", `${await base(project)}..HEAD`]);
    if (Number(ahead) === 0) return null;
    const onRemote = await git(slot.path, ["branch", "-r", "--contains", "HEAD"]);
    return onRemote ? null : "unpushed";
  }

  async function pick(project) {
    const free = slotsOf(project).find((candidate) => candidate.state === "free");
    if (free) return free;
    const used = new Set(slotsOf(project).map((candidate) => candidate.index));
    let index = 1;
    while (used.has(index)) index += 1;
    return createSlot(project, index);
  }

  /** Removes every free slot but the first from disk, so finished sessions leave nothing behind. */
  async function trim(project) {
    const spare = slotsOf(project).filter((slot) => slot.state === "free").slice(1);
    for (const slot of spare) {
      await git(project.path, ["worktree", "remove", "--force", slot.path]).catch(() => {});
      fs.rmSync(slot.path, { recursive: true, force: true });
      all[project.id] = slotsOf(project).filter((candidate) => candidate !== slot);
    }
    if (spare.length) {
      await git(project.path, ["worktree", "prune"]).catch(() => {});
      save();
    }
  }

  async function claim(project, slot, { sessionId, branch, detached = false }) {
    Object.assign(slot, { state: "busy", sessionId, branch, detached });
    if (!branch) delete slot.branch;
    delete slot.heldReason;
    try {
      const deps = await prepare({ projectPath: project.path, slotPath: slot.path, previousHash: slot.depsHash });
      slot.depsHash = deps.hash ?? undefined;
    } catch (error) {
      // The agent can still install them itself; a failed install must not block the session.
      log(`[workspaces] ${project.id}/${slot.index}: dependencies not set up: ${error.message}`);
    }
    save();
    return { ...slot };
  }

  const find = (project, index, sessionId) => {
    const slot = slotsOf(project).find((candidate) => candidate.index === index);
    if (!slot) throw new Error(`No workspace ${index}`);
    // A slot freed by one session can already be another's; acting on it would touch that agent's live work.
    if (sessionId !== undefined && slot.sessionId !== sessionId) throw new Error("That workspace belongs to another session now");
    return slot;
  };

  // Commits Pitlane makes for the owner: no hooks (a refusing pre-commit would make parking impossible) and no signing prompt.
  async function commitAll(slot, message) {
    await git(slot.path, ["add", "-A"]);
    const named = await git(slot.path, ["config", "user.email"]).catch(() => "");
    const identity = named ? [] : ["-c", "user.name=Pitlane", "-c", "user.email=pitlane@localhost"];
    await git(slot.path, [...identity, "-c", "commit.gpgsign=false", "commit", "-q", "--no-verify", "-m", message]);
  }

  return {
    base,
    slots: (project) => slotsOf(project).map((slot) => ({ ...slot })),
    acquire(project, { sessionId, branch }) {
      return serial(project.id, async () => {
        await git(project.path, ["fetch", "-q", "origin"]).catch(() => {});
        const slot = await pick(project);
        await checkoutBranch(project, slot, branch);
        return claim(project, slot, { sessionId, branch });
      });
    },
    /**
     * A slot at a teammate's commit (a PR head) for reviewing, on no branch. Their install scripts never run here
     * (no dependency setup), and the base it is compared with is fetched fresh, so the diff is the PR's own.
     */
    acquireDetached(project, { sessionId, fetchRef, baseRef, env }) {
      return serial(project.id, async () => {
        const slot = await pick(project);
        let base = null;
        if (baseRef) {
          await git(slot.path, ["fetch", "-q", "origin", baseRef], { env });
          base = await git(slot.path, ["rev-parse", "FETCH_HEAD"]);
        }
        await git(slot.path, ["fetch", "-q", "origin", fetchRef], { env });
        await git(slot.path, ["switch", "--detach", "FETCH_HEAD"]);
        const head = await git(slot.path, ["rev-parse", "HEAD"]);
        Object.assign(slot, { state: "busy", sessionId, detached: true, head, base });
        delete slot.branch;
        delete slot.heldReason;
        save();
        return { ...slot };
      });
    },
    owns(project, index, sessionId) {
      return slotsOf(project).some((slot) => slot.index === index && slot.sessionId === sessionId);
    },
    release(project, index, sessionId) {
      return serial(project.id, async () => {
        const slot = find(project, index, sessionId);
        const reason = await why(project, slot);
        if (reason) {
          Object.assign(slot, { state: "held", heldReason: reason });
          save();
          return "held";
        }
        await reset(project, slot);
        await trim(project);
        return "reset";
      });
    },
    park(project, index, sessionId) {
      return serial(project.id, async () => {
        const slot = find(project, index, sessionId);
        if (slot.state === "busy") throw new Error("That workspace is still in use by its agent");
        if (await git(slot.path, ["status", "--porcelain"])) await commitAll(slot, "WIP: parked by Pitlane");
        await reset(project, slot);
        await trim(project);
      });
    },
    /** Throws away whatever an ended session's slot kept, uncommitted or not, and frees it. */
    discard(project, index, sessionId) {
      return serial(project.id, async () => {
        const slot = find(project, index, sessionId);
        if (slot.state === "busy") throw new Error("That workspace is still in use by its agent");
        await reset(project, slot);
        await trim(project);
      });
    },
    /** Commits the owner's revert in a held slot (pushing only to the branch's own remote branch), then releases it. */
    commitRevert(project, index, sessionId, file) {
      return serial(project.id, async () => {
        const slot = find(project, index, sessionId);
        if (slot.state !== "held") return "not-held";
        if (await git(slot.path, ["status", "--porcelain"])) await commitAll(slot, `Revert ${file} (owner)`);
        const upstream = await git(slot.path, ["rev-parse", "--abbrev-ref", "@{u}"]).catch(() => "");
        if (upstream === `origin/${slot.branch}`) await git(slot.path, ["push", "-q", "origin", `HEAD:refs/heads/${slot.branch}`]).catch(() => {});
        return "committed";
      });
    },
    /** After a restart no agent survives, so slots still marked busy by sessions that are not running are released. */
    async reconcile(project, runningSessionIds) {
      for (const slot of slotsOf(project).slice()) {
        if (slot.state === "busy" && !runningSessionIds.has(slot.sessionId)) await this.release(project, slot.index, slot.sessionId).catch(() => {});
      }
    },
    /** A moved project's slots still point at its old .git; relinking keeps them usable. */
    repair(project) {
      return serial(project.id, async () => {
        const paths = slotsOf(project).map((slot) => slot.path).filter((slotPath) => fs.existsSync(slotPath));
        if (paths.length) await git(project.path, ["worktree", "repair", ...paths]);
      });
    },
  };
}

module.exports = { createWorkspacePool };
