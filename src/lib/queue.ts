import type { Ticket } from "../api";

// The same order as electron/lib/dispatcher.cjs, so the numbers on screen are the order things start in.
const PRIORITY: Record<string, number> = { review: 0, feedback: 1 };
// electron/lib/ticketFlow.cjs wantsWork: approved, feedback, or work already on a branch.
const wantsWork = (ticket: Ticket) => Boolean(ticket.approved || ticket.priority === "feedback" || ticket.branch);
const rank = (ticket: Ticket) => PRIORITY[ticket.priority ?? ""] ?? (wantsWork(ticket) ? 2 : 3);

export const upNext = (tickets: Ticket[]) => tickets.filter((ticket) => ticket.state === "queued").sort((a, b) => rank(a) - rank(b) || a.firstSeenAt - b.firstSeenAt);

export const notStarted = (tickets: Ticket[]) => tickets.filter((ticket) => ticket.state === "not-started").sort((a, b) => a.firstSeenAt - b.firstSeenAt);

export function ticketLabel(ticket: Ticket) {
  if (ticket.priority === "review" || ticket.key.startsWith("review:")) return "review";
  if (ticket.priority === "feedback") return "feedback";
  if (ticket.elsewhere) return `in ${ticket.elsewhere}`;
  if (ticket.state === "queued") return wantsWork(ticket) ? "work" : "plan";
  return ticket.status || "ticket";
}
