import { describe, expect, it } from "vitest";
import { homeKey, planKey, projectKey } from "./keys";

const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({ key: k, metaKey: false, ctrlKey: false, altKey: false, ...mods }) as KeyboardEvent;

describe("home keys", () => {
  it("enter opens and n starts a new session", () => {
    expect(homeKey(key("Enter"))).toBe("open");
    expect(homeKey(key("n"))).toBe("new");
    expect(homeKey(key("t"))).toBe("theme");
    expect(homeKey(key("?"))).toBe("help");
  });

  it("X deletes the selected session in one press; d and L mean nothing", () => {
    expect(homeKey(key("X"))).toBe("delete");
    expect(homeKey(key("d"))).toBeNull();
    expect(homeKey(key("L"))).toBeNull();
  });

  it("r runs the project's watches now", () => {
    expect(homeKey(key("r"))).toBe("runWatches");
  });

  it("j and k move like the arrows", () => {
    expect(homeKey(key("j"))).toBe("down");
    expect(homeKey(key("ArrowDown"))).toBe("down");
    expect(homeKey(key("k"))).toBe("up");
    expect(homeKey(key("ArrowUp"))).toBe("up");
  });

  it("c opens the selected session's changes", () => {
    expect(homeKey(key("c"))).toBe("changes");
  });

  it("w opens the watches, p opens a PR, s stops an agent, C clears ended sessions, a shows what is not started", () => {
    expect(homeKey(key("w"))).toBe("watches");
    expect(homeKey(key("p"))).toBe("openPr");
    expect(homeKey(key("s"))).toBe("stop");
    expect(homeKey(key("C", { shiftKey: true } as Partial<KeyboardEvent>))).toBe("clear");
    expect(homeKey(key("a"))).toBe("assigned");
    expect(homeKey(key("U", { shiftKey: true } as Partial<KeyboardEvent>))).toBe("update");
    expect(homeKey(key(" "))).toBeNull();
  });

  it("x parks a held session", () => {
    expect(homeKey(key("x"))).toBe("park");
  });

  it("chords are ignored on home", () => {
    expect(homeKey(key("k", { metaKey: true }))).toBeNull();
    expect(homeKey(key("n", { ctrlKey: true }))).toBeNull();
    expect(homeKey(key("z"))).toBeNull();
  });
});

import { sessionKey } from "./keys";

describe("session keys", () => {
  it("cmd-up goes home", () => {
    expect(sessionKey(key("ArrowUp", { metaKey: true }))).toBe("home");
    expect(sessionKey(key("ArrowUp"))).toBeNull();
  });

  it("cmd-k opens the switcher", () => {
    expect(sessionKey(key("k", { metaKey: true }))).toBe("switcher");
  });

  it("option-cmd arrows move between sessions", () => {
    expect(sessionKey(key("ArrowLeft", { metaKey: true, altKey: true }))).toBe("prev");
    expect(sessionKey(key("ArrowRight", { metaKey: true, altKey: true }))).toBe("next");
    expect(sessionKey(key("d", { metaKey: true }))).toBe("changes");
  });

  it("escape is not an app key in a session", () => {
    expect(sessionKey(key("Escape"))).toBeNull();
    expect(sessionKey(key("k"))).toBeNull();
    expect(sessionKey(key("c", { ctrlKey: true }))).toBeNull();
  });
});

import { changesKey } from "./keys";

describe("changes keys", () => {
  it("keep, revert and the hunk revert", () => {
    expect(changesKey(key("k"))).toBe("keep");
    expect(changesKey(key("r"))).toBe("revert");
    expect(changesKey(key("R", { shiftKey: true } as Partial<KeyboardEvent>))).toBe("revertHunk");
    expect(changesKey(key("K", { shiftKey: true } as Partial<KeyboardEvent>))).toBe("keepAll");
    expect(changesKey(key("X", { shiftKey: true } as Partial<KeyboardEvent>))).toBe("revertAll");
  });

  it("moves between files and hunks", () => {
    expect(changesKey(key("j"))).toBe("nextFile");
    expect(changesKey(key("ArrowDown"))).toBe("nextFile");
    expect(changesKey(key("ArrowUp"))).toBe("prevFile");
    expect(changesKey(key("J", { shiftKey: true } as Partial<KeyboardEvent>))).toBe("nextHunk");
  });

  it("escape and cmd-d go back", () => {
    expect(changesKey(key("Escape"))).toBe("back");
    expect(changesKey(key("d", { metaKey: true }))).toBe("back");
    expect(changesKey(key("q"))).toBeNull();
  });
});

import { draftKey } from "./keys";

describe("draft keys", () => {
  it("approve, edit, verdict, drop a comment, discard and back", () => {
    expect(draftKey(key("a"))).toBe("approve");
    expect(draftKey(key("e"))).toBe("edit");
    expect(draftKey(key("v"))).toBe("verdict");
    expect(draftKey(key("x"))).toBe("dropComment");
    expect(draftKey(key("d"))).toBe("discard");
    expect(draftKey(key("Escape"))).toBe("back");
    expect(draftKey(key("j"))).toBe("down");
    expect(draftKey(key("a", { metaKey: true }))).toBeNull();
  });
});

describe("plan keys", () => {
  it("start work, discard, scroll and back", () => {
    expect(planKey(key("s"))).toBe("start");
    expect(planKey(key("d"))).toBe("discard");
    expect(planKey(key("Escape"))).toBe("back");
    expect(planKey(key("j"))).toBe("down");
    expect(planKey(key("k"))).toBe("up");
    expect(planKey(key("s", { metaKey: true }))).toBeNull();
  });
});

describe("projectKey", () => {
  it("⌘1 to ⌘9 pick the project in that place", () => {
    expect(projectKey(key("1", { metaKey: true }))).toBe(0);
    expect(projectKey(key("9", { metaKey: true }))).toBe(8);
  });

  it("leaves digits without ⌘, ⌘0, and other chords alone", () => {
    expect(projectKey(key("1"))).toBeNull();
    expect(projectKey(key("0", { metaKey: true }))).toBeNull();
    expect(projectKey(key("1", { metaKey: true, altKey: true }))).toBeNull();
    expect(projectKey(key("1", { metaKey: true, ctrlKey: true }))).toBeNull();
    expect(projectKey(key("k", { metaKey: true }))).toBeNull();
  });
});
