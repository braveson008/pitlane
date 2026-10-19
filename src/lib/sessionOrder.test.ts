import { describe, expect, it } from "vitest";
import { ago, orderSessions, sessionMarker } from "./sessionOrder";
import type { Session } from "../api";

const HOUR = 3600_000;
const now = 100 * HOUR;
const make = (id: string, state: Session["state"], createdAt: number, endedAt?: number): Session =>
  ({ id, projectId: "p", agent: "claude", name: id, cwd: "/r", state, createdAt, endedAt });

describe("session order", () => {
  it("running sessions come first, newest first", () => {
    const list = [make("old-run", "running", now - 5 * HOUR), make("done", "exited", now - HOUR, now - 1000), make("new-run", "running", now - HOUR)];
    expect(orderSessions(list, now).map((s) => s.id)).toEqual(["new-run", "old-run", "done"]);
  });

  it("a session waiting on the owner comes first, marked !", () => {
    const waiting = { ...make("asks", "running", now - 5 * HOUR), attention: "Claude needs your permission" };
    const list = [make("run", "running", now - HOUR), waiting];
    expect(orderSessions(list, now).map((s) => s.id)).toEqual(["asks", "run"]);
    expect(sessionMarker(waiting)).toBe("!");
  });

  it("failed sessions sit between running and exited", () => {
    const list = [make("done", "exited", now - HOUR, now - 1000), make("broke", "failed", now - 2 * HOUR, now - 2 * HOUR), make("run", "running", now)];
    expect(orderSessions(list, now).map((s) => s.id)).toEqual(["run", "broke", "done"]);
  });

  it("exited sessions older than a day are hidden", () => {
    const list = [make("yesterday", "exited", now - 30 * HOUR, now - 25 * HOUR), make("today", "exited", now - 2 * HOUR, now - HOUR)];
    expect(orderSessions(list, now).map((s) => s.id)).toEqual(["today"]);
  });

  it("failed shows the ! marker and running the * marker", () => {
    expect(sessionMarker(make("a", "failed", now))).toBe("!");
    expect(sessionMarker(make("a", "running", now))).toBe("*");
    expect(sessionMarker(make("a", "exited", now))).toBe(" ");
  });

  it("ago formats seconds minutes hours days", () => {
    expect(ago(now - 12_000, now)).toBe("12s");
    expect(ago(now - 2 * 60_000, now)).toBe("2m");
    expect(ago(now - HOUR, now)).toBe("1h");
    expect(ago(now - 72 * HOUR, now)).toBe("3d");
  });
});
