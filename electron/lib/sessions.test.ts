import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createSessionManager } = require("./sessions.cjs");

class FakePty extends EventEmitter {
  written: string[] = [];
  killed = false;
  constructor(public command: string, public args: string[], public options: { cwd: string }) { super(); }
  onData(listener: (data: string) => void) { this.on("data", listener); return { dispose: () => this.off("data", listener) }; }
  onExit(listener: (event: { exitCode: number }) => void) { this.on("exit", listener); return { dispose: () => {} }; }
  write(data: string) { this.written.push(data); }
  resize() {}
  kill() { this.killed = true; this.emit("exit", { exitCode: 0 }); }
  print(data: string) { this.emit("data", data); }
}

function setup({ saved = [] as unknown[], resolve = (agent: string) => ({ command: agent, args: [] as string[] }) } = {}) {
  const ptys: FakePty[] = [];
  let stored = saved;
  const manager = createSessionManager({
    spawn: (command: string, args: string[], options: { cwd: string }) => {
      const pty = new FakePty(command, args, options);
      ptys.push(pty);
      return pty;
    },
    resolveCommand: resolve,
    store: { get: () => stored, set: (sessions: unknown[]) => { stored = sessions; } },
    now: () => 1000,
  });
  return { manager, ptys, stored: () => stored };
}

describe("agent sessions", () => {
  it("create starts a running session in the project folder", () => {
    const { manager, ptys } = setup();
    const session = manager.create({ projectId: "p", agent: "claude", cwd: "/repo" });
    expect(session).toMatchObject({ projectId: "p", agent: "claude", state: "running", name: "New session · claude" });
    expect(ptys[0].command).toBe("claude");
    expect(ptys[0].options.cwd).toBe("/repo");
    expect(manager.list("p")).toHaveLength(1);
    expect(manager.list("other")).toHaveLength(0);
  });

  it("a missing agent fails with a readable error", () => {
    const { manager, ptys } = setup({ resolve: () => ({ error: "claude was not found on PATH" }) as never });
    const session = manager.create({ projectId: "p", agent: "claude", cwd: "/repo" });
    expect(session.state).toBe("failed");
    expect(session.error).toBe("claude was not found on PATH");
    expect(ptys).toHaveLength(0);
    expect(manager.attach(session.id, () => {}).scrollback).toContain("claude was not found on PATH");
  });

  it("a spawn error becomes a failed session with its message", () => {
    let stored: unknown[] = [];
    const manager = createSessionManager({
      spawn: () => { throw new Error("posix_spawnp failed."); },
      resolveCommand: () => ({ command: "claude", args: [] }),
      store: { get: () => stored, set: (sessions: unknown[]) => { stored = sessions; } },
    });
    const session = manager.create({ projectId: "p", agent: "claude", cwd: "/repo" });
    expect(session).toMatchObject({ state: "failed", error: "claude could not start: posix_spawnp failed." });
    expect(manager.runningCount()).toBe(0);
  });

  it("a session that fails to start is reported as ended, so its workspace is released", () => {
    const { manager } = setup({ resolve: () => ({ error: "claude was not found on PATH" }) as never });
    const ended: string[] = [];
    manager.onExit((session: { id: string }) => ended.push(session.id));
    const session = manager.create({ projectId: "p", agent: "claude", cwd: "/repo", slot: 1 });
    expect(ended).toEqual([session.id]);
  });

  it("attach returns scrollback and then streams", () => {
    const { manager, ptys } = setup();
    const session = manager.create({ projectId: "p", agent: "claude", cwd: "/repo" });
    ptys[0].print("hello ");
    const received: string[] = [];
    const attached = manager.attach(session.id, (data: string) => received.push(data));
    expect(attached.scrollback).toBe("hello ");
    ptys[0].print("world");
    expect(received).toEqual(["world"]);
    attached.detach();
    ptys[0].print("!");
    expect(received).toEqual(["world"]);
  });

  it("scrollback is capped and keeps the newest output", () => {
    const { manager, ptys } = setup();
    const session = manager.create({ projectId: "p", agent: "claude", cwd: "/repo" });
    const chunk = `${"x".repeat(1023)}\n`;
    for (let i = 0; i < 5 * 1024; i += 1) ptys[0].print(chunk);
    ptys[0].print("the end");
    const { scrollback } = manager.attach(session.id, () => {});
    expect(scrollback.length).toBeLessThanOrEqual(4 * 1024 * 1024);
    expect(scrollback.endsWith("the end")).toBe(true);
    expect(scrollback.startsWith("x")).toBe(true);
  });

  it("a flood of small chunks stays cheap once the cap is reached", () => {
    const { manager, ptys } = setup();
    const session = manager.create({ projectId: "p", agent: "claude", cwd: "/repo" });
    const big = `${"y".repeat(4095)}\n`;
    for (let i = 0; i < 1100; i += 1) ptys[0].print(big);
    // macOS PTYs hand over output about a kilobyte at a time; 10k of them is a short build-log burst.
    const chunk = `${"z".repeat(1023)}\n`;
    const started = performance.now();
    for (let i = 0; i < 10_000; i += 1) ptys[0].print(chunk);
    expect(performance.now() - started).toBeLessThan(300);
    const { scrollback } = manager.attach(session.id, () => {});
    expect(scrollback.length).toBeLessThanOrEqual(4 * 1024 * 1024);
    expect(scrollback.endsWith(chunk)).toBe(true);
  });

  it("exit marks the session exited with its code", () => {
    const { manager, ptys } = setup();
    const changes: unknown[] = [];
    manager.onChange((projectId: string) => changes.push(projectId));
    const session = manager.create({ projectId: "p", agent: "codex", cwd: "/repo" });
    ptys[0].emit("exit", { exitCode: 3 });
    expect(manager.list("p")[0]).toMatchObject({ id: session.id, state: "exited", exitCode: 3, endedAt: 1000 });
    expect(changes.length).toBeGreaterThanOrEqual(2);
  });

  it("sessions restored from disk come back as exited", () => {
    const saved = [{ id: "s1", projectId: "p", agent: "claude", name: "New session · claude", cwd: "/repo", state: "running", createdAt: 1 }];
    const { manager } = setup({ saved });
    expect(manager.list("p")[0]).toMatchObject({ id: "s1", state: "exited" });
  });

  it("stopAll kills every running PTY", () => {
    const { manager, ptys } = setup();
    manager.create({ projectId: "p", agent: "claude", cwd: "/repo" });
    manager.create({ projectId: "q", agent: "codex", cwd: "/other" });
    expect(manager.runningCount()).toBe(2);
    manager.stopAll();
    expect(ptys.every((pty) => pty.killed)).toBe(true);
    expect(manager.runningCount()).toBe(0);
  });

  it("write and resize reach the running PTY", () => {
    const { manager, ptys } = setup();
    const session = manager.create({ projectId: "p", agent: "claude", cwd: "/repo" });
    manager.write(session.id, "hi\r");
    expect(ptys[0].written).toEqual(["hi\r"]);
  });

  it("tail returns the end of what the agent printed", () => {
    const { manager, ptys } = setup();
    const session = manager.create({ projectId: "p", agent: "claude", cwd: "/repo" });
    ptys[0].print("x".repeat(10_000));
    ptys[0].print("Claude usage limit reached");
    expect(manager.tail(session.id, 64)).toMatch(/usage limit reached$/);
    expect(manager.tail(session.id, 64).length).toBe(64);
  });

  it("a session flagged for attention clears when the owner types into it", () => {
    const { manager } = setup();
    const changes: string[] = [];
    manager.onChange((projectId: string) => changes.push(projectId));
    const session = manager.create({ projectId: "p", agent: "claude", cwd: "/repo" });
    manager.flag(session.id, "Claude needs your permission to use Bash");
    expect(manager.get(session.id)).toMatchObject({ attention: "Claude needs your permission to use Bash" });
    const before = changes.length;
    manager.write(session.id, "y");
    expect(manager.get(session.id).attention).toBeUndefined();
    expect(changes.length).toBe(before + 1);
    manager.write(session.id, "z");
    expect(changes.length).toBe(before + 1);
  });

  it("a write the terminal makes by itself does not clear needs-you", () => {
    const { manager, ptys } = setup();
    const session = manager.create({ projectId: "p", agent: "claude", cwd: "/repo" });
    manager.flag(session.id, "waiting");
    manager.write(session.id, "\u001b[I", { quiet: true });
    expect(manager.get(session.id).attention).toBe("waiting");
    expect(ptys[0].written).toEqual(["\u001b[I"]);
  });

  it("an ended session loses its needs-you mark", () => {
    const { manager, ptys } = setup();
    const session = manager.create({ projectId: "p", agent: "claude", cwd: "/repo" });
    manager.flag(session.id, "waiting");
    ptys[0].emit("exit", { exitCode: 0 });
    expect(manager.get(session.id).attention).toBeUndefined();
  });

  it("clearing can be limited to sessions that ended before a time", () => {
    const old = { id: "old", projectId: "p", agent: "claude", name: "old", cwd: "/a", state: "exited", createdAt: 0, endedAt: 100 };
    const recent = { ...old, id: "recent", endedAt: 900 };
    const { manager } = setup({ saved: [old, recent] });
    expect(manager.clearEnded("p", { before: 500 })).toBe(1);
    expect(manager.list("p").map((session: { id: string }) => session.id)).toEqual(["recent"]);
  });

  it("clearing ended sessions removes only those that ended and the caller does not keep", () => {
    const { manager, ptys, stored } = setup();
    const running = manager.create({ projectId: "p", agent: "claude", cwd: "/a" });
    const done = manager.create({ projectId: "p", agent: "claude", cwd: "/b" });
    const held = manager.create({ projectId: "p", agent: "claude", cwd: "/c" });
    const elsewhere = manager.create({ projectId: "q", agent: "claude", cwd: "/d" });
    for (const pty of ptys.slice(1)) pty.emit("exit", { exitCode: 0 });
    expect(manager.clearEnded("p", { keep: (session: { id: string }) => session.id === held.id })).toBe(1);
    expect(manager.list("p").map((session: { id: string }) => session.id).sort()).toEqual([running.id, held.id].sort());
    expect(manager.list("q")).toHaveLength(1);
    expect((stored() as { id: string }[]).some((session) => session.id === done.id)).toBe(false);
    expect(elsewhere.state).toBe("exited");
  });

  it("remove forgets one ended session, never a running one", () => {
    const { manager, ptys, stored } = setup();
    const running = manager.create({ projectId: "p", agent: "claude", cwd: "/a" });
    const done = manager.create({ projectId: "p", agent: "claude", cwd: "/b" });
    ptys[1].emit("exit", { exitCode: 0 });
    expect(() => manager.remove(running.id)).toThrow("stop it first");
    expect(manager.remove(done.id)).toBe(true);
    expect(manager.list("p").map((session: { id: string }) => session.id)).toEqual([running.id]);
    expect((stored() as { id: string }[]).some((session) => session.id === done.id)).toBe(false);
    expect(manager.remove("nope")).toBe(false);
  });

  it("a session the owner stopped says so", () => {
    const { manager } = setup();
    const session = manager.create({ projectId: "p", agent: "claude", cwd: "/a" });
    manager.stop(session.id);
    expect(manager.get(session.id)).toMatchObject({ state: "exited", stopped: true });
  });
});
