import { describe, expect, it } from "vitest";
import { updateLabel } from "./update";

describe("the update note in the status line", () => {
  it("says nothing until there is something worth saying", () => {
    for (const state of [null, { status: "idle" }, { status: "current", version: "0.1.1" }, { status: "error", error: "offline" }] as const) {
      expect(updateLabel(state)).toBeNull();
    }
  });

  it("shows a download in progress, then what to press once it is ready", () => {
    expect(updateLabel({ status: "downloading", version: "0.2.0", percent: 40 })).toEqual({ text: "downloading 0.2.0 · 40%", ready: false });
    expect(updateLabel({ status: "ready", version: "0.2.0" })).toEqual({ text: "0.2.0 ready · U restart to update", ready: true });
  });
});
