import { describe, expect, it } from "vitest";
import { countLines, parseDiff } from "./diff";

const PATCH = `diff --git a/src/app.ts b/src/app.ts
index 1234567..89abcde 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -10,7 +10,8 @@ export function boot() {
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 const d = 5;
`;

describe("parseDiff", () => {
  it("drops the file headers a reviewer does not read", () => {
    const [hunk] = parseDiff(PATCH);
    expect(hunk.lines.some((line) => line.text.includes("diff --git"))).toBe(false);
    expect(hunk.lines.some((line) => line.text.startsWith("index "))).toBe(false);
  });

  it("keeps the hunk header, which often names the function", () => {
    expect(parseDiff(PATCH)[0].header).toBe("export function boot() {");
  });

  it("classifies each line", () => {
    const [hunk] = parseDiff(PATCH);
    expect(hunk.lines.map((line) => line.kind)).toEqual([
      "context", "removed", "added", "added", "context",
    ]);
  });

  it("numbers both sides so the line numbers line up with the file", () => {
    const [hunk] = parseDiff(PATCH);
    expect(hunk.lines[0]).toMatchObject({ before: 10, after: 10 });
    expect(hunk.lines[1]).toMatchObject({ kind: "removed", before: 11, after: null });
    expect(hunk.lines[2]).toMatchObject({ kind: "added", before: null, after: 11 });
    expect(hunk.lines[4]).toMatchObject({ before: 12, after: 13 });
  });

  it("does not render the no-newline marker as a line of code", () => {
    const hunks = parseDiff("@@ -1 +1 @@\n-a\n+b\n\\ No newline at end of file\n");
    expect(hunks[0].lines).toHaveLength(2);
  });

  it("handles several hunks", () => {
    const hunks = parseDiff("@@ -1,1 +1,1 @@\n-a\n+b\n@@ -50,1 +50,1 @@\n-c\n+d\n");
    expect(hunks).toHaveLength(2);
    expect(hunks[1].lines[0].before).toBe(50);
  });

  it("reads a synthesised all-plus patch for a file git has never seen", () => {
    const hunks = parseDiff("+first\n+second\n");
    expect(hunks).toHaveLength(1);
    expect(hunks[0].lines.map((l) => l.kind)).toEqual(["added", "added"]);
    expect(hunks[0].lines[1].after).toBe(2);
  });

  it("returns nothing for an empty or absent patch", () => {
    expect(parseDiff("")).toEqual([]);
    expect(parseDiff(undefined as unknown as string)).toEqual([]);
    expect(parseDiff("diff --git a/x b/x\nindex 1..2 100644\n")).toEqual([]);
  });

  it("treats a hunk with no counts as one line each side", () => {
    const [hunk] = parseDiff("@@ -3 +3 @@\n-old\n+new\n");
    expect(hunk.lines[0].before).toBe(3);
    expect(hunk.lines[1].after).toBe(3);
  });
});

describe("countLines", () => {
  it("totals across hunks", () => {
    expect(countLines(parseDiff("@@ -1,1 +1,1 @@\n-a\n+b\n@@ -9,1 +9,1 @@\n-c\n+d\n"))).toBe(4);
    expect(countLines([])).toBe(0);
  });
});
