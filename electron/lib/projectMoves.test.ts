import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { carryMovedProjects, claudeProjectFolder } = require("./projectMoves.cjs");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createRegistry } = require("./registry.cjs");

let home: string;
let oldPath: string;
let realPath: string;

const readConfig = () => JSON.parse(fs.readFileSync(path.join(home, ".claude.json"), "utf8"));

beforeEach(() => {
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pitlane-moves-")));
  realPath = path.join(home, "Desktop - Mac", "Work", "shop");
  fs.mkdirSync(realPath, { recursive: true });
  fs.mkdirSync(path.join(home, "Desktop"));
  fs.symlinkSync(path.dirname(realPath), path.join(home, "Desktop", "Work"));
  oldPath = path.join(home, "Desktop", "Work", "shop");
  fs.writeFileSync(path.join(home, ".claude.json"), JSON.stringify({
    projects: {
      [oldPath]: { hasTrustDialogAccepted: true, allowedTools: ["Bash(git:*)"], mcpServers: { atlassian: { type: "http" }, figma: { type: "http" } } },
      [realPath]: { allowedTools: ["Read"], mcpServers: { figma: { type: "stdio" } }, lastSessionId: "new" },
    },
  }));
  const transcripts = path.join(home, ".claude", "projects", claudeProjectFolder(oldPath));
  fs.mkdirSync(transcripts, { recursive: true });
  fs.writeFileSync(path.join(transcripts, "one.jsonl"), "{}\n");
});

afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

describe("carrying a moved project's Claude state", () => {
  it("gives the new path the MCP servers, trust and transcripts of the old one", async () => {
    expect(await carryMovedProjects({ moves: [{ from: oldPath, to: realPath }], home })).toEqual([realPath]);
    const carried = readConfig().projects[realPath];
    expect(carried.mcpServers).toEqual({ atlassian: { type: "http" }, figma: { type: "stdio" } });
    expect(carried.allowedTools).toEqual(["Bash(git:*)", "Read"]);
    expect(carried).toMatchObject({ hasTrustDialogAccepted: true, lastSessionId: "new" });
    expect(fs.readFileSync(path.join(home, ".claude", "projects", claudeProjectFolder(realPath), "one.jsonl"), "utf8")).toBe("{}\n");
  });

  it("does nothing the second time, or for a path that did not move", async () => {
    await carryMovedProjects({ moves: [{ from: oldPath, to: realPath }], home });
    const before = fs.readFileSync(path.join(home, ".claude.json"), "utf8");
    expect(await carryMovedProjects({ moves: [{ from: oldPath, to: realPath }, { from: realPath, to: realPath }], home })).toEqual([]);
    expect(fs.readFileSync(path.join(home, ".claude.json"), "utf8")).toBe(before);
  });

  it("carries a move once, so something removed later is not brought back", async () => {
    const done = new Set<string>();
    const store = { has: (key: string) => done.has(key), add: (key: string) => { done.add(key); } };
    await carryMovedProjects({ moves: [{ from: oldPath, to: realPath }], home, store });
    const config = readConfig();
    delete config.projects[realPath].mcpServers.atlassian;
    config.projects[realPath].allowedTools = ["Read"];
    fs.writeFileSync(path.join(home, ".claude.json"), JSON.stringify(config));
    expect(await carryMovedProjects({ moves: [{ from: oldPath, to: realPath }], home, store })).toEqual([]);
    expect(readConfig().projects[realPath].mcpServers.atlassian).toBeUndefined();
    expect(readConfig().projects[realPath].allowedTools).toEqual(["Read"]);
  });

  it("is quiet when Claude has never run", async () => {
    fs.rmSync(path.join(home, ".claude.json"));
    expect(await carryMovedProjects({ moves: [{ from: oldPath, to: realPath }], home })).toEqual([realPath]);
  });

  it("locate records the old path so its Claude config follows", async () => {
    const repo = path.join(home, "repo");
    fs.mkdirSync(repo);
    const git = (...args: string[]) => execFileSync("git", ["-c", "user.email=a@b", "-c", "user.name=t", ...args], { cwd: repo });
    git("init", "-q", "-b", "main");
    fs.writeFileSync(path.join(repo, "a"), "a");
    git("add", "-A");
    git("commit", "-qm", "x");
    const registry = createRegistry({ file: path.join(home, "registry.json") });
    const project = await registry.add(repo);
    const moved = path.join(home, "moved");
    fs.renameSync(repo, moved);
    const located = await registry.locate(project.id, moved);
    expect(located.previousPaths).toEqual([repo]);
  });
});
