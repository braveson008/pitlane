import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ensureClaudeTrust } = require("./claudeTrust.cjs");

let home: string;
beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), "pitlane-trust-")); });
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));
const config = () => JSON.parse(fs.readFileSync(path.join(home, ".claude.json"), "utf8"));

describe("Claude folder trust for workspaces", () => {
  it("marks a workspace trusted so Claude starts without its trust screen", () => {
    fs.writeFileSync(path.join(home, ".claude.json"), JSON.stringify({ numStartups: 4, projects: { "/other": { allowedTools: ["Read"] } } }));
    expect(ensureClaudeTrust("/ws/p/1", home)).toBe(true);
    expect(config().projects["/ws/p/1"]).toMatchObject({ hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true });
    expect(config().projects["/other"]).toEqual({ allowedTools: ["Read"] });
    expect(config().numStartups).toBe(4);
  });

  it("keeps what Claude already recorded for the folder and writes nothing when already trusted", () => {
    fs.writeFileSync(path.join(home, ".claude.json"), JSON.stringify({ projects: { "/ws/p/1": { hasTrustDialogAccepted: true, lastSessionId: "x" } } }));
    const before = fs.statSync(path.join(home, ".claude.json")).mtimeMs;
    expect(ensureClaudeTrust("/ws/p/1", home)).toBe(false);
    expect(fs.statSync(path.join(home, ".claude.json")).mtimeMs).toBe(before);
  });

  it("does nothing before Claude has ever run", () => {
    expect(ensureClaudeTrust("/ws/p/1", home)).toBe(false);
    expect(fs.existsSync(path.join(home, ".claude.json"))).toBe(false);
  });
});
