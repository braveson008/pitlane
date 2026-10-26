import type { WatchKind } from "../api";

// The same lists as electron/lib/watchEdits.cjs, which refuses anything else.
export const INTERVALS = [300, 600, 1800, 3600] as const;
export const MODELS = ["sonnet", "haiku", "opus"] as const;

export function watchTitle(watch: { kind: WatchKind | string; instructions?: string }) {
  if (watch.kind === "ticket-assigned") return watch.instructions ? "Tickets I describe" : "Tickets assigned to me";
  if (watch.kind === "review-requested") return "PRs that need my review";
  return watch.kind;
}

export function watchSource(watch: { kind: WatchKind | string; server?: string }, project: { github?: { kind?: string } }) {
  if (watch.kind === "review-requested") return project.github?.kind === "gitlab" ? "glab" : "gh";
  const alias = /^(?:braveli|pitwall)_(atlassian|jira|linear)_[0-9a-f]+$/.exec(watch.server ?? "");
  if (alias) return `${alias[1]} · Pitwall login`;
  return watch.server ?? "no server";
}

export function overlapNote(names: string[], suggested = "") {
  const who = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)} get` : `${names[0]} gets`;
  return `${who} these same tickets · set only from to ${suggested || "this project's Jira key or Linear team"}`;
}

/** What narrows a watch, for its row: its scope and the start of its instructions. */
export function watchNotes(watch: { scope?: string; instructions?: string }) {
  const words = watch.instructions && watch.instructions.length > 60 ? `${watch.instructions.slice(0, 59)}…` : watch.instructions;
  return `${watch.scope ? ` · only ${watch.scope}` : ""}${words ? ` · “${words}”` : ""}`;
}
