import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { feedFor, startUpdates } = require("./updates.cjs");

class FakeUpdater extends EventEmitter {
  feed: unknown = null;
  checks = 0;
  installs = 0;
  autoDownload = false;
  autoInstallOnAppQuit = false;
  next: (updater: FakeUpdater) => void = () => {};
  setFeedURL(feed: unknown) { this.feed = feed; }
  checkForUpdates() { this.checks += 1; this.emit("checking-for-update"); this.next(this); return Promise.resolve(); }
  quitAndInstall() { this.installs += 1; }
}

const start = (updater: FakeUpdater, states: unknown[] = [], options = {}) =>
  startUpdates({ autoUpdater: updater, packaged: true, env: {}, onState: (state: unknown) => states.push(state), ...options });

describe("self-updates", () => {
  it("a build without a configured feed updates from Pitlane's GitHub releases", () => {
    expect(feedFor(undefined)).toEqual({ provider: "github", owner: "braveson008", repo: "pitlane" });
    const updater = new FakeUpdater();
    start(updater);
    expect(updater.feed).toEqual({ provider: "github", owner: "braveson008", repo: "pitlane" });
    expect(updater.autoDownload).toBe(true);
    expect(updater.autoInstallOnAppQuit).toBe(true);
    expect(updater.checks).toBe(1);
  });

  it("does nothing under E2E, when not packaged, or when the build has no feed", () => {
    for (const options of [{ packaged: true, env: { PITLANE_E2E: "1" } }, { packaged: false, env: {} }, { packaged: true, env: {}, config: { enabled: false } }]) {
      const updater = new FakeUpdater();
      expect(startUpdates({ autoUpdater: updater, onState: () => {}, ...options })).toBeNull();
      expect(updater.checks).toBe(0);
    }
  });

  it("a configured generic feed is the one used", () => {
    const updater = new FakeUpdater();
    start(updater, [], { config: { enabled: true, url: "https://example.test/feed/" } });
    expect(updater.feed).toEqual({ provider: "generic", url: "https://example.test/feed/" });
  });

  it("reports downloading, progress, then ready with where to read what changed", () => {
    const updater = new FakeUpdater();
    const states: unknown[] = [];
    start(updater, states);
    updater.emit("update-available", { version: "0.2.0" });
    updater.emit("download-progress", { percent: 41.6 });
    updater.emit("update-downloaded", { version: "0.2.0" });
    expect(states.slice(-3)).toEqual([
      { status: "downloading", version: "0.2.0" },
      { status: "downloading", version: "0.2.0", percent: 42 },
      { status: "ready", version: "0.2.0", notesUrl: "https://github.com/braveson008/pitlane/releases/tag/v0.2.0" },
    ]);
  });

  it("a check by hand says when there is nothing new, and resolves with what it found", async () => {
    const updater = new FakeUpdater();
    const states: Array<{ status: string }> = [];
    const updates = start(updater, states);
    updater.next = (self) => self.emit("update-not-available", { version: "0.1.1" });
    expect(await updates.check()).toEqual({ status: "current", version: "0.1.1" });
    updater.next = (self) => self.emit("error", new Error("offline"));
    expect(await updates.check()).toEqual({ status: "error", error: "offline" });
  });

  it("once an update is ready it stops checking, and install restarts into it", () => {
    vi.useFakeTimers();
    const updater = new FakeUpdater();
    const updates = start(updater);
    updater.emit("update-downloaded", { version: "0.2.0" });
    vi.advanceTimersByTime(6 * 3600_000);
    expect(updater.checks).toBe(1);
    updates.install();
    expect(updater.installs).toBe(1);
    updates.stop();
    vi.useRealTimers();
  });

  it("checks again every six hours", () => {
    vi.useFakeTimers();
    const updater = new FakeUpdater();
    const updates = start(updater);
    vi.advanceTimersByTime(6 * 3600_000);
    expect(updater.checks).toBe(2);
    updates.stop();
    vi.useRealTimers();
  });
});
