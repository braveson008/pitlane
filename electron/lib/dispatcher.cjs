/**
 * Starts queued tickets, oldest first, while the app is under its cap of unattended agents. A project
 * whose workspaces are all busy is skipped for this tick without fuss; the next tick tries again.
 */
const PRIORITY = { review: 0, feedback: 1 };
const rank = (ticket) => PRIORITY[ticket.priority] ?? 2;

function createDispatcher({ projects, book, start, running, maxAgents, now = Date.now }) {
  let pausedUntil = null;
  let ticking = null;

  async function run() {
    if (pausedUntil && now() < pausedUntil) return [];
    pausedUntil = null;
    const started = [];
    const blocked = new Set();
    const candidates = projects().flatMap((project) => book.list(project.id)
      .filter((ticket) => ticket.state === "queued")
      .map((ticket) => ({ project, ticket })))
      // Teammates are waiting on reviews, and feedback is on work already in review; both go before new tickets.
      .sort((a, b) => rank(a.ticket) - rank(b.ticket) || a.ticket.firstSeenAt - b.ticket.firstSeenAt);
    for (const { project, ticket } of candidates) {
      if (running() >= maxAgents()) break;
      if (blocked.has(project.id)) continue;
      const result = await start(project, ticket).catch((error) => ({ ok: false, error: error.message }));
      if (result.ok) {
        book.set(project.id, ticket.key, { state: "working", sessionId: result.sessionId, ...(result.branch ? { branch: result.branch } : {}) });
        started.push(ticket.key);
      } else if (result.busy) {
        blocked.add(project.id);
      } else {
        book.set(project.id, ticket.key, { state: "needs-you", reason: result.error || "could not start" });
      }
    }
    return started;
  }

  return {
    // One tick at a time, so a timer tick and an event-driven one never start the same ticket.
    tick() {
      ticking ??= run().finally(() => { ticking = null; });
      return ticking;
    },
    pause(untilMs) { pausedUntil = untilMs; },
    pausedUntil: () => (pausedUntil && now() < pausedUntil ? pausedUntil : null),
  };
}

module.exports = { createDispatcher };
