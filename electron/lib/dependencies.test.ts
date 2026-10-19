import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { lockfileHash, prepareDependencies } = require("./dependencies.cjs");

let temp: string;
let project: string;
let slot: string;

function write(dir: string, file: string, text: string) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
}

function fakes() {
  const execs: { cmd: string; args: string[]; cwd: string }[] = [];
  const clones: [string, string][] = [];
  return {
    execs,
    clones,
    exec: async (cmd: string, args: string[], options: { cwd: string }) => { execs.push({ cmd, args, cwd: options.cwd }); },
    clone: async (from: string, to: string) => { clones.push([from, to]); },
  };
}

beforeEach(() => {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "pitlane-deps-"));
  project = path.join(temp, "project");
  slot = path.join(temp, "slot");
  write(project, "package-lock.json", '{"lockfileVersion":3}');
  write(project, "node_modules/left-pad/index.js", "x");
  write(project, "packages/web/package-lock.json", '{"web":1}');
  write(project, "packages/web/node_modules/react/index.js", "x");
  write(slot, "package-lock.json", '{"lockfileVersion":3}');
  write(slot, "packages/web/package-lock.json", '{"web":1}');
});

afterEach(() => fs.rmSync(temp, { recursive: true, force: true }));

describe("dependencies per slot", () => {
  it("matching lockfiles clone node_modules instead of installing", async () => {
    const f = fakes();
    const result = await prepareDependencies({ projectPath: project, slotPath: slot, exec: f.exec, clone: f.clone });
    expect(result.action).toBe("cloned");
    expect(result.hash).toBe(await lockfileHash(project));
    expect(f.clones.sort()).toEqual([
      [path.join(project, "node_modules"), path.join(slot, "node_modules")],
      [path.join(project, "packages/web/node_modules"), path.join(slot, "packages/web/node_modules")],
    ].sort());
    expect(f.execs).toEqual([]);
  });

  it("a different lockfile runs npm ci in the slot", async () => {
    write(slot, "package-lock.json", '{"lockfileVersion":3,"changed":true}');
    const f = fakes();
    const result = await prepareDependencies({ projectPath: project, slotPath: slot, exec: f.exec, clone: f.clone });
    expect(result.action).toBe("installed");
    expect(f.execs).toEqual([{ cmd: "npm", args: ["ci"], cwd: slot }]);
    expect(f.clones).toEqual([]);
  });

  it("pnpm and yarn lockfiles pick their install", async () => {
    for (const [lock, cmd, args] of [["pnpm-lock.yaml", "pnpm", ["install", "--frozen-lockfile"]], ["yarn.lock", "yarn", ["install", "--frozen-lockfile"]]] as const) {
      fs.rmSync(path.join(slot, "package-lock.json"));
      fs.rmSync(path.join(slot, "packages"), { recursive: true, force: true });
      write(slot, lock, `different ${lock}`);
      const f = fakes();
      await prepareDependencies({ projectPath: project, slotPath: slot, exec: f.exec, clone: f.clone });
      expect(f.execs).toEqual([{ cmd, args: [...args], cwd: slot }]);
      fs.rmSync(path.join(slot, lock));
      write(slot, "package-lock.json", "{}");
    }
  });

  it("an unchanged hash does nothing", async () => {
    const f = fakes();
    const hash = await lockfileHash(slot);
    const result = await prepareDependencies({ projectPath: project, slotPath: slot, previousHash: hash, exec: f.exec, clone: f.clone });
    expect(result).toEqual({ hash, action: "unchanged" });
    expect(f.execs).toEqual([]);
    expect(f.clones).toEqual([]);
  });

  it("a project without a lockfile does nothing", async () => {
    const bare = path.join(temp, "bare");
    fs.mkdirSync(bare);
    const f = fakes();
    expect(await prepareDependencies({ projectPath: bare, slotPath: bare, exec: f.exec, clone: f.clone })).toEqual({ hash: null, action: "none" });
  });

  it("the hash ignores lockfiles inside node_modules", async () => {
    const before = await lockfileHash(project);
    write(project, "node_modules/some-dep/package-lock.json", "noise");
    expect(await lockfileHash(project)).toBe(before);
  });
});
