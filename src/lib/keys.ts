export type HomeAction = "open" | "new" | "theme" | "help" | "up" | "down" | "park" | "limit" | "changes" | "watches" | "openPr" | "stop" | "clear" | "assigned";

const HOME: Record<string, HomeAction> = {
  Enter: "open", n: "new", t: "theme", "?": "help", j: "down", k: "up", ArrowDown: "down", ArrowUp: "up", x: "park", L: "limit", c: "changes", w: "watches", p: "openPr", s: "stop", C: "clear", a: "assigned",
};

/** Home screen keys are single keys; chords belong to the system and the session view. */
export function homeKey(event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey">): HomeAction | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  return HOME[event.key] ?? null;
}

export type SessionAction = "home" | "switcher" | "prev" | "next" | "changes";

/** Inside a session every key belongs to the agent except these ⌘ chords; Esc interrupts Claude, so it is never ours. */
export function sessionKey(event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey">): SessionAction | null {
  if (!event.metaKey || event.ctrlKey) return null;
  if (event.altKey) {
    if (event.key === "ArrowLeft") return "prev";
    if (event.key === "ArrowRight") return "next";
    return null;
  }
  if (event.key === "ArrowUp") return "home";
  if (event.key === "k") return "switcher";
  if (event.key === "d") return "changes";
  return null;
}

export type ChangesAction = "keep" | "revert" | "revertHunk" | "keepAll" | "revertAll" | "nextFile" | "prevFile" | "nextHunk" | "prevHunk" | "back";

// k is keep, so moving up through files is the arrow only; j still moves down for the home-row habit.
const CHANGES: Record<string, ChangesAction> = {
  k: "keep", r: "revert", R: "revertHunk", K: "keepAll", X: "revertAll",
  j: "nextFile", ArrowDown: "nextFile", ArrowUp: "prevFile", J: "nextHunk", ArrowRight: "nextHunk", ArrowLeft: "prevHunk",
  Escape: "back",
};

/** No terminal has focus in the Changes view, so Esc belongs to the app here. */
export function changesKey(event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey">): ChangesAction | null {
  if (event.metaKey && !event.altKey && !event.ctrlKey && event.key === "d") return "back";
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  return CHANGES[event.key] ?? null;
}

export type DraftAction = "approve" | "edit" | "verdict" | "dropComment" | "discard" | "back" | "down" | "up";

const DRAFT: Record<string, DraftAction> = { a: "approve", e: "edit", v: "verdict", x: "dropComment", d: "discard", Escape: "back", j: "down", ArrowDown: "down", k: "up", ArrowUp: "up" };

export function draftKey(event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey">): DraftAction | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  return DRAFT[event.key] ?? null;
}
