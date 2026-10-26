import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createWorkspacePool } = require("./workspaces.cjs");

let temp: string;
let repo: string;
let root: string;
let saved: Record<string, unknown>;

const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.email=a@b", "-c", "user.name=t", ...args], { cwd, encoding: "utf8" }).trim();
const project = (overrides = {}) => ({ id: "p1", path: repo, trunk: "main", agentLimit: 1, ...overrides });
const pool = () => createWorkspacePool({ root, store: { get: () => saved, set: (value: Record<string, unknown>) => { saved = value; } } });

beforeEach(() => {
  temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pitlane-ws-")));
  const origin = path.join(temp, "origin.git");
  git(temp, "init", "-q", "--bare", "-b", "main", origin);
  repo = path.join(temp, "shop");
  git(temp, "clone", "-q", origin, repo);
  fs.writeFileSync(path.join(repo, "a.txt"), "a\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "root");
  git(repo, "push", "-q", "origin", "main");
  git(repo, "remote", "set-head", "origin", "main");
  root = path.join(temp, "workspaces");
  saved = {};
});

afterEach(() => fs.rmSync(temp, { recursive: true, force: true }));

describe("workspace slots", () => {
  it("acquire creates one slot outside the project, on a new branch from origin trunk", async () => {
    const slot = await pool().acquire(project(), { sessionId: "s1", branch: "pitlane/session-aaaa" });
    expect(slot).toMatchObject({ index: 1, state: "busy", sessionId: "s1", branch: "pitlane/session-aaaa" });
    expect(slot.path).toBe(path.join(root, "p1", "1"));
    expect(git(slot.path, "branch", "--show-current")).toBe("pitlane/session-aaaa");
    expect(git(slot.path, "rev-parse", "HEAD")).toBe(git(repo, "rev-parse", "origin/main"));
    expect(git(repo, "branch", "--show-current")).toBe("main");
    expect(git(repo, "status", "--porcelain")).toBe("");
  });

  it("there is no limit: each session at once gets its own slot", async () => {
    const workspaces = pool();
    const indexes = [];
    for (const id of ["s1", "s2", "s3", "s4"]) indexes.push((await workspaces.acquire(project(), { sessionId: id, branch: id })).index);
    expect(indexes).toEqual([1, 2, 3, 4]);
  });

  it("a freed slot is removed from disk when another clean one is already waiting", async () => {
    const workspaces = pool();
    const first = await workspaces.acquire(project(), { sessionId: "s1", branch: "b1" });
    const second = await workspaces.acquire(project(), { sessionId: "s2", branch: "b2" });
    await workspaces.release(project(), first.index, "s1");
    expect(fs.existsSync(first.path)).toBe(true);
    await workspaces.release(project(), second.index, "s2");
    expect(fs.existsSync(second.path)).toBe(false);
    expect(workspaces.slots(project()).map((slot: { index: number; state: string }) => [slot.index, slot.state])).toEqual([[1, "free"]]);
    expect(git(repo, "worktree", "list")).not.toContain(second.path);
    expect((await workspaces.acquire(project(), { sessionId: "s3", branch: "b3" })).index).toBe(1);
  });

  it("discard throws away what a held slot kept, and refuses one whose agent still runs", async () => {
    const workspaces = pool();
    const kept = await workspaces.acquire(project(), { sessionId: "s1", branch: "b1" });
    const running = await workspaces.acquire(project(), { sessionId: "s2", branch: "b2" });
    fs.writeFileSync(path.join(kept.path, "wip.txt"), "unfinished\n");
    expect(await workspaces.release(project(), kept.index, "s1")).toBe("held");
    await expect(workspaces.discard(project(), running.index, "s2")).rejects.toThrow("still in use");
    await workspaces.discard(project(), kept.index, "s1");
    expect(fs.existsSync(path.join(kept.path, "wip.txt"))).toBe(false);
    expect(workspaces.slots(project()).find((slot: { index: number }) => slot.index === kept.index)).toMatchObject({ state: "free" });
  });

  it("release of a clean slot resets it and frees it", async () => {
    const workspaces = pool();
    const slot = await workspaces.acquire(project(), { sessionId: "s1", branch: "pitlane/session-aaaa" });
    expect(await workspaces.release(project(), slot.index)).toBe("reset");
    expect(workspaces.slots(project())[0]).toMatchObject({ state: "free" });
    expect(git(slot.path, "branch", "--show-current")).toBe("");
    expect(git(slot.path, "rev-parse", "HEAD")).toBe(git(repo, "rev-parse", "origin/main"));
  });

  it("release keeps a slot with uncommitted work held", async () => {
    const workspaces = pool();
    const slot = await workspaces.acquire(project(), { sessionId: "s1", branch: "b1" });
    fs.writeFileSync(path.join(slot.path, "new.txt"), "work\n");
    expect(await workspaces.release(project(), slot.index)).toBe("held");
    expect(workspaces.slots(project())[0]).toMatchObject({ state: "held", heldReason: "uncommitted" });
    expect(fs.existsSync(path.join(slot.path, "new.txt"))).toBe(true);
  });

  it("release keeps a slot with unpushed commits held", async () => {
    const workspaces = pool();
    const slot = await workspaces.acquire(project(), { sessionId: "s1", branch: "b1" });
    fs.writeFileSync(path.join(slot.path, "new.txt"), "work\n");
    git(slot.path, "add", "-A");
    git(slot.path, "commit", "-qm", "work");
    expect(await workspaces.release(project(), slot.index)).toBe("held");
    expect(workspaces.slots(project())[0]).toMatchObject({ state: "held", heldReason: "unpushed" });
  });

  it("release frees a slot whose commits are pushed", async () => {
    const workspaces = pool();
    const slot = await workspaces.acquire(project(), { sessionId: "s1", branch: "b1" });
    fs.writeFileSync(path.join(slot.path, "new.txt"), "work\n");
    git(slot.path, "add", "-A");
    git(slot.path, "commit", "-qm", "work");
    git(slot.path, "push", "-q", "origin", "b1");
    expect(await workspaces.release(project(), slot.index)).toBe("reset");
  });

  it("park commits work in progress locally and frees the slot", async () => {
    const workspaces = pool();
    const slot = await workspaces.acquire(project(), { sessionId: "s1", branch: "b1" });
    fs.writeFileSync(path.join(slot.path, "new.txt"), "work\n");
    await workspaces.release(project(), slot.index);
    await workspaces.park(project(), slot.index);
    expect(workspaces.slots(project())[0]).toMatchObject({ state: "free" });
    expect(git(repo, "log", "-1", "--format=%s", "b1")).toBe("WIP: parked by Pitlane");
    expect(git(repo, "ls-remote", "--heads", "origin", "b1")).toBe("");
  });

  it("an existing branch is switched to, not checked out twice", async () => {
    git(repo, "branch", "feature/x", "main");
    const workspaces = pool();
    const slot = await workspaces.acquire(project(), { sessionId: "s1", branch: "feature/x" });
    expect(git(slot.path, "branch", "--show-current")).toBe("feature/x");
    expect(git(repo, "worktree", "list").split("\n")).toHaveLength(2);
  });

  it("base falls back to the local trunk without origin", async () => {
    git(repo, "remote", "remove", "origin");
    const workspaces = pool();
    expect(await workspaces.base(project())).toBe("main");
    const slot = await workspaces.acquire(project(), { sessionId: "s1", branch: "b1" });
    expect(git(slot.path, "branch", "--show-current")).toBe("b1");
  });

  it("slots survive a new pool on the same store", async () => {
    await pool().acquire(project(), { sessionId: "s1", branch: "b1" });
    expect(pool().slots(project())).toEqual([expect.objectContaining({ index: 1, state: "busy", sessionId: "s1" })]);
  });

  it("release and park refuse a slot that another session now owns", async () => {
    const workspaces = pool();
    const first = await workspaces.acquire(project(), { sessionId: "s1", branch: "b1" });
    await workspaces.release(project(), first.index, "s1");
    const second = await workspaces.acquire(project(), { sessionId: "s2", branch: "b2" });
    fs.writeFileSync(path.join(second.path, "live.txt"), "agent at work\n");
    await expect(workspaces.release(project(), second.index, "s1")).rejects.toThrow("belongs to another session");
    await expect(workspaces.park(project(), second.index, "s1")).rejects.toThrow("belongs to another session");
    expect(workspaces.owns(project(), second.index, "s1")).toBe(false);
    expect(workspaces.owns(project(), second.index, "s2")).toBe(true);
    expect(fs.existsSync(path.join(second.path, "live.txt"))).toBe(true);
  });

  it("park never touches a slot whose agent is still running", async () => {
    const workspaces = pool();
    const slot = await workspaces.acquire(project(), { sessionId: "s1", branch: "b1" });
    fs.writeFileSync(path.join(slot.path, "live.txt"), "agent at work\n");
    await expect(workspaces.park(project(), slot.index, "s1")).rejects.toThrow("still in use");
    expect(git(slot.path, "status", "--porcelain")).toContain("live.txt");
  });

  it("a new branch does not track the trunk, so a push can never land on it", async () => {
    const slot = await pool().acquire(project(), { sessionId: "s1", branch: "b1" });
    expect(() => git(slot.path, "rev-parse", "--abbrev-ref", "@{u}")).toThrow();
  });

  it("reconcile frees busy slots whose session is no longer running", async () => {
    const workspaces = pool();
    await workspaces.acquire(project({ agentLimit: 2 }), { sessionId: "gone", branch: "b1" });
    await workspaces.acquire(project({ agentLimit: 2 }), { sessionId: "alive", branch: "b2" });
    await workspaces.reconcile(project({ agentLimit: 2 }), new Set(["alive"]));
    expect(workspaces.slots(project()).map((slot: { state: string }) => slot.state)).toEqual(["free", "busy"]);
  });

  it("repair relinks slots after the project folder moves", async () => {
    const workspaces = pool();
    const slot = await workspaces.acquire(project(), { sessionId: "s1", branch: "b1" });
    await workspaces.release(project(), slot.index, "s1");
    const moved = path.join(temp, "moved-shop");
    fs.renameSync(repo, moved);
    repo = moved;
    expect(() => git(slot.path, "status")).toThrow();
    await workspaces.repair(project());
    expect(git(slot.path, "status", "--porcelain")).toBe("");
    await workspaces.acquire(project(), { sessionId: "s2", branch: "b2" });
  });

  it("park works in a repository whose commit hook would refuse", async () => {
    const hooks = path.join(repo, ".git", "hooks");
    fs.writeFileSync(path.join(hooks, "pre-commit"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const workspaces = pool();
    const slot = await workspaces.acquire(project(), { sessionId: "s1", branch: "b1" });
    fs.writeFileSync(path.join(slot.path, "new.txt"), "work\n");
    await workspaces.release(project(), slot.index, "s1");
    await workspaces.park(project(), slot.index, "s1");
    expect(git(repo, "log", "-1", "--format=%s", "b1")).toBe("WIP: parked by Pitlane");
  });

  it("acquireDetached checks out the PR head without a branch", async () => {
    const origin = path.join(temp, "origin.git");
    git(repo, "switch", "-q", "-c", "teammate-work");
    fs.writeFileSync(path.join(repo, "theirs.txt"), "their change\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "their change");
    const head = git(repo, "rev-parse", "HEAD");
    git(repo, "push", "-q", "origin", "HEAD:refs/pull/1/head");
    git(repo, "switch", "-q", "main");
    const workspaces = pool();
    const slot = await workspaces.acquireDetached(project(), { sessionId: "r1", fetchRef: "pull/1/head" });
    expect(git(slot.path, "rev-parse", "HEAD")).toBe(head);
    expect(git(slot.path, "branch", "--show-current")).toBe("");
    expect(fs.readFileSync(path.join(slot.path, "theirs.txt"), "utf8")).toBe("their change\n");
    expect(fs.existsSync(origin)).toBe(true);
    expect(await workspaces.release(project(), slot.index, "r1")).toBe("reset");
  });

  it("a review slot runs none of the PR's install scripts and records the head and base it reviews", async () => {
    git(repo, "switch", "-q", "-c", "teammate");
    fs.writeFileSync(path.join(repo, "theirs.txt"), "theirs\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "theirs");
    const head = git(repo, "rev-parse", "HEAD");
    git(repo, "push", "-q", "origin", "HEAD:refs/pull/3/head");
    git(repo, "switch", "-q", "main");
    const prepared: string[] = [];
    const workspaces = createWorkspacePool({ root, store: { get: () => saved, set: (value: Record<string, unknown>) => { saved = value; } }, prepare: async ({ slotPath }: { slotPath: string }) => { prepared.push(slotPath); return { hash: null }; } });
    const slot = await workspaces.acquireDetached(project(), { sessionId: "r1", fetchRef: "pull/3/head", baseRef: "main" });
    expect(prepared).toEqual([]);
    expect(slot.head).toBe(head);
    expect(slot.base).toBe(git(repo, "rev-parse", "origin/main"));
  });

  it("a review slot is always reset in full, leftovers and all, never held", async () => {
    git(repo, "push", "-q", "origin", "HEAD:refs/pull/4/head");
    const workspaces = pool();
    const slot = await workspaces.acquireDetached(project(), { sessionId: "r1", fetchRef: "pull/4/head", baseRef: "main" });
    fs.mkdirSync(path.join(slot.path, ".pitlane"));
    fs.writeFileSync(path.join(slot.path, ".pitlane", "review.json"), "{}");
    fs.writeFileSync(path.join(slot.path, "test-output.log"), "noise");
    expect(await workspaces.release(project(), slot.index, "r1")).toBe("reset");
    expect(fs.existsSync(path.join(slot.path, ".pitlane"))).toBe(false);
    expect(fs.existsSync(path.join(slot.path, "test-output.log"))).toBe(false);
  });
});
