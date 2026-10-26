import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createLiveChanges, snapshot, changesBetween, watchTree } = require("./liveChanges.cjs");

type Summary = { ok: boolean; files: { path: string; from: string | null; status: string; additions: number; deletions: number }[]; additions: number; deletions: number; error?: string };

let repo: string;
let store: string;
const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
const write = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  fs.writeFileSync(path.join(repo, file), text);
};
const read = (file: string) => fs.readFileSync(path.join(repo, file), "utf8");
const exists = (file: string) => fs.existsSync(path.join(repo, file));

// Refreshes on demand rather than on file events, so each test decides when the panel looks.
const manualWatch = () => () => {};

function hub() {
  return createLiveChanges({ storePath: store, watch: manualWatch });
}

async function look(changes: ReturnType<typeof hub>, sessionId = "s1"): Promise<Summary> {
  return changes.refresh(sessionId);
}

beforeEach(() => {
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pitlane-live-")));
  store = path.join(repo, "..", `${path.basename(repo)}-store.json`);
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  write(".gitignore", "node_modules\n");
  write("a.txt", "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n");
  write("b.txt", "bee\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  write("dirty.txt", "already here before the agent\n");
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(store, { force: true });
});

describe("live changes", () => {
  it("keeps only the starting points of sessions that still exist", async () => {
    const changes = hub();
    await changes.start("s1", repo);
    await changes.start("s2", repo);
    expect(changes.retain(new Set(["s2"]))).toBe(1);
    const saved = JSON.parse(fs.readFileSync(store, "utf8"));
    expect(Object.keys(saved)).toEqual(["s2"]);
  });

  it("shows only what changed after the session started, including new, deleted and committed work", async () => {
    const changes = hub();
    await changes.start("s1", repo);
    const unsubscribe = changes.subscribe("s1", repo, () => {});

    write("a.txt", read("a.txt").replace("two", "TWO"));
    write("new/file.ts", "export {};\n");
    fs.rmSync(path.join(repo, "b.txt"));
    write("node_modules/x/index.js", "ignored\n");
    git("add", "a.txt");
    git("commit", "-qm", "agent commit");

    const summary = await look(changes);
    expect(summary.ok).toBe(true);
    expect(summary.files.map((file) => [file.path, file.status]).sort()).toEqual([
      ["a.txt", "modified"],
      ["b.txt", "deleted"],
      ["new/file.ts", "added"],
    ]);
    expect(summary.additions).toBe(2);
    expect(summary.deletions).toBe(2);
    unsubscribe();
  });

  it("never touches the agent's own index", async () => {
    write("staged.txt", "staged\n");
    git("add", "staged.txt");
    const before = git("diff", "--cached", "--name-only");

    const changes = hub();
    await changes.start("s1", repo);
    write("later.txt", "later\n");
    changes.subscribe("s1", repo, () => {});
    await look(changes);

    expect(git("diff", "--cached", "--name-only")).toBe(before);
    expect(git("status", "--porcelain")).toContain("?? later.txt");
  });

  it("reverts a whole file back to its starting point, restoring or removing it", async () => {
    const changes = hub();
    await changes.start("s1", repo);
    changes.subscribe("s1", repo, () => {});
    write("a.txt", "rewritten\n");
    write("added.txt", "new\n");
    fs.rmSync(path.join(repo, "dirty.txt"));

    const summary = await look(changes);
    for (const file of summary.files) await changes.revert("s1", file);

    expect(read("a.txt")).toContain("two\nthree");
    expect(exists("added.txt")).toBe(false);
    expect(read("dirty.txt")).toBe("already here before the agent\n");
    expect((await look(changes)).files).toEqual([]);
  });

  it("reverts one hunk and leaves the others", async () => {
    const changes = hub();
    await changes.start("s1", repo);
    changes.subscribe("s1", repo, () => {});
    write("a.txt", read("a.txt").replace("one", "ONE").replace("ten", "TEN"));

    const [file] = (await look(changes)).files;
    const { hunks } = await changes.fileDiff("s1", file);
    expect(hunks).toHaveLength(2);
    await changes.revert("s1", file, hunks[0]);

    expect(read("a.txt").startsWith("one\n")).toBe(true);
    expect(read("a.txt")).toContain("TEN");
  });

  it("refuses a hunk that has moved on instead of guessing", async () => {
    const changes = hub();
    await changes.start("s1", repo);
    changes.subscribe("s1", repo, () => {});
    write("a.txt", read("a.txt").replace("one", "ONE"));
    const [file] = (await look(changes)).files;
    const { hunks } = await changes.fileDiff("s1", file);
    write("a.txt", read("a.txt").replace("ONE", "UNO"));

    await expect(changes.revert("s1", file, hunks[0])).rejects.toThrow(/moved on/);
    expect(read("a.txt").startsWith("UNO")).toBe(true);
  });

  it("keeps a file, or everything, so it stops showing as changed", async () => {
    const changes = hub();
    await changes.start("s1", repo);
    changes.subscribe("s1", repo, () => {});
    write("a.txt", "kept\n");
    write("c.txt", "see\n");

    const summary = await look(changes);
    await changes.keep("s1", summary.files.find((file) => file.path === "a.txt"));
    expect((await look(changes)).files.map((file) => file.path)).toEqual(["c.txt"]);

    await changes.keep("s1");
    expect((await look(changes)).files).toEqual([]);
    expect(read("a.txt")).toBe("kept\n");
  });

  it("remembers a session's starting point across restarts", async () => {
    await hub().start("s1", repo);
    write("b.txt", "changed while closed\n");

    const reopened = hub();
    reopened.subscribe("s1", repo, () => {});
    expect((await look(reopened)).files.map((file) => file.path)).toEqual(["b.txt"]);
  });

  it("works from a subfolder of the repository", async () => {
    write("pkg/inner.txt", "x\n");
    git("add", "-A");
    git("commit", "-qm", "pkg");
    const changes = hub();
    const sub = path.join(repo, "pkg");
    await changes.start("s1", sub);
    changes.subscribe("s1", sub, () => {});
    write("pkg/inner.txt", "y\n");

    const [file] = (await look(changes)).files;
    expect(file.path).toBe("pkg/inner.txt");
    await changes.revert("s1", file);
    expect(read("pkg/inner.txt")).toBe("x\n");
  });

  it("says so when the folder is not a git repository", async () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), "pitlane-plain-"));
    try {
      const changes = hub();
      changes.subscribe("s2", plain, () => {});
      const summary = await changes.refresh("s2");
      expect(summary.ok).toBe(false);
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });

  it("reports renames once, with where they came from", async () => {
    const base = await snapshot(repo);
    git("mv", "a.txt", "moved.txt");
    const { files } = await changesBetween(repo, base, await snapshot(repo));
    expect(files).toEqual([expect.objectContaining({ path: "moved.txt", from: "a.txt", status: "renamed" })]);
  });

  it("notices edits within a moment, and not ones inside ignored folders", async () => {
    let fired = 0;
    const stop = watchTree(repo, () => { fired += 1; }, { debounceMs: 50 });
    try {
      // Events for the setup's own writes can arrive late; count from here.
      await new Promise((resolve) => setTimeout(resolve, 300));
      fired = 0;
      write("node_modules/pkg/index.js", "noise\n");
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(fired).toBe(0);
      write("a.txt", "edited\n");
      await expect.poll(() => fired, { timeout: 2000 }).toBeGreaterThan(0);
    } finally {
      stop();
    }
  });
});
