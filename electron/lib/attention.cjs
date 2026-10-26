const WAITING = new Set(["needs-you", "review-ready", "plan-ready"]);

/** How many things in a project wait on the owner: tickets for them to act on, and agents asking them something. */
function needsYou({ tickets, sessions }) {
  return tickets.filter((ticket) => WAITING.has(ticket.state)).length
    + sessions.filter((session) => session.state === "running" && session.attention).length;
}

module.exports = { needsYou };
