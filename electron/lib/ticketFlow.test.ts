import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { afterTurn, afterPlanTurn, wantsWork, ownsPlan, afterRestart, usageLimitHit, isTerminalReply } = require("./ticketFlow.cjs");

describe("what a ticket session's turn means", () => {
  it("an open PR at the end of a turn means review: the idle agent is ended so its slot frees", () => {
    expect(afterTurn({ pr: { url: "u", state: "open" }, tail: "" })).toEqual({ state: "in-review", prUrl: "u", end: true });
  });

  it("a merged or closed PR at the end of a turn is done", () => {
    expect(afterTurn({ pr: { url: "u", state: "merged" }, tail: "" })).toEqual({ state: "done", prUrl: "u", end: true });
  });

  it("no PR yet after a turn changes nothing; the agent may still be working or asking", () => {
    expect(afterTurn({ pr: null, tail: "Now running the tests…" })).toBeNull();
  });

  it("a PR wins over limit-looking words in the agent's own work", () => {
    expect(afterTurn({ pr: { url: "u", state: "open" }, tail: "feat: add rate limit retries; try again later" })).toMatchObject({ state: "in-review" });
  });

  it("a real usage-limit banner with no PR pauses", () => {
    expect(afterTurn({ pr: null, tail: "\u001b[31mClaude usage limit reached. Your limit will reset at 4pm\u001b[0m" })).toEqual({ pause: true });
  });
});

describe("planning or work", () => {
  it("a fresh ticket is planned; an approved one, one with feedback, or one with a branch is worked on", () => {
    expect(wantsWork({ key: "A-1" })).toBe(false);
    expect(wantsWork({ key: "A-1", approved: true })).toBe(true);
    expect(wantsWork({ key: "A-1", priority: "feedback" })).toBe(true);
    expect(wantsWork({ key: "A-1", branch: "a-1-x" })).toBe(true);
  });

  it("a planning turn with a plan is ready; a limit banner without one pauses; otherwise nothing changes", () => {
    expect(afterPlanTurn({ planned: true, tail: "" })).toEqual({ state: "plan-ready" });
    expect(afterPlanTurn({ planned: false, tail: "Claude usage limit reached. Your limit will reset at 4pm" })).toEqual({ pause: true });
    expect(afterPlanTurn({ planned: false, tail: "Reading the code…" })).toBeNull();
  });
});

describe("a planning session and its ticket", () => {
  it("the plan still belongs to the ticket while it plans, or waits on the owner after the planner asked", () => {
    expect(ownsPlan({ state: "planning", sessionId: "s1" }, "s1")).toBe(true);
    expect(ownsPlan({ state: "needs-you", sessionId: "s1" }, "s1")).toBe(true);
    expect(ownsPlan({ state: "needs-you", sessionId: "s2" }, "s1")).toBe(false);
    expect(ownsPlan({ state: "plan-ready", sessionId: "s1" }, "s1")).toBe(false);
    expect(ownsPlan(undefined, "s1")).toBe(false);
  });

  it("after a restart, work in flight needs the owner and a plan in flight is made again", () => {
    expect(afterRestart({ state: "working" })).toEqual({ state: "needs-you", reason: "Pitlane was closed while it worked" });
    expect(afterRestart({ state: "planning", sessionId: "s1" })).toEqual({ state: "queued", sessionId: undefined });
    expect(afterRestart({ state: "plan-ready" })).toBeNull();
  });
});

describe("usage limit banners", () => {
  it("recognises the CLIs' own banners, ANSI codes and all", () => {
    expect(usageLimitHit("\u001b[1mClaude usage limit reached\u001b[0m · resets 4pm")).toBe(true);
    expect(usageLimitHit("You've hit your usage limit. Upgrade or try again in 2 hours.")).toBe(true);
    expect(usageLimitHit("5-hour limit reached ∙ resets 11pm")).toBe(true);
  });

  it("does not fire on ordinary work about limits", () => {
    expect(usageLimitHit("Implemented rate limit middleware; retry limit reached in test; try again later")).toBe(false);
  });

  it("only reads the end of the output", () => {
    expect(usageLimitHit(`Claude usage limit reached${"x".repeat(2000)}`)).toBe(false);
  });
});

describe("terminal replies", () => {
  it("replies the terminal sends by itself are not the owner typing", () => {
    for (const reply of ["\u001b[I", "\u001b[O", "\u001b[?1;2c", "\u001b[12;40R", "\u001b]11;rgb:0a0a/0a0a/0808\u0007", "\u001b]10;rgb:ffff/ffff/ffff\u001b\\"]) {
      expect(isTerminalReply(reply), JSON.stringify(reply)).toBe(true);
    }
    for (const typed of ["y", "\r", "\u001b[A", "\u001b", "hello"]) expect(isTerminalReply(typed), JSON.stringify(typed)).toBe(false);
  });
});
