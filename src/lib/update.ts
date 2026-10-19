import type { UpdateState } from "../api";

/** The status line's note about a new version: quiet unless one is downloading or ready. */
export function updateLabel(state: UpdateState | null): { text: string; ready: boolean } | null {
  if (state?.status === "downloading") return { text: `downloading ${state.version}${state.percent ? ` · ${state.percent}%` : ""}`, ready: false };
  if (state?.status === "ready") return { text: `${state.version} ready · U restart to update`, ready: true };
  return null;
}
