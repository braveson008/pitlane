import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { hookSettings, watchAgentEvents } = require("./agentEvents.cjs");

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "pitlane-events-")); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const hookScript = path.join(process.cwd(), "electron", "agentHook.cjs");

describe("agent hook events", () => {
  it("hook settings run the hook script for Notification and Stop", () => {
    const settings = JSON.parse(hookSettings({ sessionId: "s1", node: "/usr/bin/node", hookScript }));
    for (const event of ["Notification", "Stop"]) {
      const command = settings.hooks[event][0].hooks[0];
      expect(command.type).toBe("command");
      expect(command.command).toBe(`'/usr/bin/node' '${hookScript}' 's1' '${event}'`);
    }
  });

  it("the app's own executable runs the hook as Node, without that leaking into the agent", () => {
    const settings = JSON.parse(hookSettings({ sessionId: "s1", node: "/Applications/Pitlane.app/Contents/MacOS/Pitlane", hookScript, asNode: true }));
    expect(settings.hooks.Stop[0].hooks[0].command).toBe(`ELECTRON_RUN_AS_NODE=1 '/Applications/Pitlane.app/Contents/MacOS/Pitlane' '${hookScript}' 's1' 'Stop'`);
  });

  it("the hook appends one line per event", () => {
    const env = { ...process.env, PITLANE_EVENTS_DIR: dir };
    execFileSync("node", [hookScript, "s1", "Notification"], { env, input: JSON.stringify({ message: "Claude needs your permission to use Bash" }) });
    execFileSync("node", [hookScript, "s1", "Stop"], { env, input: "{}" });
    const lines = fs.readFileSync(path.join(dir, "s1.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(lines.map((line) => line.event)).toEqual(["Notification", "Stop"]);
    expect(lines[0].message).toBe("Claude needs your permission to use Bash");
  });

  it("the watcher reports only new lines", async () => {
    fs.writeFileSync(path.join(dir, "s1.jsonl"), `${JSON.stringify({ event: "Stop", at: 1 })}\n`);
    const seen: { sessionId: string; event: string }[] = [];
    const stop = watchAgentEvents(dir, (sessionId: string, event: { event: string }) => seen.push({ sessionId, event: event.event }));
    try {
      fs.appendFileSync(path.join(dir, "s1.jsonl"), `${JSON.stringify({ event: "Notification", at: 2 })}\n`);
      fs.writeFileSync(path.join(dir, "s2.jsonl"), `${JSON.stringify({ event: "Stop", at: 3 })}\n`);
      await expect.poll(() => seen.length, { timeout: 3000 }).toBe(2);
      expect(seen).toEqual(expect.arrayContaining([{ sessionId: "s1", event: "Notification" }, { sessionId: "s2", event: "Stop" }]));
    } finally {
      stop();
    }
  });
});
