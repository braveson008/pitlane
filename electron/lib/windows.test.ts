import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createWindowManager } = require("./windows.cjs");

function fakes() {
  const created: (string | null)[] = [];
  const windows: FakeWindow[] = [];
  let saved: string[] = [];
  class FakeWindow extends EventEmitter {
    focused = 0;
    constructor(public projectId: string | null) { super(); }
    focus() { this.focused += 1; }
    close() { this.emit("closed"); }
  }
  return {
    created,
    windows,
    store: { get: () => saved, set: (ids: string[]) => { saved = ids; } },
    saved: () => saved,
    create: (projectId: string | null) => {
      created.push(projectId);
      const window = new FakeWindow(projectId);
      windows.push(window);
      return window;
    },
  };
}

describe("window manager", () => {
  it("opening the same project twice focuses the first window", () => {
    const f = fakes();
    const manager = createWindowManager({ create: f.create, store: f.store });
    manager.openProject("a");
    manager.openProject("a");
    expect(f.created).toEqual(["a"]);
    expect(f.windows[0].focused).toBe(1);
  });

  it("restore reopens what was open at quit", () => {
    const f = fakes();
    f.store.set(["a", "b"]);
    const manager = createWindowManager({ create: f.create, store: f.store });
    manager.restore();
    expect(f.created).toEqual(["a", "b"]);
    expect(manager.openIds()).toEqual(["a", "b"]);
  });

  it("restore opens the picker when nothing was open", () => {
    const f = fakes();
    createWindowManager({ create: f.create, store: f.store }).restore();
    expect(f.created).toEqual([null]);
  });

  it("closing a window removes it from openIds", () => {
    const f = fakes();
    const manager = createWindowManager({ create: f.create, store: f.store });
    manager.openProject("a");
    manager.openProject("b");
    f.windows[0].close();
    expect(manager.openIds()).toEqual(["b"]);
    expect(f.saved()).toEqual(["b"]);
  });

  it("quitting keeps the record of open windows", () => {
    const f = fakes();
    const manager = createWindowManager({ create: f.create, store: f.store });
    manager.openProject("a");
    manager.quitting();
    f.windows[0].close();
    expect(f.saved()).toEqual(["a"]);
  });
});
