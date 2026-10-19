import type { WatchKind } from "../api";

// The same lists as electron/lib/watchEdits.cjs, which refuses anything else.
export const INTERVALS = [300, 600, 1800, 3600] as const;
export const MODELS = ["sonnet", "haiku", "opus"] as const;

export function watchTitle(watch: { kind: WatchKind | string }) {
  if (watch.kind === "ticket-assigned") return "Tickets assigned to me";
  if (watch.kind === "review-requested") return "PRs that need my review";
  return watch.kind;
}

export function watchSource(watch: { kind: WatchKind | string; server?: string }, project: { github?: { kind?: string } }) {
  if (watch.kind === "review-requested") return project.github?.kind === "gitlab" ? "glab" : "gh";
  return watch.server ?? "no server";
}
