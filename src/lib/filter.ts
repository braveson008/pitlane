import type { Session } from "../api";

/** Case-insensitive subsequence match on name and agent; spaces in the query are ignored. */
export function filterSessions(sessions: Session[], query: string): Session[] {
  const wanted = query.toLowerCase().replace(/\s+/g, "");
  if (!wanted) return sessions;
  return sessions.filter((session) => {
    const text = `${session.name} ${session.agent}`.toLowerCase();
    let at = 0;
    for (const char of text) {
      if (char === wanted[at]) at += 1;
      if (at === wanted.length) return true;
    }
    return false;
  });
}
