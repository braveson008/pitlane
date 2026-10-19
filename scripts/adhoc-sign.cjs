/**
 * electron-builder `afterPack` hook: ad-hoc sign the app when there is no
 * Developer ID to sign it with.
 *
 * Why this exists: with `CSC_IDENTITY_AUTO_DISCOVERY=false` (and equally with
 * `mac.identity: null`) electron-builder skips signing *entirely*. The bundle
 * then ships carrying Electron's own stock linker signature, whose identifier
 * is literally `Electron` and which has no entitlements attached.
 *
 * That is not merely cosmetic for this app. macOS attributes TCC permissions —
 * Microphone, Speech Recognition, Accessibility — to a code signing identity.
 * An unsigned Pitlane asks for the microphone as "Electron", cannot carry
 * `com.apple.security.device.audio-input`, and any grant the user makes is
 * liable to be attributed to something other than Pitlane.
 *
 * Ad-hoc signing fixes the identity and applies the entitlements. It does not
 * satisfy Gatekeeper on another Mac — that still needs a Developer ID and
 * notarization — but it makes a locally built app behave correctly.
 *
 * When a real identity IS configured, this does nothing and lets
 * electron-builder sign properly.
 */

const { execFileSync, spawnSync } = require("node:child_process");
const path = require("node:path");

module.exports = async function adhocSign(context) {
  if (context.electronPlatformName !== "darwin") return;

  const hasRealIdentity =
    process.env.CSC_IDENTITY_AUTO_DISCOVERY !== "false" &&
    (process.env.CSC_LINK || process.env.CSC_NAME || process.env.CSC_KEYCHAIN);
  if (hasRealIdentity) {
    console.log("[sign] Developer ID present — leaving signing to electron-builder.");
    return;
  }

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const entitlements = path.resolve(__dirname, "..", "build", "entitlements.mac.plist");

  try {
    // --deep also covers the Swift helpers in Resources/voice and Electron's
    // own frameworks. It is deprecated for Developer ID signing, but for an
    // ad-hoc local build it is the one call that reaches everything nested.
    execFileSync(
      "codesign",
      ["--force", "--deep", "--sign", "-", "--entitlements", entitlements, appPath],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    // `codesign -dv` reports on stderr even on success, and execFileSync only
    // returns stdout — hence spawnSync, so the identifier can actually be read
    // back and logged rather than reported as undefined.
    const described = spawnSync("codesign", ["-dv", appPath], { encoding: "utf8" });
    const identifier = (`${described.stderr || ""}`.match(/Identifier=(\S+)/) || [])[1] || "unknown";
    console.log(`[sign] Ad-hoc signed ${path.basename(appPath)} as ${identifier}.`);
  } catch (error) {
    // A build that cannot be signed is still a usable build; voice will simply
    // have to ask for permissions as an unidentified app.
    console.warn(`[sign] Ad-hoc signing failed, continuing unsigned: ${error.stderr?.toString().trim() || error.message}`);
  }
};
