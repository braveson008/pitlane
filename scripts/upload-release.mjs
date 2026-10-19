#!/usr/bin/env node
import { feedUrl, FEED_PREFIX, PRODUCT } from "./release-identity.mjs";
/**
 * Puts a built release in R2.
 *
 * The DMG is not the release. `latest-mac.yml` is what electron-updater reads
 * to discover a new version, and the blockmaps are what let it fetch only the
 * changed parts instead of ninety-six megabytes every week. Upload the DMG
 * alone and the updater either sees nothing or finds a manifest naming files
 * that are not there — and that failure is invisible to you, because it
 * happens inside somebody else's copy of the app.
 *
 * So this refuses to upload a partial set. Better to fail here than to ship a
 * release that silently cannot be updated from.
 *
 *   node scripts/with-env.mjs node scripts/upload-release.mjs
 */
import { createHash } from "node:crypto";
import { verifyReleaseArchive } from "./verify-release-archive.mjs";
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = path.join(root, "release");

const required = ["R2_ENDPOINT", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Missing ${missing.join(", ")}. These live in .env; run through scripts/with-env.mjs.`);
  process.exit(1);
}

/**
 * Content types matter here. R2 serves what it is told, and a DMG sent as
 * application/octet-stream is fine, while a YAML manifest sent as one makes
 * some clients download it rather than read it.
 */
const TYPES = {
  ".dmg": "application/x-apple-diskimage",
  ".zip": "application/zip",
  ".blockmap": "application/octet-stream",
  ".yml": "text/yaml; charset=utf-8",
  ".exe": "application/vnd.microsoft.portable-executable",
};


const present = existsSync(releaseDir) ? readdirSync(releaseDir) : [];

/**
 * The version being released, taken from package.json rather than from
 * whatever is lying in release/.
 *
 * `release/` accumulates: it holds every build that has not been cleaned up.
 * Picking the first .dmg found uploaded 0.1.12 while the manifest beside it
 * advertised 0.1.13 — so every installed copy was told to update to a file
 * that had never been uploaded. Nothing failed and nothing said so.
 */
const version = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
const forVersion = (name) => name.includes(`-${version}-`);

/**
 * The Mac release: DMG for new downloads, ZIP for the updater, both blockmaps,
 * and `latest-mac.yml`, all verified as signed and notarised.
 */
function checkMac() {
  const dmg = present.find((name) => name.endsWith(".dmg") && forVersion(name));
  const zip = present.find((name) => name.endsWith(".zip") && forVersion(name));
  const manifest = present.find((name) => name === "latest-mac.yml");
  const blockmaps = present.filter((name) => name.endsWith(".blockmap") && forVersion(name));

  const problems = [];
  if (!dmg) problems.push(`no ${PRODUCT}-${version}-*.dmg in release/ — run npm run dist:release first`);
  if (!zip) problems.push(`no ${PRODUCT}-${version}-*.zip in release/ — electron-updater installs from the zip, not the dmg`);
  if (!manifest) problems.push("no latest-mac.yml — without it no installed copy will ever see this release");
  if (blockmaps.length < 2) problems.push(`only ${blockmaps.length} blockmap(s) for ${version}; expected 2 — updates would download in full`);

  // The manifest is what installed copies read. If it names a different version
  // than the files being uploaded, the release is broken in the one way nothing
  // downstream can recover from.
  if (manifest) {
    const manifestText = readFileSync(path.join(releaseDir, manifest), "utf8");
    if (!/^pitlaneSigned:\s*true\s*$/m.test(manifestText)) {
      problems.push("latest-mac.yml is not a verified signed-release manifest — rebuild with npm run dist:release");
    }
    if (zip) {
      const digest = createHash("sha512").update(readFileSync(path.join(releaseDir, zip))).digest("base64");
      const expected = /^sha512:\s*(\S+)/m.exec(manifestText)?.[1];
      if (digest !== expected) problems.push("latest-mac.yml checksum does not match the ZIP — rebuild before uploading");
    }
    const named = /^version:\s*(\S+)/m.exec(manifestText)?.[1];
    if (named && named !== version) {
      problems.push(`latest-mac.yml says ${named} but package.json says ${version} — rebuild before uploading`);
    }
    if (zip && !manifestText.includes(zip)) {
      problems.push(`latest-mac.yml does not reference ${zip} — installed copies would download a file that is not here`);
    }
  }

  /**
   * Refuse to publish a disk image Gatekeeper will turn away.
   *
   * The signing hook already does this work and already throws when it cannot —
   * but electron-builder swallowed that throw once and exited zero, and an
   * unsigned image is indistinguishable from a signed one on the machine that
   * built it. It is only wrong on somebody else's Mac, which is the worst
   * possible place to find out.
   *
   * So this is checked here too, at the last point before it becomes everyone's
   * problem. Cheap, and it does not depend on anything upstream having behaved.
   */
  if (dmg) {
    const file = path.join(releaseDir, dmg);
    const verdict = (() => {
      try {
        execFileSync("spctl", ["-a", "-t", "open", "--context", "context:primary-signature", file], {
          stdio: ["ignore", "ignore", "pipe"],
        });
        return "";
      } catch (error) {
        return String(error.stderr || error.message).trim();
      }
    })();

    if (verdict) {
      problems.push(
        `${dmg} is not accepted by Gatekeeper (${verdict.split("\n").pop()}). ` +
          "Re-run the release build; do not publish this image.",
      );
    }
  }

  if (problems.length === 0 && zip) {
    try {
      verifyReleaseArchive(path.join(releaseDir, zip));
    } catch (error) {
      problems.push(error.message);
    }
  }

  if (problems.length) {
    console.error(`Refusing to upload a partial release:\n  - ${problems.join("\n  - ")}`);
    process.exit(1);
  }

  return {
    files: [dmg, `${dmg}.blockmap`, zip, `${zip}.blockmap`, manifest].filter(
      (name, index, all) => all.indexOf(name) === index && present.includes(name),
    ),
    manifest,
    primary: dmg,
  };
}

/**
 * The Windows release: the NSIS installer, its blockmap, and `latest.yml`,
 * which electron-builder wrote beside it. Not code-signed yet, so nothing is
 * asked of Gatekeeper's Windows counterpart; the manifest must still name this
 * version and this exact installer, or installed copies would fetch a file
 * that is not there or fail its checksum.
 */
function checkWindows() {
  const installer = `${PRODUCT}-${version}-x64-setup.exe`;
  const manifest = "latest.yml";
  const problems = [];
  if (!present.includes(installer)) problems.push(`no ${installer} in release/ — run npm run dist:win first`);
  if (!present.includes(`${installer}.blockmap`)) problems.push(`no ${installer}.blockmap — updates would download in full`);
  if (!present.includes(manifest)) problems.push("no latest.yml — without it no installed copy will ever see this release");
  if (!problems.length) {
    const manifestText = readFileSync(path.join(releaseDir, manifest), "utf8");
    const named = /^version:\s*(\S+)/m.exec(manifestText)?.[1];
    if (named !== version) problems.push(`latest.yml says ${named} but package.json says ${version}`);
    if (!new RegExp(`^path:\\s*${installer.replace(/[.]/g, "\\.")}\\s*$`, "m").test(manifestText)) {
      problems.push(`latest.yml does not name ${installer}`);
    }
    const digest = createHash("sha512").update(readFileSync(path.join(releaseDir, installer))).digest("base64");
    if (/^sha512:\s*(\S+)/m.exec(manifestText)?.[1] !== digest) problems.push("latest.yml checksum does not match the installer");
  }
  if (problems.length) {
    console.error(`Refusing to upload a partial release:\n  - ${problems.join("\n  - ")}`);
    process.exit(1);
  }
  // The manifest last, so nothing is told about an installer still uploading.
  return { files: [installer, `${installer}.blockmap`, manifest], manifest, primary: installer };
}

const { files, manifest, primary } = process.argv.includes("--windows") ? checkWindows() : checkMac();

const client = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const bucket = process.env.R2_BUCKET;
console.log(`Uploading ${files.length} files to ${bucket}/${FEED_PREFIX}`);

for (const name of files) {
  const full = path.join(releaseDir, name);
  const size = statSync(full).size;
  const type = TYPES[path.extname(name)] ?? "application/octet-stream";
  process.stdout.write(`  ${name} (${(size / 1024 / 1024).toFixed(1)} MB) … `);
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: `${FEED_PREFIX}${name}`,
      Body: createReadStream(full),
      ContentLength: size,
      ContentType: type,
      // The manifest changes every release and must never be served stale, or
      // an installed copy keeps being told the old version is the latest.
      CacheControl: name === manifest ? "no-cache, must-revalidate" : "public, max-age=31536000, immutable",
    }),
  );
  console.log("done");
}

const feed = feedUrl();
console.log(`\nUploaded. ${feed ? `${feed}/${primary}` : primary}`);
