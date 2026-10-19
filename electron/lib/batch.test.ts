import { describe, expect, it, vi } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createBatcher } = require("./batch.cjs");

describe("output batching", () => {
  it("joins chunks that arrive within one frame into a single send", () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    const batch = createBatcher((data: string) => sent.push(data), 16);
    batch.push("a");
    batch.push("b");
    batch.push("c");
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(16);
    expect(sent).toEqual(["abc"]);
    batch.push("d");
    vi.advanceTimersByTime(16);
    expect(sent).toEqual(["abc", "d"]);
    vi.useRealTimers();
  });

  it("flushes what is pending when stopped", () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    const batch = createBatcher((data: string) => sent.push(data), 16);
    batch.push("tail");
    batch.stop();
    expect(sent).toEqual(["tail"]);
    vi.advanceTimersByTime(50);
    expect(sent).toEqual(["tail"]);
    vi.useRealTimers();
  });
});
