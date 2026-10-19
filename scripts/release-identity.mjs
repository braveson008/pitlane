import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Who a release is. A build made with PITLANE_UPDATE_URL updates from that
 * feed (an S3-compatible bucket, under its own prefix); one made without it
 * updates from the GitHub releases of the repository in package.json.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

export const PRODUCT = pkg.build.productName;
export const FEED_PREFIX = "pitlane/";

export function feedUrl(env = process.env) {
  return String(env.PITLANE_UPDATE_URL || "").trim().replace(/\/$/, "");
}

/** owner/repo from package.json's "repository", for the GitHub update feed. */
export function githubRepo() {
  const match = /github(?:\.com[/:]|:)([^/]+)\/([^/.]+)/.exec(String(pkg.repository?.url || pkg.repository || ""));
  return match ? { owner: match[1], repo: match[2] } : null;
}
