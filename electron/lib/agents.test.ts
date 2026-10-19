import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { resolveCommand, agentEnv } = require("./agents.cjs");

let temp: string;
beforeEach(() => { temp = fs.mkdtempSync(path.join(os.tmpdir(), "pitlane-agents-")); });
afterEach(() => fs.rmSync(temp, { recursive: true, force: true }));

describe("agent commands", () => {
  it("resolveCommand finds a command in one of the usual bin folders", () => {
    const bin = path.join(temp, "opt", "homebrew", "bin");
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, "claude"), "#!/bin/sh\n", { mode: 0o755 });
    const resolved = resolveCommand("claude", { PATH: "/nowhere" }, [bin]);
    expect(resolved).toEqual({ command: path.join(bin, "claude"), args: [] });
  });

  it("says which command is missing", () => {
    expect(resolveCommand("codex", { PATH: temp }, [])).toEqual({ error: "codex was not found on PATH" });
  });

  it("PITLANE_AGENT_COMMAND overrides in tests", () => {
    const env = { PATH: "", PITLANE_E2E: "1", PITLANE_AGENT_COMMAND: JSON.stringify(["node", "fake-agent.mjs"]) };
    expect(resolveCommand("claude", env, [])).toEqual({ command: "node", args: ["fake-agent.mjs"] });
  });

  it("ignores the override outside tests", () => {
    const env = { PATH: temp, PITLANE_AGENT_COMMAND: JSON.stringify(["node", "x"]) };
    expect(resolveCommand("claude", env, [])).toEqual({ error: "claude was not found on PATH" });
  });

  it("rejects an unknown agent", () => {
    expect(resolveCommand("gemini", { PATH: temp }, [])).toEqual({ error: "Unknown agent: gemini" });
  });

  it("agentEnv gives the agent the usual bin folders, so a Dock launch can find node", () => {
    const env = agentEnv({ PATH: "/usr/bin:/bin", HOME: "/Users/me" }, ["/opt/homebrew/bin", "/usr/local/bin"]);
    expect(env.PATH.split(":")).toEqual(["/usr/bin", "/bin", "/opt/homebrew/bin", "/usr/local/bin"]);
    expect(env.HOME).toBe("/Users/me");
    expect(agentEnv({ PATH: "/opt/homebrew/bin:/bin" }, ["/opt/homebrew/bin"]).PATH).toBe("/opt/homebrew/bin:/bin");
  });

  it("agents start as their own Claude session, not a child of whatever launched Pitlane", () => {
    const env = agentEnv({ PATH: "/bin", CLAUDECODE: "1", CLAUDE_CODE_CHILD_SESSION: "abc", CLAUDE_CODE_ENTRYPOINT: "cli", CLAUDE_CODE_USE_BEDROCK: "1", ANTHROPIC_MODEL: "keep-me" }, []);
    expect(env.CLAUDECODE).toBeUndefined();
    expect(env.CLAUDE_CODE_CHILD_SESSION).toBeUndefined();
    expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
    expect(env.ANTHROPIC_MODEL).toBe("keep-me");
    expect(env.CLAUDE_CODE_USE_BEDROCK).toBe("1");
  });
});
