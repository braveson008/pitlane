import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { feedFor, startUpdates } = require("./updates.cjs");

class FakeUpdater extends EventEmitter {
  feed: unknown = null;
  checks = 0;
  autoDownload = false;
  autoInstallOnAppQuit = false;
  setFeedURL(feed: unknown) { this.feed = feed; }
  checkForUpdates() { this.checks += 1; return Promise.resolve(); }
  quitAndInstall() {}
}

describe("self-updates", () => {
  it("a build without a configured feed updates from Pitlane's GitHub releases", () => {
    expect(feedFor(undefined)).toEqual({ provider: "github", owner: "braveson008", repo: "pitlane" });
    const updater = new FakeUpdater();
    startUpdates({ autoUpdater: updater, packaged: true, env: {}, onState: () => {} });
    expect(updater.feed).toEqual({ provider: "github", owner: "braveson008", repo: "pitlane" });
    expect(updater.autoDownload).toBe(true);
    expect(updater.autoInstallOnAppQuit).toBe(true);
    expect(updater.checks).toBe(1);
  });

  it("does nothing under E2E or when not packaged", () => {
    for (const options of [{ packaged: true, env: { PITLANE_E2E: "1" } }, { packaged: false, env: {} }]) {
      const updater = new FakeUpdater();
      expect(startUpdates({ autoUpdater: updater, onState: () => {}, ...options })).toBeNull();
      expect(updater.checks).toBe(0);
    }
  });

  it("a build made without a feed never checks, and a configured feed is the one used", () => {
    const off = new FakeUpdater();
    expect(startUpdates({ autoUpdater: off, packaged: true, env: {}, config: { enabled: false }, onState: () => {} })).toBeNull();
    expect(off.checks).toBe(0);
    const github = new FakeUpdater();
    startUpdates({ autoUpdater: github, packaged: true, env: {}, config: { enabled: true, provider: "github", owner: "o", repo: "r" }, onState: () => {} });
    expect(github.feed).toEqual({ provider: "github", owner: "o", repo: "r" });
    const generic = new FakeUpdater();
    startUpdates({ autoUpdater: generic, packaged: true, env: {}, config: { enabled: true, url: "https://example.test/feed/" }, onState: () => {} });
    expect(generic.feed).toEqual({ provider: "generic", url: "https://example.test/feed/" });
  });

  it("reports a downloaded update and checks again every six hours", () => {
    vi.useFakeTimers();
    const updater = new FakeUpdater();
    const states: unknown[] = [];
    const stop = startUpdates({ autoUpdater: updater, packaged: true, env: {}, onState: (state: unknown) => states.push(state) });
    updater.emit("update-downloaded", { version: "0.2.0" });
    expect(states).toEqual([{ ready: true, version: "0.2.0" }]);
    vi.advanceTimersByTime(6 * 3600_000);
    expect(updater.checks).toBe(2);
    stop();
    vi.useRealTimers();
  });
});
