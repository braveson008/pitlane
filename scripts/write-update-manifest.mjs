import { PRODUCT } from "./release-identity.mjs";
import { spawnSync } from "node:child_process";
import { verifyReleaseArchive } from "./verify-release-archive.mjs";
import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const unsigned = process.argv.includes("--unsigned");
const manifestName = unsigned ? "latest-mac-unsigned.yml" : "latest-mac.yml";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const artifactName = `${PRODUCT}-${packageJson.version}-arm64.zip`;
// Keep a pre-upload 404 cached at the bare URL from blocking a new release.
const artifactUrl = `${artifactName}?release=${packageJson.version}`;
const artifactPath = path.join(root, "release", artifactName);
const artifact = await readFile(artifactPath);
const metadata = await stat(artifactPath);
const sha512 = createHash("sha512").update(artifact).digest("base64");
const manifest = [
  `version: ${packageJson.version}`,
  `pitlaneSigned: ${!unsigned}`,
  "files:",
  `  - url: ${artifactUrl}`,
  `    sha512: ${sha512}`,
  `    size: ${metadata.size}`,
  `path: ${artifactUrl}`,
  `sha512: ${sha512}`,
  `releaseDate: '${new Date().toISOString()}'`,
  "",
].join("\n");

/**
 * Refuse to finish on a build that is not actually shippable.
 *
 * `dist:release` once exited 0 having failed notarisation on a network
 * timeout: the DMG was signed, unstapled, and rejected outright by Gatekeeper,
 * and nothing in the output said so. Uploading it would have handed every
 * downloader a "damaged and can't be opened" dialog.
 *
 * A release script whose success is not evidence of a release is worse than
 * one that fails loudly, so the artifact is checked here rather than trusted.
 */
const dmg = path.join(root, "release", `${PRODUCT}-${packageJson.version}-arm64.dmg`);
const check = (command, args) => {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed: ${result.error?.message || result.stderr || result.stdout}`);
  }
  return `${result.stdout || ""}${result.stderr || ""}`;
};

if (!unsigned) {
  const stapled = check("xcrun", ["stapler", "validate", dmg]);
  if (!/The validate action worked/.test(stapled)) {
    console.error(
      `\nNot shippable: ${path.basename(dmg)} has no notarisation ticket stapled to it.\n` +
        `${stapled.trim()}\n\n` +
        "Notarisation did not complete — Apple's service times out often enough that this is\n" +
        "usually worth simply running again. Do not upload this build.",
    );
    process.exit(1);
  }

  const gatekeeper = check("spctl", ["-a", "-vvv", "-t", "open", "--context", "context:primary-signature", dmg]);
  if (!/accepted/.test(gatekeeper)) {
    console.error(`\nNot shippable: Gatekeeper rejects ${path.basename(dmg)}.\n${gatekeeper.trim()}`);
    process.exit(1);
  }

  verifyReleaseArchive(artifactPath);
  console.log(`Verified ${path.basename(dmg)} and update ZIP: signed, notarised, accepted by Gatekeeper.`);
}

await writeFile(path.join(root, "release", manifestName), manifest, "utf8");
console.log(`Wrote release/${manifestName} for ${artifactName}`);
