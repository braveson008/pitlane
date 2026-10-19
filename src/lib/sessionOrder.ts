import type { Session } from "../api";

const DAY = 24 * 3600_000;
const RANK: Record<Session["state"], number> = { running: 0, failed: 1, exited: 2 };

// Waiting on the owner beats everything: it will sit there until somebody looks.
const rank = (session: Session) => (session.attention ? -1 : RANK[session.state]);

/** Needs-you first, then running, then failed, then what finished in the last day; newest first within each. */
export function orderSessions(sessions: Session[], now: number): Session[] {
  return sessions
    .filter((session) => session.state !== "exited" || now - (session.endedAt ?? session.createdAt) < DAY)
    .sort((a, b) => rank(a) - rank(b) || b.createdAt - a.createdAt);
}

export function sessionMarker(session: Session): "!" | "*" | " " {
  if (session.state === "failed" || session.attention) return "!";
  return session.state === "running" ? "*" : " ";
}

export function ago(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

export function stateLabel(session: Session): string {
  if (session.state === "running") return "running";
  if (session.state === "failed") return "failed";
  return `exited ${session.exitCode ?? ""}`.trim();
}
