import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createDispatcher } = require("./dispatcher.cjs");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createTicketBook } = require("./tickets.cjs");

const task = (id: string) => ({ id, title: id, description: "", url: "", status: "", group: "", updatedAt: "" });

function setup({ maxAgents = 3, start }: { maxAgents?: number; start?: (project: { id: string }, ticket: { key: string }) => Promise<unknown> } = {}) {
  let saved = {};
  let clock = 0;
  const book = createTicketBook({ store: { get: () => saved, set: (value: object) => { saved = value; } }, now: () => (clock += 1) });
  const live = new Set<string>();
  const started: string[] = [];
  const dispatcher = createDispatcher({
    projects: () => [{ id: "a" }, { id: "b" }],
    book,
    running: () => live.size,
    maxAgents: () => maxAgents,
    now: () => 1_000,
    start: start ?? (async (project: { id: string }, ticket: { key: string }) => {
      live.add(ticket.key);
      started.push(`${project.id}:${ticket.key}`);
      return { ok: true, sessionId: `s-${ticket.key}` };
    }),
  });
  return { book, dispatcher, live, started };
}

describe("dispatcher", () => {
  it("starts the oldest queued tickets up to the global cap", async () => {
    const { book, dispatcher, started } = setup();
    book.observe("a", [task("A-1"), task("A-2")], { baseline: false });
    book.observe("b", [task("B-1"), task("B-2")], { baseline: false });
    expect(await dispatcher.tick()).toEqual(["A-1", "A-2", "B-1"]);
    expect(started).toEqual(["a:A-1", "a:A-2", "b:B-1"]);
    expect(book.get("b", "B-2").state).toBe("queued");
    expect(book.get("a", "A-1")).toMatchObject({ state: "working", sessionId: "s-A-1" });
  });

  it("a busy project is skipped quietly and retried next tick", async () => {
    let busy = true;
    const { book, dispatcher } = setup({ start: async () => (busy ? { ok: false, busy: true } : { ok: true, sessionId: "s" }) });
    book.observe("a", [task("A-1")], { baseline: false });
    expect(await dispatcher.tick()).toEqual([]);
    expect(book.get("a", "A-1").state).toBe("queued");
    busy = false;
    expect(await dispatcher.tick()).toEqual(["A-1"]);
  });

  it("a start error marks the ticket needs-you", async () => {
    const { book, dispatcher } = setup({ start: async () => ({ ok: false, error: "claude was not found on PATH" }) });
    book.observe("a", [task("A-1")], { baseline: false });
    await dispatcher.tick();
    expect(book.get("a", "A-1")).toMatchObject({ state: "needs-you", reason: "claude was not found on PATH" });
  });

  it("nothing starts while paused", async () => {
    const { book, dispatcher } = setup();
    book.observe("a", [task("A-1")], { baseline: false });
    dispatcher.pause(5_000);
    expect(dispatcher.pausedUntil()).toBe(5_000);
    expect(await dispatcher.tick()).toEqual([]);
  });

  it("the fourth starts once one finishes", async () => {
    const { book, dispatcher, live } = setup();
    book.observe("a", [task("A-1"), task("A-2"), task("A-3"), task("A-4")], { baseline: false });
    await dispatcher.tick();
    expect(await dispatcher.tick()).toEqual([]);
    live.delete("A-1");
    expect(await dispatcher.tick()).toEqual(["A-4"]);
  });

  it("two ticks at once never start a ticket twice", async () => {
    const { book, dispatcher, started } = setup();
    book.observe("a", [task("A-1")], { baseline: false });
    await Promise.all([dispatcher.tick(), dispatcher.tick()]);
    expect(started).toEqual(["a:A-1"]);
  });

  it("reviews start before queued tickets, and feedback before new tickets", async () => {
    const { book, dispatcher, started } = setup({ maxAgents: 3 });
    book.observe("a", [task("A-1")], { baseline: false });
    book.observe("a", [task("A-1"), task("A-2")], { baseline: false });
    book.set("a", "A-2", { priority: "feedback" });
    book.observe("b", [{ ...task("review:9"), pr: { number: 9, head: "x" } }], { baseline: false });
    book.set("b", "review:9", { priority: "review" });
    await dispatcher.tick();
    expect(started).toEqual(["b:review:9", "a:A-2", "a:A-1"]);
  });
});
