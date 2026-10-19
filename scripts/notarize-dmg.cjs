/**
 * electron-builder `afterAllArtifactBuild` hook: sign, notarize and staple the
 * DMG itself.
 *
 * `mac.notarize: true` notarizes the *app*, and electron-builder staples the
 * ticket into the bundle inside the disk image. The disk image is then built
 * around it and left alone: unsigned, un-notarized, and with no ticket of its
 * own. 0.1.13 shipped that way and was only caught by comparing it against the
 * previous release by hand.
 *
 * It matters on a first launch with no network, or on a network that cannot
 * reach Apple. Gatekeeper checks a stapled ticket locally; with none on the
 * disk image it has to ask Apple whether the thing was notarized, and when it
 * cannot ask, the download is refused. The app inside is impeccable and the
 * user never gets far enough to find out.
 *
 * The three steps have to happen in this order, and each invalidates the one
 * before it:
 *
 *   1. codesign the DMG — changes its bytes
 *   2. notarize *those* bytes — a ticket is issued against a hash
 *   3. staple — writes the ticket into the image
 *
 * Signing after notarizing would invalidate the ticket; stapling before
 * notarizing has nothing to staple. Then the blockmap has to be rebuilt,
 * because it describes a file that has changed three times since it was made.
 *
 * Skipped entirely for an unsigned build. `npm run dist:unsigned` has no
 * identity to sign with and no business talking to Apple.
 */

const { execFileSync, spawnSync } = require("node:child_process");
const { buildBlockMap } = require("app-builder-lib/out/targets/blockmap/blockmap");

/** The credentials `notarytool` needs, all three or none. */
const NOTARY_ENV = ["APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"];

/**
 * The Developer ID this Mac can sign with.
 *
 * Read from the keychain rather than configured, so it stays in step with
 * whatever electron-builder itself auto-discovered a moment earlier. Two
 * identities means the build is ambiguous and should say so rather than pick.
 */
function developerId() {
  const found = spawnSync("security", ["find-identity", "-v", "-p", "codesigning"], { encoding: "utf8" });
  const names = [...`${found.stdout || ""}`.matchAll(/"(Developer ID Application: [^"]+)"/g)].map((match) => match[1]);
  const unique = [...new Set(names)];
  if (unique.length > 1) {
    console.warn(`[dmg] ${unique.length} Developer ID identities in the keychain; using the first: ${unique[0]}`);
  }
  return unique[0] ?? null;
}

/** Signs the image, retrying the timestamp round trip a couple of times. */
function signWithRetry(dmg, identity, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      execFileSync("codesign", ["--sign", identity, "--timestamp", "--force", dmg], { stdio: "inherit" });
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
      console.warn(`[dmg] Signing failed (attempt ${attempt} of ${attempts}); retrying.`);
      // Long enough for a flaky timestamp server to recover, short enough that
      // nobody sits watching it.
      execFileSync("sleep", [String(attempt * 5)]);
    }
  }
}

module.exports = async function notarizeDmg(context) {
  const dmgs = (context.artifactPaths ?? []).filter((file) => file.endsWith(".dmg"));
  if (dmgs.length === 0) return;

  if (process.env.CSC_IDENTITY_AUTO_DISCOVERY === "false") {
    console.log("[dmg] Unsigned build — leaving the disk image as it is.");
    return;
  }

  const missing = NOTARY_ENV.filter((name) => !process.env[name]);
  const identity = developerId();

  /**
   * A signed release that cannot be signed is a failed build, not a warning.
   *
   * This hook exists because an unsigned disk image looks exactly like a signed
   * one until somebody else's Mac refuses it. Letting that through quietly is
   * the failure it was written to prevent — and it happened once, when a
   * timestamp round trip failed and the throw was swallowed.
   */
  const mustSign = process.env.CSC_IDENTITY_AUTO_DISCOVERY !== "false";

  // Loud, because the failure it prevents is invisible: the build succeeds, the
  // DMG works on the machine that made it, and Gatekeeper turns it away
  // somewhere else.
  if (missing.length || !identity) {
    const why = !identity ? "no Developer ID in the keychain" : `missing ${missing.join(", ")}`;
    if (mustSign) {
      throw new Error(
        `[dmg] Cannot notarize the disk image — ${why}. This is a signed release; shipping an unsigned image would look identical here and be refused on anyone else's Mac.`,
      );
    }
    console.warn(`[dmg] NOT notarizing the disk image — ${why}.`);
    return;
  }

  for (const dmg of dmgs) {
    console.log(`[dmg] Signing ${dmg}`);
    // `--timestamp` contacts Apple's timestamp authority, so signing is a
    // network call that can simply fail — and did, mid-release, which threw out
    // of this hook and let an unsigned disk image ship. Retried, because one
    // bad round trip is not a reason to hand somebody a build Gatekeeper will
    // refuse.
    signWithRetry(dmg, identity);

    console.log("[dmg] Submitting to the notary service — this takes a few minutes.");
    execFileSync(
      "xcrun",
      [
        "notarytool", "submit", dmg,
        "--key", process.env.APPLE_API_KEY,
        "--key-id", process.env.APPLE_API_KEY_ID,
        "--issuer", process.env.APPLE_API_ISSUER,
        "--wait",
        // Apple's queue occasionally holds one submission for hours. Waiting
        // that out once kept a release unpublished all afternoon; give up
        // after twenty minutes and say so, so a fresh submission can be sent.
        "--timeout", "20m",
      ],
      { stdio: "inherit" },
    );

    execFileSync("xcrun", ["stapler", "staple", dmg], { stdio: "inherit" });

    // Signing and stapling both rewrote the file, so the blockmap electron-builder
    // generated describes bytes that are no longer there.
    console.log("[dmg] Rebuilding the blockmap.");
    await buildBlockMap(dmg, "gzip", `${dmg}.blockmap`);

    // Proof, rather than the absence of an error. `stapler staple` reports
    // success for work it did not do often enough to be worth checking.
    const stapled = spawnSync("xcrun", ["stapler", "validate", dmg], { encoding: "utf8" });
    if (stapled.status !== 0) {
      throw new Error(`[dmg] ${dmg} has no stapled ticket after notarization:\n${stapled.stdout || stapled.stderr}`);
    }
    console.log(`[dmg] ${dmg} is signed, notarized and stapled.`);
  }
};
