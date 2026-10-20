import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { addWatch, editWatch, removeWatch, withIds, overlaps, scopeFromHistory, INTERVALS, MODELS } = require("./watchEdits.cjs");

const servers = ["atlassian", "linear-work"];

describe("editing watches", () => {
  it("a new watch starts paused with sensible defaults and its own id", () => {
    const [watch] = addWatch([], { kind: "ticket-assigned", server: "atlassian" }, { servers });
    expect(watch).toMatchObject({ kind: "ticket-assigned", server: "atlassian", intervalSeconds: 300, model: "sonnet", enabled: false });
    expect(watch.id).toMatch(/^w-/);
  });

  it("a ticket watch needs a tracker server this project has", () => {
    expect(() => addWatch([], { kind: "ticket-assigned" }, { servers: [] })).toThrow(/no Jira or Linear/);
    expect(() => addWatch([], { kind: "ticket-assigned", server: "slack" }, { servers })).toThrow(/not one of/);
  });

  it("the same watch twice is refused, but a second tracker is fine", () => {
    const one = addWatch([], { kind: "review-requested" }, { servers });
    expect(() => addWatch(one, { kind: "review-requested" }, { servers })).toThrow(/already/);
    const two = addWatch(addWatch([], { kind: "ticket-assigned", server: "atlassian" }, { servers }), { kind: "ticket-assigned", server: "linear-work" }, { servers });
    expect(two).toHaveLength(2);
  });

  it("an edit changes only the fields it may, to values it may", () => {
    const watches = addWatch([], { kind: "ticket-assigned", server: "atlassian" }, { servers });
    const [edited] = editWatch(watches, watches[0].id, { intervalSeconds: 1800, model: "opus", scope: "  SHOP project  ", kind: "review-requested", lastError: "x" }, { servers });
    expect(edited).toMatchObject({ kind: "ticket-assigned", intervalSeconds: 1800, model: "opus", scope: "SHOP project" });
    expect(edited.lastError).toBeUndefined();
    expect(() => editWatch(watches, watches[0].id, { intervalSeconds: 7 }, { servers })).toThrow(/interval/);
    expect(() => editWatch(watches, watches[0].id, { model: "gpt" }, { servers })).toThrow(/model/);
  });

  it("changing what a watch looks at forgets what it saw, so it does not start everything already there", () => {
    const watches = addWatch([], { kind: "ticket-assigned", server: "atlassian" }, { servers }).map((watch: object) => ({ ...watch, baselined: true, lastCheckedAt: 5 }));
    const [moved] = editWatch(watches, watches[0].id, { server: "linear-work" }, { servers });
    expect(moved.baselined).toBeUndefined();
    expect(moved.lastCheckedAt).toBeUndefined();
    const [same] = editWatch(watches, watches[0].id, { model: "haiku" }, { servers });
    expect(same.baselined).toBe(true);
  });

  it("an unknown watch is an error, and removing takes out exactly that one", () => {
    const watches = addWatch(addWatch([], { kind: "review-requested" }, { servers }), { kind: "ticket-assigned", server: "atlassian" }, { servers });
    expect(() => editWatch(watches, "w-nope", {}, { servers })).toThrow(/No such watch/);
    expect(removeWatch(watches, watches[0].id).map((watch: { kind: string }) => watch.kind)).toEqual(["ticket-assigned"]);
  });

  it("older watches without ids get stable ones", () => {
    const once = withIds([{ kind: "review-requested", intervalSeconds: 300 }]);
    expect(once[0].id).toMatch(/^w-/);
    expect(withIds(once)[0].id).toBe(once[0].id);
  });

  it("offers the intervals and models the editor cycles through", () => {
    expect(INTERVALS).toEqual([300, 600, 1800, 3600]);
    expect(MODELS).toEqual(["sonnet", "haiku", "opus"]);
  });

  it("names the other projects that get the same tickets", () => {
    const watch = (id: string, scope?: string, enabled = true) => ({ id, kind: "ticket-assigned", server: "atlassian", intervalSeconds: 300, model: "sonnet", enabled, ...(scope ? { scope } : {}) });
    const projects = [
      { id: "fe", name: "frontend", watches: [watch("w-fe")] },
      { id: "bo", name: "admin", watches: [watch("w-bo")] },
      { id: "api", name: "api", watches: [watch("w-api", "API")] },
      { id: "old", name: "old", watches: [watch("w-old", undefined, false)] },
    ];
    expect(overlaps(projects, "fe")).toEqual({ "w-fe": ["admin"] });
    expect(overlaps(projects, "api")).toEqual({});
  });

  it("a new ticket watch starts scoped to what the repository's history names", () => {
    const [watch] = addWatch([], { kind: "ticket-assigned", server: "atlassian", scope: "SHOP" }, { servers });
    expect(watch.scope).toBe("SHOP");
  });

  it("reads the ticket keys a repository's branches and commits use", () => {
    const log = ["SHOP-12 fix header", "Merge SHOP-14", "feature/SHOP-20-cart", "SPIKE-1 spike", "SHOP-3", "ADMIN-1 once"].join("\n");
    expect(scopeFromHistory(log)).toBe("SHOP");
    expect(scopeFromHistory("ADMIN-1\nADMIN-2\nADMIN-3\nOPS-1\nOPS-2\nOPS-3")).toBe("ADMIN or OPS");
    expect(scopeFromHistory("fix typo\nUTF-8 support")).toBe("");
  });
});
