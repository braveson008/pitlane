import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { detectLocalFiles, syncLocalFiles } = require("./localFiles.cjs");

let temp: string;
let project: string;
let slot: string;

beforeEach(() => {
  temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pitlane-local-")));
  project = path.join(temp, "project");
  slot = path.join(temp, "slot");
  fs.mkdirSync(path.join(project, "sub"), { recursive: true });
  fs.mkdirSync(slot);
  execFileSync("git", ["init", "-q"], { cwd: project });
  fs.writeFileSync(path.join(project, ".gitignore"), ".env*\n!.env.example\n*.local.*\n");
  fs.writeFileSync(path.join(project, ".env"), "SECRET=1\n");
  fs.writeFileSync(path.join(project, ".env.local"), "LOCAL=1\n");
  fs.writeFileSync(path.join(project, ".env.example"), "SECRET=\n");
  fs.writeFileSync(path.join(project, "sub", ".env"), "NESTED=1\n");
  fs.writeFileSync(path.join(project, "app.local.json"), "{}\n");
  execFileSync("git", ["add", ".gitignore", ".env.example"], { cwd: project });
});

afterEach(() => fs.rmSync(temp, { recursive: true, force: true }));

describe("local files", () => {
  it("detects ignored env files at the root only", async () => {
    expect(await detectLocalFiles(project)).toEqual([".env", ".env.local", "app.local.json"]);
  });

  it("copies, never symlinks", async () => {
    expect(await syncLocalFiles(project, slot, [".env"])).toEqual([".env"]);
    expect(fs.lstatSync(path.join(slot, ".env")).isFile()).toBe(true);
    expect(fs.readFileSync(path.join(slot, ".env"), "utf8")).toBe("SECRET=1\n");
  });

  it("recopies only when the original is newer", async () => {
    await syncLocalFiles(project, slot, [".env"]);
    expect(await syncLocalFiles(project, slot, [".env"])).toEqual([]);
    fs.writeFileSync(path.join(project, ".env"), "SECRET=2\n");
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(path.join(project, ".env"), later, later);
    expect(await syncLocalFiles(project, slot, [".env"])).toEqual([".env"]);
    expect(fs.readFileSync(path.join(slot, ".env"), "utf8")).toBe("SECRET=2\n");
  });

  it("skips a listed file that no longer exists", async () => {
    expect(await syncLocalFiles(project, slot, [".env.gone", ".env"])).toEqual([".env"]);
  });

  it("never copies through a symlink that leaves the project", async () => {
    fs.writeFileSync(path.join(temp, "outside"), "private\n");
    fs.symlinkSync(path.join(temp, "outside"), path.join(project, ".env.link"));
    expect(await syncLocalFiles(project, slot, [".env.link", "../outside"])).toEqual([]);
    expect(fs.existsSync(path.join(slot, ".env.link"))).toBe(false);
  });
});
