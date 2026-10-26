import { describe, expect, it } from "vitest";
import { notStarted, ticketLabel, upNext } from "./queue";
import type { Ticket } from "../api";

const t = (key: string, state: Ticket["state"], firstSeenAt: number, priority?: Ticket["priority"]) => ({ key, title: key, state, firstSeenAt, updatedAt: 0, priority }) as Ticket;

describe("what starts next", () => {
  it("lists queued tickets in the order the dispatcher starts them: reviews, then feedback, then oldest", () => {
    const tickets = [t("A", "queued", 1), t("review:2", "queued", 5, "review"), t("B", "queued", 3, "feedback"), t("C", "not-started", 0)];
    expect(upNext(tickets).map((ticket) => ticket.key)).toEqual(["review:2", "B", "A"]);
  });

  it("keeps what will not start on its own apart, oldest first", () => {
    expect(notStarted([t("Y", "not-started", 9), t("X", "not-started", 2), t("A", "queued", 1)]).map((ticket) => ticket.key)).toEqual(["X", "Y"]);
  });

  it("labels a ticket by what it is waiting on: review, feedback, another project, or its tracker status", () => {
    expect(ticketLabel({ ...t("review:1", "queued", 0, "review") })).toBe("review");
    expect(ticketLabel({ ...t("A", "queued", 0, "feedback"), status: "In Review" })).toBe("feedback");
    expect(ticketLabel({ ...t("B", "not-started", 0), status: "To Do", elsewhere: "admin" })).toBe("in admin");
    expect(ticketLabel({ ...t("C", "not-started", 0), status: "Ready for QA" })).toBe("Ready for QA");
    expect(ticketLabel({ ...t("D", "not-started", 0) })).toBe("ticket");
  });

  it("a queued ticket says whether it is up for a plan or for the work the owner approved", () => {
    expect(ticketLabel({ ...t("D", "queued", 0), status: "To Do" })).toBe("plan");
    expect(ticketLabel({ ...t("E", "queued", 0), status: "To Do", approved: true })).toBe("work");
  });

  it("approved work goes before planning, as the dispatcher starts it", () => {
    const tickets = [t("OLD", "queued", 1), { ...t("NEW", "queued", 5), approved: true }];
    expect(upNext(tickets).map((ticket) => ticket.key)).toEqual(["NEW", "OLD"]);
  });
});
