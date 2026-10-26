import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { readDraft, changedLines, postDraft } = require("./reviewDraft.cjs");

let slot: string;
const changed = new Map([["src/cart.ts", new Set([10, 11, 12])]]);
const write = (value: unknown) => {
  fs.mkdirSync(path.join(slot, ".pitlane"), { recursive: true });
  fs.writeFileSync(path.join(slot, ".pitlane", "review.json"), typeof value === "string" ? value : JSON.stringify(value));
};

beforeEach(() => { slot = fs.mkdtempSync(path.join(os.tmpdir(), "pitlane-draft-")); });
afterEach(() => fs.rmSync(slot, { recursive: true, force: true }));

describe("review drafts", () => {
  it("a valid review file becomes a draft", () => {
    write({ summary: "Looks good, one nit.", verdict: "approve", comments: [{ path: "src/cart.ts", line: 11, body: "Name this `total`." }] });
    expect(readDraft(slot, changed)).toEqual({ ok: true, draft: { summary: "Looks good, one nit.", verdict: "approve", comments: [{ path: "src/cart.ts", line: 11, body: "Name this `total`.", onDiff: true }] } });
  });

  it("a review file older than the session is not this review's", () => {
    write({ summary: "Left over from another PR.", verdict: "approve", comments: [] });
    expect(readDraft(slot, changed, { since: Date.now() + 60_000 })).toEqual({ ok: false, error: "the review file is older than this review" });
    expect(readDraft(slot, changed, { since: Date.now() - 60_000 }).ok).toBe(true);
    expect(readDraft(slot, changed, { own: true }).draft.verdict).toBe("comment");
  });

  it("comments off the diff are kept but marked", () => {
    write({ summary: "s", verdict: "comment", comments: [{ path: "src/cart.ts", line: 99, body: "x" }, { path: "README.md", line: 1, body: "y" }] });
    expect(readDraft(slot, changed).draft.comments.map((comment: { onDiff: boolean }) => comment.onDiff)).toEqual([false, false]);
  });

  it("a missing or malformed file is an error that names what is wrong", () => {
    expect(readDraft(slot, changed)).toEqual({ ok: false, error: "the agent wrote no .pitlane/review.json" });
    write("{ nope");
    expect(readDraft(slot, changed)).toEqual({ ok: false, error: ".pitlane/review.json is not valid JSON" });
    write({ verdict: "approve", comments: [] });
    expect(readDraft(slot, changed)).toEqual({ ok: false, error: ".pitlane/review.json has no summary" });
  });

  it("an unknown verdict becomes comment, and malformed comments are skipped", () => {
    write({ summary: "s", verdict: "LGTM!!", comments: [{ path: "src/cart.ts", line: "11", body: "ok" }, { path: "", line: 3, body: "no path" }, "junk"] });
    const { draft } = readDraft(slot, changed);
    expect(draft.verdict).toBe("comment");
    expect(draft.comments).toEqual([{ path: "src/cart.ts", line: 11, body: "ok", onDiff: true }]);
  });

  it("changedLines reads the new-side lines of the diff", async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pitlane-diff-"));
    const git = (...args: string[]) => execFileSync("git", ["-c", "user.email=a@b", "-c", "user.name=t", ...args], { cwd: repo, encoding: "utf8" });
    git("init", "-q", "-b", "main");
    fs.writeFileSync(path.join(repo, "a.txt"), "1\n2\n3\n4\n");
    git("add", "-A");
    git("commit", "-qm", "base");
    git("switch", "-q", "-c", "pr");
    fs.writeFileSync(path.join(repo, "a.txt"), "1\nTWO\n3\n4\nfive\n");
    git("commit", "-qam", "change");
    const lines = await changedLines(repo, "main");
    expect([...lines.get("a.txt")].sort()).toEqual([2, 5]);
    fs.rmSync(repo, { recursive: true, force: true });
  });

  const draft = { summary: "One nit.", verdict: "request-changes", comments: [{ path: "src/cart.ts", line: 11, body: "Rename.", onDiff: true }, { path: "README.md", line: 1, body: "Off diff.", onDiff: false }] };
  const recording = (answers: Record<string, string>) => {
    const calls: { cmd: string; args: string[]; input?: string }[] = [];
    const exec = async (cmd: string, args: string[], options: { input?: string }) => {
      calls.push({ cmd, args, input: options?.input });
      const key = Object.keys(answers).find((prefix) => [cmd, ...args].join(" ").startsWith(prefix));
      return key ? answers[key] : "";
    };
    return { calls, exec };
  };

  it("posts one GitHub review with inline comments on the reviewed commit", async () => {
    const { calls, exec } = recording({ "gh pr view 42": '{"state":"OPEN"}', "gh api": '{"html_url":"https://github.com/acme/shop/pull/42#pullrequestreview-1"}' });
    const result = await postDraft({ cwd: "/s", kind: "github", repo: "acme/shop", pr: { number: 42 }, draft, sha: "abc123", exec });
    expect(result).toEqual({ ok: true, url: "https://github.com/acme/shop/pull/42#pullrequestreview-1" });
    const post = calls.find((call) => call.cmd === "gh" && call.args[0] === "api")!;
    expect(post.args).toEqual(["api", "repos/acme/shop/pulls/42/reviews", "-X", "POST", "--input", "-"]);
    expect(JSON.parse(post.input!)).toEqual({ commit_id: "abc123", event: "REQUEST_CHANGES", body: "One nit.", comments: [{ path: "src/cart.ts", line: 11, side: "RIGHT", body: "Rename." }] });
  });

  it("a review of the owner's own PR is posted as a comment, whatever the verdict", async () => {
    const { calls, exec } = recording({ "gh pr view 50": '{"state":"OPEN"}', "gh api": "{}" });
    await postDraft({ cwd: "/s", kind: "github", repo: "acme/shop", pr: { number: 50, own: true }, draft: { ...draft, verdict: "approve" }, sha: "abc", exec });
    expect(JSON.parse(calls.find((call) => call.args[0] === "api")!.input!).event).toBe("COMMENT");
    const gitlab = recording({ "glab mr view 9": '{"state":"opened"}' });
    await postDraft({ cwd: "/s", kind: "gitlab", pr: { number: 9, own: true }, draft: { ...draft, verdict: "approve" }, sha: "abc", exec: gitlab.exec });
    expect(gitlab.calls.some((call) => call.args[1] === "approve")).toBe(false);
  });

  it("a merged PR is not posted to", async () => {
    const { calls, exec } = recording({ "gh pr view 42": '{"state":"MERGED"}' });
    expect(await postDraft({ cwd: "/s", kind: "github", repo: "acme/shop", pr: { number: 42 }, draft, sha: "abc", exec })).toEqual({ ok: false, error: "the PR was merged — nothing posted" });
    expect(calls.some((call) => call.args[0] === "api")).toBe(false);
  });

  it("GitLab posts a note and approves only when the verdict is approve", async () => {
    const first = recording({ "glab mr view 7": '{"state":"opened"}' });
    await postDraft({ cwd: "/s", kind: "gitlab", pr: { number: 7 }, draft, sha: "abc", exec: first.exec });
    const note = first.calls.find((call) => call.args[1] === "note")!;
    expect(note.args.slice(0, 4)).toEqual(["mr", "note", "7", "-m"]);
    expect(note.args[4]).toContain("One nit.");
    expect(note.args[4]).toContain("src/cart.ts:11 — Rename.");
    expect(note.args[4]).not.toContain("Off diff.");
    expect(first.calls.some((call) => call.args[1] === "approve")).toBe(false);
    const second = recording({ "glab mr view 7": '{"state":"opened"}' });
    await postDraft({ cwd: "/s", kind: "gitlab", pr: { number: 7 }, draft: { ...draft, verdict: "approve" }, sha: "abc", exec: second.exec });
    expect(second.calls.some((call) => call.args[1] === "approve" && call.args[2] === "7")).toBe(true);
  });

  it("GitLab: when the note posted but the approval failed, a retry only approves", async () => {
    const calls: string[][] = [];
    let approveFails = true;
    const exec = async (cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      if (args[1] === "view") return '{"state":"opened"}';
      if (args[1] === "approve" && approveFails) throw new Error("approval rules");
      return "";
    };
    const approved = { ...draft, verdict: "approve" };
    const first = await postDraft({ cwd: "/s", kind: "gitlab", pr: { number: 7 }, draft: approved, sha: "abc", exec });
    expect(first).toMatchObject({ ok: false, notePosted: true });
    approveFails = false;
    await postDraft({ cwd: "/s", kind: "gitlab", pr: { number: 7 }, draft: { ...approved, notePosted: true }, sha: "abc", exec });
    expect(calls.filter((call) => call[2] === "note")).toHaveLength(1);
    expect(calls.filter((call) => call[2] === "approve")).toHaveLength(2);
  });

  it("GitHub: after a failed post, a review already on that commit counts as posted", async () => {
    const calls: string[][] = [];
    const exec = async (cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      if (args[0] === "pr") return '{"state":"OPEN"}';
      if (args[0] === "api" && args.includes("POST")) throw new Error("timed out");
      if (args[0] === "api" && args[1] === "user") return "owner\n";
      return JSON.stringify([{ user: { login: "owner" }, commit_id: "abc123", html_url: "https://github.com/acme/shop/pull/42#pullrequestreview-9" }]);
    };
    const result = await postDraft({ cwd: "/s", kind: "github", repo: "acme/shop", pr: { number: 42 }, draft, sha: "abc123", exec });
    expect(result).toEqual({ ok: true, url: "https://github.com/acme/shop/pull/42#pullrequestreview-9" });
    expect(calls.some((call) => call[1] === "pr" && call.includes("--repo") && call.includes("acme/shop"))).toBe(true);
  });
});
