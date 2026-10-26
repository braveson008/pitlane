import { describe, expect, it } from "vitest";
import { markdownLines } from "./markdown";

describe("markdownLines", () => {
  it("marks headings and drops their hashes", () => {
    expect(markdownLines("# Title\n## Approach")).toEqual([
      { kind: "heading", parts: [{ kind: "text", text: "Title" }] },
      { kind: "heading", parts: [{ kind: "text", text: "Approach" }] },
    ]);
  });

  it("splits code spans and bold out of a line, keeping the rest as text", () => {
    expect(markdownLines("The **work** is in `a.ts` now")).toEqual([
      { kind: "text", parts: [
        { kind: "text", text: "The " }, { kind: "bold", text: "work" }, { kind: "text", text: " is in " },
        { kind: "code", text: "a.ts" }, { kind: "text", text: " now" },
      ] },
    ]);
  });

  it("keeps fenced blocks verbatim and hides the fences", () => {
    expect(markdownLines("```json\n{ \"a\": `x` }\n```\nafter")).toEqual([
      { kind: "code", parts: [{ kind: "text", text: "{ \"a\": `x` }" }] },
      { kind: "text", parts: [{ kind: "text", text: "after" }] },
    ]);
  });

  it("leaves an unclosed marker as plain text", () => {
    expect(markdownLines("a ** b ` c")).toEqual([{ kind: "text", parts: [{ kind: "text", text: "a ** b ` c" }] }]);
  });
});
