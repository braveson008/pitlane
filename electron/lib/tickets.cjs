// One record per ticket key per project, kept even when it drops out of the list. A key is queued once: a done ticket that comes back
// assigned is not new work, and re-queueing it would open a second PR for it.
function createTicketBook({ store, now = Date.now }) {
  let all = store.get() || {};
  const save = () => store.set(all);
  const of = (projectId) => (all[projectId] ||= []);
  const find = (projectId, key) => of(projectId).find((ticket) => ticket.key === key);
  const empties = {};

  return {
    list: (projectId) => of(projectId).map((ticket) => ({ ...ticket })),
    observe(projectId, tasks, { baseline, limit = 25, kind }) {
      const at = now();
      // Ticket and review watches share the book; each poll judges only the records of its own kind.
      const mine = (ticket) => !kind || (kind === "review") === String(ticket.key).startsWith("review:");
      const valid = tasks.filter((task) => typeof task.id === "string" && task.id.trim());
      const emptyKey = `${projectId}\0${kind || ""}`;
      const active = of(projectId).some((ticket) => mine(ticket) && ["queued", "not-started", "working"].includes(ticket.state));
      // An empty answer while tickets are active is as likely a tracker that failed quietly as a cleared
      // board; it is believed only when the next poll says the same.
      if (!valid.length && active) {
        empties[emptyKey] = (empties[emptyKey] || 0) + 1;
        if (empties[emptyKey] < 2) return { queued: [], dropped: [], flagged: [] };
      } else {
        empties[emptyKey] = 0;
      }
      const seen = new Set(valid.map((task) => task.id));
      const queued = [];
      for (const task of valid) {
        const existing = find(projectId, task.id);
        if (existing) {
          Object.assign(existing, { title: task.title || existing.title, url: task.url || existing.url });
          // Back in the list after dropping out: it resumes where it was, it is not new work.
          if (existing.state === "dropped") Object.assign(existing, { state: existing.previousState || "not-started", updatedAt: at });
          continue;
        }
        const ticket = {
          key: task.id,
          title: task.title,
          description: task.description || "",
          url: task.url || "",
          state: baseline || task.pr?.trusted === false ? "not-started" : "queued",
          ...(task.pr ? { pr: task.pr, priority: "review" } : {}),
          firstSeenAt: at,
          updatedAt: at,
        };
        of(projectId).push(ticket);
        if (!baseline) queued.push({ ...ticket });
      }
      const dropped = [];
      const flagged = [];
      const gone = [];
      // A full page may simply have pushed older items past its end, so only a shorter answer counts as complete.
      const complete = valid.length < limit;
      for (const ticket of of(projectId)) {
        if (seen.has(ticket.key) || !complete || !mine(ticket)) continue;
        if (ticket.state === "queued" || ticket.state === "not-started") {
          Object.assign(ticket, { previousState: ticket.state, state: "dropped", updatedAt: at });
          dropped.push(ticket.key);
        } else if (ticket.state === "working") {
          Object.assign(ticket, { state: "needs-you", reason: "unassigned", updatedAt: at });
          flagged.push(ticket.key);
        } else if (ticket.state === "done" && kind === "review") {
          // A review request disappears once answered; when it comes back it has been asked for again.
          gone.push(ticket);
        }
      }
      if (gone.length) all[projectId] = of(projectId).filter((ticket) => !gone.includes(ticket));
      save();
      return { queued, dropped, flagged };
    },
    next(projectId) {
      const waiting = of(projectId).filter((ticket) => ticket.state === "queued").sort((a, b) => a.firstSeenAt - b.firstSeenAt);
      return waiting[0] ? { ...waiting[0] } : undefined;
    },
    get: (projectId, key) => {
      const ticket = find(projectId, key);
      return ticket ? { ...ticket } : undefined;
    },
    set(projectId, key, patch) {
      const ticket = find(projectId, key);
      if (!ticket) throw new Error(`No ticket ${key}`);
      Object.assign(ticket, patch, { updatedAt: now() });
      save();
      return { ...ticket };
    },
  };
}

module.exports = { createTicketBook };
