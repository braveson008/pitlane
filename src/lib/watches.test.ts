import { describe, expect, it } from "vitest";
import { INTERVALS, MODELS, overlapNote, watchSource, watchTitle } from "./watches";

describe("watch labels", () => {
  it("say what each watch looks for, in words", () => {
    expect(watchTitle({ kind: "ticket-assigned" })).toBe("Tickets assigned to me");
    expect(watchTitle({ kind: "review-requested" })).toBe("PRs that need my review");
  });

  it("name where it looks: the tracker server, or gh / glab for reviews", () => {
    expect(watchSource({ kind: "ticket-assigned", server: "atlassian" }, {})).toBe("atlassian");
    expect(watchSource({ kind: "review-requested" }, {})).toBe("gh");
    expect(watchSource({ kind: "review-requested" }, { github: { kind: "gitlab" } })).toBe("glab");
  });

  it("offer the same choices main accepts", () => {
    expect(INTERVALS).toEqual([300, 600, 1800, 3600]);
    expect(MODELS).toEqual(["sonnet", "haiku", "opus"]);
  });

  it("say which projects get the same tickets and what fixes it", () => {
    expect(overlapNote(["admin"])).toBe("admin gets these same tickets · set only from to this project's Jira key or Linear team");
    expect(overlapNote(["a", "b"])).toMatch(/^a and b get these same tickets/);
    expect(overlapNote(["admin"], "SHOP")).toBe("admin gets these same tickets · set only from to SHOP");
  });
});
