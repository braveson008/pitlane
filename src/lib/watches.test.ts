import { describe, expect, it } from "vitest";
import { INTERVALS, MODELS, overlapNote, watchSource, watchTitle, watchNotes } from "./watches";

describe("watch labels", () => {
  it("say what each watch looks for, in words", () => {
    expect(watchTitle({ kind: "ticket-assigned" })).toBe("Tickets assigned to me");
    expect(watchTitle({ kind: "review-requested" })).toBe("PRs that need my review");
  });

  it("a watch with the owner's instructions is titled by them, and its row quotes their start", () => {
    expect(watchTitle({ kind: "ticket-assigned", instructions: "bugs" })).toBe("Tickets I describe");
    expect(watchNotes({ scope: "SHOP", instructions: "unassigned bugs" })).toBe(" · only SHOP · “unassigned bugs”");
    expect(watchNotes({ instructions: "y".repeat(80) })).toBe(` · “${"y".repeat(59)}…”`);
    expect(watchNotes({})).toBe("");
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

  it("name a project's own tracker sign-in by its tracker", () => {
    expect(watchSource({ kind: "ticket-assigned", server: "braveli_atlassian_43f69b5aad" }, {})).toBe("atlassian · Pitwall login");
    expect(watchSource({ kind: "ticket-assigned", server: "pitwall_linear_3eb8a846c6" }, {})).toBe("linear · Pitwall login");
    expect(watchSource({ kind: "ticket-assigned", server: "atlassian" }, {})).toBe("atlassian");
  });
});
