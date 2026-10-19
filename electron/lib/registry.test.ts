import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createRegistry } = require("./registry.cjs");

let temp: string;
let repo: string;
let file: string;

function makeRepo(dir: string, content = "a\n") {
  fs.mkdirSync(dir, { recursive: true });
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.email=a@b", "-c", "user.name=t", ...args], { cwd: dir });
  git("init", "-q", "-b", "main");
  fs.writeFileSync(path.join(dir, "a.txt"), content);
  git("add", "-A");
  git("commit", "-qm", "root");
  return dir;
}

beforeEach(() => {
  temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pitlane-registry-")));
  repo = makeRepo(path.join(temp, "shop"));
  file = path.join(temp, "registry.json");
});

afterEach(() => fs.rmSync(temp, { recursive: true, force: true }));

describe("project registry", () => {
  it("add registers a repo with its root commit and real path", async () => {
    const link = path.join(temp, "link");
    fs.symlinkSync(repo, link);
    const project = await createRegistry({ file }).add(link);
    expect(project.path).toBe(fs.realpathSync(repo));
    expect(project.name).toBe("shop");
    expect(project.rootCommit).toBe(execFileSync("git", ["rev-list", "--max-parents=0", "HEAD"], { cwd: repo, encoding: "utf8" }).trim());
    expect(project.trunk).toBe("main");
    expect(project.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("every watch has an id, including ones saved before watches had them", async () => {
    fs.writeFileSync(file, JSON.stringify({ projects: [{ id: "p1", path: repo, watches: [{ kind: "review-requested", intervalSeconds: 300 }] }] }));
    const registry = createRegistry({ file });
    expect(registry.get("p1").watches[0].id).toMatch(/^w-/);
    registry.update("p1", { watches: [{ kind: "ticket-assigned", server: "linear", intervalSeconds: 300 }] });
    expect(registry.get("p1").watches[0].id).toMatch(/^w-/);
  });

  it("add twice returns the same id", async () => {
    const registry = createRegistry({ file });
    const first = await registry.add(repo);
    const second = await registry.add(repo);
    expect(second.id).toBe(first.id);
    expect(registry.list()).toHaveLength(1);
  });

  it("add rejects a plain folder", async () => {
    const plain = path.join(temp, "plain");
    fs.mkdirSync(plain);
    await expect(createRegistry({ file }).add(plain)).rejects.toThrow(/Not a git repository/);
  });

  it("status is missing after the folder is removed", async () => {
    const registry = createRegistry({ file });
    const project = await registry.add(repo);
    expect(await registry.status(project.id)).toBe("ok");
    fs.rmSync(repo, { recursive: true, force: true });
    expect(await registry.status(project.id)).toBe("missing");
  });

  it("locate accepts the same repository at a new path and keeps the id", async () => {
    const registry = createRegistry({ file });
    const project = await registry.add(repo);
    const clone = path.join(temp, "moved");
    execFileSync("git", ["clone", "-q", repo, clone]);
    fs.rmSync(repo, { recursive: true, force: true });
    const located = await registry.locate(project.id, clone);
    expect(located.id).toBe(project.id);
    expect(located.path).toBe(fs.realpathSync(clone));
    expect(await registry.status(project.id)).toBe("ok");
  });

  it("locate rejects a different repository", async () => {
    const registry = createRegistry({ file });
    const project = await registry.add(repo);
    const other = makeRepo(path.join(temp, "other"), "different\n");
    await expect(registry.locate(project.id, other)).rejects.toThrow("That folder is a different repository");
  });

  it("state survives a new registry instance on the same file", async () => {
    const project = await createRegistry({ file }).add(repo);
    const reopened = createRegistry({ file });
    expect(reopened.get(project.id)).toEqual(project);
    expect(reopened.update(project.id, { theme: "acme" }).theme).toBe("acme");
    expect(createRegistry({ file }).get(project.id).theme).toBe("acme");
  });
});
