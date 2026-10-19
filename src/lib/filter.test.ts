import { describe, expect, it } from "vitest";
import { filterSessions } from "./filter";
import type { Session } from "../api";

const make = (id: string, name: string, agent: Session["agent"] = "claude"): Session =>
  ({ id, projectId: "p", agent, name, cwd: "/r", state: "running", createdAt: 0 });

const list = [make("a", "SHOP-2875 DRM stream URL"), make("b", "Staging behind dev?", "codex"), make("c", "SHOP-2863 Methods column")];

describe("session filter", () => {
  it("filters by subsequence of name and agent", () => {
    expect(filterSessions(list, "drm").map((s) => s.id)).toEqual(["a"]);
    expect(filterSessions(list, "cx").map((s) => s.id)).toEqual(["b"]);
    expect(filterSessions(list, "SHOP 28").map((s) => s.id)).toEqual(["a", "c"]);
  });

  it("keeps session order", () => {
    expect(filterSessions(list, "e").map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("empty query returns all", () => {
    expect(filterSessions(list, "  ")).toEqual(list);
  });
});
