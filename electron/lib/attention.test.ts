import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { needsYou } = require("./attention.cjs");

describe("what needs the owner in a project", () => {
  it("counts tickets waiting on them and running agents asking a question", () => {
    const tickets = ["needs-you", "review-ready", "plan-ready", "queued", "working", "in-review", "not-started"].map((state, index) => ({ key: `T-${index}`, state }));
    const sessions = [
      { id: "a", state: "running", attention: "asks" },
      { id: "b", state: "running" },
      { id: "c", state: "exited", attention: "asked before it ended" },
      { id: "d", state: "failed" },
    ];
    expect(needsYou({ tickets, sessions })).toBe(4);
  });

  it("is nothing for a quiet project", () => {
    expect(needsYou({ tickets: [], sessions: [] })).toBe(0);
  });
});
