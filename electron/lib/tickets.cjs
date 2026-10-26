// One record per ticket key per project, kept even when it drops out of the list. A key is queued once: a done ticket that comes back
// assigned is not new work, and re-queueing it would open a second PR for it.
function createTicketBook({ store, now = Date.now }) {
  let all = store.get() || {};
  const save = () => store.set(all);
  const of = (projectId) => (all[projectId] ||= []);
  const find = (projectId, key) => of(projectId).find((ticket) => ticket.key === key);
  const empties = {};
  const tracked = (task) => ({ ...(task.status ? { status: task.status } : {}), ...(task.stage ? { stage: task.stage } : {}) });

  return {
    list: (projectId) => of(projectId).map((ticket) => ({ ...ticket })),
    observe(projectId, tasks, { baseline, limit = 25, kind, watchId, claimsUnmarked = true, heldElsewhere = () => null }) {
      const at = now();
      // Ticket and review watches share the book; each poll judges only the records of its own kind, and with
      // several ticket watches (one in the owner's own words, say) only the tickets that watch itself found.
      // Tickets recorded before watches were told apart are judged by the watches that claim them.
      const judged = (ticket) => !watchId || (ticket.foundBy?.length ? ticket.foundBy.includes(watchId) : claimsUnmarked);
      const mine = (ticket) => (!kind || (kind === "review") === String(ticket.key).startsWith("review:")) && judged(ticket);
      const found = (ticket) => {
        if (watchId && !ticket.foundBy?.includes(watchId)) ticket.foundBy = [...(ticket.foundBy || []), watchId];
      };
      const valid = tasks.filter((task) => typeof task.id === "string" && task.id.trim());
      const emptyKey = `${projectId}\0${kind || ""}\0${watchId || ""}`;
      const active = of(projectId).some((ticket) => mine(ticket) && ["queued", "not-started", "working", "planning", "plan-ready"].includes(ticket.state));
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
          found(existing);
          Object.assign(existing, { title: task.title || existing.title, url: task.url || existing.url, ...tracked(task) });
          // Back in the list after dropping out: it resumes where it was, it is not new work.
          if (existing.state === "dropped" && task.stage !== "done") Object.assign(existing, { state: existing.previousState || "not-started", updatedAt: at });
          if (task.stage === "done" && ["queued", "not-started", "plan-ready"].includes(existing.state)) Object.assign(existing, { previousState: existing.state, state: "dropped", updatedAt: at });
          else if (task.stage === "started" && existing.state === "queued" && !existing.chosen) Object.assign(existing, { state: "not-started", updatedAt: at });
          continue;
        }
        if (task.stage === "done") continue;
        const elsewhere = heldElsewhere(task.id);
        const ticket = {
          key: task.id,
          title: task.title,
          description: task.description || "",
          url: task.url || "",
          ...tracked(task),
          state: baseline || task.pr?.trusted === false || task.stage === "started" || elsewhere ? "not-started" : "queued",
          ...(elsewhere ? { elsewhere } : {}),
          ...(task.pr ? { pr: task.pr, priority: "review" } : {}),
          firstSeenAt: at,
          updatedAt: at,
        };
        found(ticket);
        of(projectId).push(ticket);
        if (ticket.state === "queued") queued.push({ ...ticket });
      }
      const dropped = [];
      const flagged = [];
      const gone = [];
      // A full page may simply have pushed older items past its end, so only a shorter answer counts as complete.
      const complete = valid.length < limit;
      for (const ticket of of(projectId)) {
        if (seen.has(ticket.key) || !complete || !mine(ticket)) continue;
        if (watchId && ticket.foundBy?.includes(watchId)) {
          ticket.foundBy = ticket.foundBy.filter((id) => id !== watchId);
          if (ticket.foundBy.length) continue;
          delete ticket.foundBy;
        }
        if (["queued", "not-started", "plan-ready"].includes(ticket.state)) {
          Object.assign(ticket, { previousState: ticket.state, state: "dropped", updatedAt: at });
          dropped.push(ticket.key);
        } else if (ticket.state === "working" || ticket.state === "planning") {
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
      // Finished work never goes back to its plan, and plans are the largest thing in the book.
      if (ticket.state === "done") delete ticket.plan;
      save();
      return { ...ticket };
    },
  };
}

module.exports = { createTicketBook };
