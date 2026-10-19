import { PRODUCT } from "./release-identity.mjs";
import { execFileSync } from "node:child_process";
import { mkdtempSync, lstatSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** The updater installs this ZIP; a signed sibling DMG cannot vouch for it. */
export function verifyReleaseArchive(zipPath, product = PRODUCT) {
  const dir = mkdtempSync(path.join(tmpdir(), "pitlane-release-archive-"));
  try {
    execFileSync("ditto", ["-x", "-k", zipPath, dir], { stdio: "pipe" });
    const app = path.join(dir, `${product}.app`);
    if (!lstatSync(app).isDirectory()) throw new Error(`ZIP does not contain a ${product}.app directory`);
    execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "pipe" });
    execFileSync("spctl", ["--assess", "--type", "execute", app], { stdio: "pipe" });
    const staple = execFileSync("xcrun", ["stapler", "validate", app], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (!staple.includes("The validate action worked!")) throw new Error("ZIP app has no validated notarization ticket");
  } catch (error) {
    throw new Error(`Update ZIP ${path.basename(zipPath)} is not signed and notarized: ${error.stderr?.toString().trim() || error.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
