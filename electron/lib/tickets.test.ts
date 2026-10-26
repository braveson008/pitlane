import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createTicketBook } = require("./tickets.cjs");

const task = (id: string, title = `Ticket ${id}`) => ({ id, title, description: "", url: `https://jira/${id}`, status: "To Do", group: "", updatedAt: "" });

function book(start = 1000) {
  let saved = {};
  let clock = start;
  const make = () => createTicketBook({ store: { get: () => saved, set: (value: object) => { saved = value; } }, now: () => clock });
  return { make, tick: (ms: number) => { clock += ms; } };
}

describe("ticket book", () => {
  it("the first run baselines existing tickets as not started", () => {
    const tickets = book().make();
    const result = tickets.observe("p", [task("SHOP-1")], { baseline: true });
    expect(result.queued).toEqual([]);
    expect(tickets.list("p")).toEqual([expect.objectContaining({ key: "SHOP-1", state: "not-started", title: "Ticket SHOP-1" })]);
  });

  it("a key seen later is queued", () => {
    const tickets = book().make();
    tickets.observe("p", [task("SHOP-1")], { baseline: true });
    const result = tickets.observe("p", [task("SHOP-1"), task("SHOP-2")], { baseline: false });
    expect(result.queued.map((ticket: { key: string }) => ticket.key)).toEqual(["SHOP-2"]);
    expect(tickets.list("p").find((ticket: { key: string }) => ticket.key === "SHOP-2").state).toBe("queued");
  });

  it("a known key is never queued again, even after done", () => {
    const tickets = book().make();
    tickets.observe("p", [task("SHOP-2")], { baseline: false });
    tickets.set("p", "SHOP-2", { state: "done" });
    const result = tickets.observe("p", [task("SHOP-2")], { baseline: false });
    expect(result.queued).toEqual([]);
    expect(tickets.list("p")[0].state).toBe("done");
  });

  it("an unassigned queued ticket is dropped", () => {
    const tickets = book().make();
    tickets.observe("p", [task("SHOP-1"), task("SHOP-2")], { baseline: false });
    const result = tickets.observe("p", [task("SHOP-1")], { baseline: false });
    expect(result.dropped).toEqual(["SHOP-2"]);
    expect(tickets.list("p").find((ticket: { key: string }) => ticket.key === "SHOP-2").state).toBe("dropped");
  });

  it("an unassigned working ticket needs you", () => {
    const tickets = book().make();
    tickets.observe("p", [task("SHOP-1")], { baseline: false });
    tickets.set("p", "SHOP-1", { state: "working", sessionId: "s1" });
    const result = tickets.observe("p", [task("OTHER-1")], { baseline: false });
    expect(result.flagged).toEqual(["SHOP-1"]);
    expect(tickets.list("p")[0]).toMatchObject({ state: "needs-you", reason: "unassigned" });
  });

  it("an unassigned ticket with a plan waiting is dropped; one being planned needs you", () => {
    const tickets = book().make();
    tickets.observe("p", [task("SHOP-1"), task("SHOP-2")], { baseline: false });
    tickets.set("p", "SHOP-1", { state: "plan-ready", plan: "x" });
    tickets.set("p", "SHOP-2", { state: "planning", sessionId: "s2" });
    const result = tickets.observe("p", [task("OTHER-1")], { baseline: false });
    expect(result.dropped).toEqual(["SHOP-1"]);
    expect(result.flagged).toEqual(["SHOP-2"]);
    expect(tickets.get("p", "SHOP-2")).toMatchObject({ state: "needs-you", reason: "unassigned" });
  });

  it("next returns the oldest queued ticket", () => {
    const clock = book();
    const tickets = clock.make();
    tickets.observe("p", [task("SHOP-5")], { baseline: false });
    clock.tick(10);
    tickets.observe("p", [task("SHOP-5"), task("SHOP-3")], { baseline: false });
    expect(tickets.next("p").key).toBe("SHOP-5");
    tickets.set("p", "SHOP-5", { state: "working" });
    expect(tickets.next("p").key).toBe("SHOP-3");
    expect(tickets.next("other")).toBeUndefined();
  });

  it("a done ticket lets go of its plan", () => {
    const tickets = book().make();
    tickets.observe("p", [task("SHOP-1")], { baseline: false });
    tickets.set("p", "SHOP-1", { state: "in-review", plan: "x".repeat(1000) });
    expect(tickets.get("p", "SHOP-1").plan).toBeDefined();
    tickets.set("p", "SHOP-1", { state: "done" });
    expect(tickets.get("p", "SHOP-1").plan).toBeUndefined();
  });

  it("records survive a new book on the same store", () => {
    const clock = book();
    clock.make().observe("p", [task("SHOP-1")], { baseline: false });
    expect(clock.make().list("p")).toEqual([expect.objectContaining({ key: "SHOP-1", state: "queued" })]);
  });

  it("a ticket that drops out of one poll and comes back keeps its state, never re-queued", () => {
    const tickets = book().make();
    tickets.observe("p", [task("SHOP-1"), task("SHOP-2")], { baseline: true });
    tickets.observe("p", [task("SHOP-2")], { baseline: false });
    expect(tickets.list("p").find((ticket: { key: string }) => ticket.key === "SHOP-1").state).toBe("dropped");
    const back = tickets.observe("p", [task("SHOP-1"), task("SHOP-2")], { baseline: false });
    expect(back.queued).toEqual([]);
    expect(tickets.list("p").find((ticket: { key: string }) => ticket.key === "SHOP-1").state).toBe("not-started");
    expect(tickets.next("p")).toBeUndefined();
  });

  it("an empty answer is not believed while tickets are active, until it repeats", () => {
    const tickets = book().make();
    tickets.observe("p", [task("SHOP-1")], { baseline: false });
    tickets.set("p", "SHOP-1", { state: "working" });
    expect(tickets.observe("p", [], { baseline: false })).toEqual({ queued: [], dropped: [], flagged: [] });
    expect(tickets.list("p")[0].state).toBe("working");
    expect(tickets.observe("p", [], { baseline: false }).flagged).toEqual(["SHOP-1"]);
  });

  it("a full page is not taken as the whole list, so nothing beyond it is dropped", () => {
    const tickets = book().make();
    tickets.observe("p", [task("OLD-1")], { baseline: true });
    const page = Array.from({ length: 25 }, (_, index) => task(`NEW-${index}`));
    expect(tickets.observe("p", page, { baseline: false, limit: 25 }).dropped).toEqual([]);
    expect(tickets.list("p").find((ticket: { key: string }) => ticket.key === "OLD-1").state).toBe("not-started");
  });

  it("items without a key are ignored", () => {
    const tickets = book().make();
    tickets.observe("p", [{ ...task(""), id: "" }, task("SHOP-1")], { baseline: false });
    expect(tickets.list("p").map((ticket: { key: string }) => ticket.key)).toEqual(["SHOP-1"]);
  });

  it("a poll only judges its own kind of record: tickets never unassign reviews, nor the reverse", () => {
    const tickets = book().make();
    tickets.observe("p", [{ ...task("review:1"), pr: { number: 1, head: "x" } }], { baseline: false, kind: "review" });
    tickets.set("p", "review:1", { state: "working" });
    tickets.observe("p", [task("SHOP-1")], { baseline: false, kind: "ticket" });
    expect(tickets.get("p", "review:1").state).toBe("working");
    tickets.observe("p", [{ ...task("review:2"), pr: { number: 2, head: "y" } }], { baseline: false, kind: "review" });
    expect(tickets.get("p", "SHOP-1").state).toBe("queued");
    expect(tickets.get("p", "review:1").state).toBe("needs-you");
  });

  it("each ticket watch judges only the tickets it found: a second watch never unassigns the first one's", () => {
    const tickets = book().make();
    tickets.observe("p", [task("SHOP-1")], { baseline: false, kind: "ticket", watchId: "w-plain" });
    tickets.set("p", "SHOP-1", { state: "working" });
    tickets.observe("p", [task("SHOP-9")], { baseline: false, kind: "ticket", watchId: "w-custom" });
    expect(tickets.get("p", "SHOP-1").state).toBe("working");
    expect(tickets.get("p", "SHOP-9").state).toBe("queued");
    tickets.observe("p", [], { baseline: false, kind: "ticket", watchId: "w-custom" });
    tickets.observe("p", [], { baseline: false, kind: "ticket", watchId: "w-custom" });
    expect(tickets.get("p", "SHOP-9").state).toBe("dropped");
    expect(tickets.get("p", "SHOP-1").state).toBe("working");
  });

  it("a ticket two watches found stays while either still finds it", () => {
    const tickets = book().make();
    tickets.observe("p", [task("SHOP-1")], { baseline: false, kind: "ticket", watchId: "a" });
    tickets.observe("p", [task("SHOP-1"), task("SHOP-2")], { baseline: false, kind: "ticket", watchId: "b" });
    tickets.observe("p", [task("SHOP-2")], { baseline: false, kind: "ticket", watchId: "a" });
    expect(tickets.get("p", "SHOP-1").state).toBe("queued");
    tickets.observe("p", [task("SHOP-2")], { baseline: false, kind: "ticket", watchId: "b" });
    expect(tickets.get("p", "SHOP-1").state).toBe("dropped");
  });

  it("tickets from before watches were told apart are judged only by a watch that claims them", () => {
    const tickets = book().make();
    tickets.observe("p", [task("SHOP-1")], { baseline: false, kind: "ticket" });
    tickets.observe("p", [task("SHOP-9")], { baseline: false, kind: "ticket", watchId: "w-custom", claimsUnmarked: false });
    expect(tickets.get("p", "SHOP-1").state).toBe("queued");
    tickets.observe("p", [task("SHOP-9")], { baseline: false, kind: "ticket", watchId: "w-plain", claimsUnmarked: true });
    expect(tickets.get("p", "SHOP-1").state).toBe("dropped");
  });

  it("an untrusted review request waits for the owner instead of queueing", () => {
    const tickets = book().make();
    tickets.observe("p", [{ ...task("review:5"), pr: { number: 5, trusted: false } }], { baseline: false, kind: "review" });
    expect(tickets.get("p", "review:5").state).toBe("not-started");
  });

  it("a finished review that drops out and is requested again is new work", () => {
    const tickets = book().make();
    const review = { ...task("review:1"), pr: { number: 1, trusted: true } };
    tickets.observe("p", [review], { baseline: false, kind: "review" });
    tickets.set("p", "review:1", { state: "done" });
    tickets.observe("p", [], { baseline: false, kind: "review" });
    expect(tickets.get("p", "review:1")).toBeUndefined();
    expect(tickets.observe("p", [review], { baseline: false, kind: "review" }).queued.map((each: { key: string }) => each.key)).toEqual(["review:1"]);
  });

  it("a new ticket already in progress on the tracker is listed, not queued", () => {
    const tickets = book().make();
    tickets.observe("p", [], { baseline: true });
    const result = tickets.observe("p", [{ ...task("SHOP-3"), status: "Ready for QA", stage: "started" }], { baseline: false });
    expect(result.queued).toEqual([]);
    expect(tickets.get("p", "SHOP-3")).toEqual(expect.objectContaining({ state: "not-started", status: "Ready for QA", stage: "started" }));
  });

  it("a queued ticket that moves on in the tracker leaves the queue", () => {
    const tickets = book().make();
    tickets.observe("p", [{ ...task("SHOP-4"), stage: "todo" }], { baseline: false });
    tickets.observe("p", [{ ...task("SHOP-4"), status: "Code Review", stage: "started" }], { baseline: false });
    expect(tickets.get("p", "SHOP-4")).toEqual(expect.objectContaining({ state: "not-started", status: "Code Review" }));
  });

  it("a ticket finished in the tracker is dropped wherever it waits", () => {
    const tickets = book().make();
    tickets.observe("p", [{ ...task("SHOP-5"), stage: "todo" }], { baseline: false });
    tickets.observe("p", [{ ...task("SHOP-5"), status: "Done", stage: "done" }], { baseline: false });
    expect(tickets.get("p", "SHOP-5").state).toBe("dropped");
  });

  it("a ticket another project already has is listed here, not queued twice", () => {
    const tickets = book().make();
    const result = tickets.observe("p", [task("SHOP-6")], { baseline: false, heldElsewhere: (key: string) => (key === "SHOP-6" ? "admin" : null) });
    expect(result.queued).toEqual([]);
    expect(tickets.get("p", "SHOP-6")).toEqual(expect.objectContaining({ state: "not-started", elsewhere: "admin" }));
  });

  it("a ticket the owner queued by hand stays queued while it is in progress", () => {
    const tickets = book().make();
    tickets.observe("p", [{ ...task("SHOP-7"), stage: "started" }], { baseline: false });
    tickets.set("p", "SHOP-7", { state: "queued", chosen: true });
    tickets.observe("p", [{ ...task("SHOP-7"), stage: "started" }], { baseline: false });
    expect(tickets.get("p", "SHOP-7").state).toBe("queued");
  });
});
