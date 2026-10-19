import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ticketBranch, adoptableBranch, ticketSlug } = require("./branches.cjs");

const valid = (branch: string) => {
  try {
    execFileSync("git", ["check-ref-format", "--branch", branch], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

describe("ticket branches", () => {
  it("follows feature/KEY- when the repository does", () => {
    const remoteBranches = ["main", "feature/SHOP-1-a", "feature/SHOP-2-b", "fix/SHOP-3-c"];
    expect(ticketBranch({ key: "SHOP-2875", title: "BO: Add DRM Stream URL Input Field", remoteBranches })).toBe("feature/SHOP-2875-bo-add-drm-stream-url-input-field");
  });

  it("falls back to key-slug", () => {
    expect(ticketBranch({ key: "SHOP-2875", title: "DRM stream URL", remoteBranches: ["main", "dev"] })).toBe("shop-2875-drm-stream-url");
  });

  it("adopts an existing branch for the key, case-insensitively", () => {
    expect(adoptableBranch({ key: "SHOP-2875", remoteBranches: ["main", "feature/shop-2875-old-name"] })).toBe("feature/shop-2875-old-name");
    expect(adoptableBranch({ key: "SHOP-2875", remoteBranches: ["main"] })).toBeNull();
  });

  it("SHOP-28 does not adopt shop-2875", () => {
    expect(adoptableBranch({ key: "SHOP-28", remoteBranches: ["feature/shop-2875-x", "shop-280"] })).toBeNull();
    expect(adoptableBranch({ key: "SHOP-28", remoteBranches: ["feature/SHOP-28-x"] })).toBe("feature/SHOP-28-x");
  });

  it("unsafe titles still make a valid branch", () => {
    for (const [key, title] of [["ABC-1", "Fix #42: ünïcödé ~ title.. with [brackets] and spaces"], ["ENG 7", "..."], ["X-9", ""]]) {
      const branch = ticketBranch({ key, title, remoteBranches: [] });
      expect(valid(branch), branch).toBe(true);
    }
    expect(ticketSlug("A".repeat(100)).length).toBeLessThanOrEqual(40);
  });
});
