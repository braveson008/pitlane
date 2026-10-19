import { feedUrl, githubRepo } from "./release-identity.mjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { loadEnv } from "./load-env.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv(root);

const unsigned = process.argv.includes("--unsigned");
// A Windows release has the feed baked in but is not code-signed yet, so none
// of the Apple notarisation settings apply to it.
const windows = process.argv.includes("--windows");
const updateUrl = unsigned ? "" : feedUrl();
const github = unsigned || updateUrl ? null : githubRepo();
if (!unsigned && !updateUrl && !github) {
  throw new Error("A signed release needs an update feed: PITLANE_UPDATE_URL, or a GitHub \"repository\" in package.json");
}

/**
 * Everything a signed build needs, checked before anything is built.
 *
 * Without this the failure arrives at the end: electron-builder compiles,
 * packages, signs with whichever identity it found first, and only then does
 * notarisation reject it — with a message about the submission rather than
 * about the credential that was wrong. Two of these values are ten uppercase
 * characters and belong to different systems, so transposing them is the
 * likely mistake and worth naming explicitly.
 */
if (!unsigned && !windows) {
  const TEAM_OR_KEY = /^[A-Z0-9]{10}$/;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const problems = [];

  const teamId = String(process.env.APPLE_TEAM_ID || "").trim();
  const keyId = String(process.env.APPLE_API_KEY_ID || "").trim();
  const issuer = String(process.env.APPLE_API_ISSUER || "").trim();
  const keyPath = String(process.env.APPLE_API_KEY || "").trim();

  if (!teamId) problems.push("APPLE_TEAM_ID is not set (Membership details on developer.apple.com)");
  else if (!TEAM_OR_KEY.test(teamId)) problems.push(`APPLE_TEAM_ID "${teamId}" is not ten uppercase alphanumerics`);

  if (!keyId) problems.push("APPLE_API_KEY_ID is not set (the AuthKey_XXXXXXXXXX.p8 filename)");
  else if (!TEAM_OR_KEY.test(keyId)) problems.push(`APPLE_API_KEY_ID "${keyId}" is not ten uppercase alphanumerics`);

  if (teamId && keyId && teamId === keyId) {
    problems.push("APPLE_TEAM_ID and APPLE_API_KEY_ID are the same value — one of them is the other's");
  }

  if (!issuer) problems.push("APPLE_API_ISSUER is not set (Issuer ID on appstoreconnect.apple.com)");
  else if (!UUID.test(issuer)) problems.push(`APPLE_API_ISSUER "${issuer}" is not a UUID — it may be a Key ID`);

  if (!keyPath) problems.push("APPLE_API_KEY is not set (path to your AuthKey_*.p8)");
  else if (!existsSync(keyPath)) problems.push(`APPLE_API_KEY points at ${keyPath}, which does not exist`);
  else if (!readFileSync(keyPath, "utf8").includes("BEGIN PRIVATE KEY")) {
    problems.push(`APPLE_API_KEY at ${keyPath} is not a PKCS#8 private key`);
  }

  if (problems.length) {
    throw new Error(
      `Cannot make a signed build:\n  - ${problems.join("\n  - ")}\n\n` +
        "These live in .env (gitignored). A signed build without them would package, sign\n" +
        "with whichever identity was found first, and fail at notarisation.",
    );
  }
  console.log(`Signing as team ${teamId}, notarising with key ${keyId}`);
}

await mkdir(path.join(root, "build"), { recursive: true });
await writeFile(
  path.join(root, "build", "update-config.json"),
  `${JSON.stringify(github ? { enabled: true, provider: "github", ...github } : { enabled: Boolean(updateUrl), url: updateUrl }, null, 2)}\n`,
  "utf8",
);
console.log(updateUrl ? `Configured updates from ${updateUrl}` : github ? `Configured updates from github.com/${github.owner}/${github.repo} releases` : "Built without an update feed");
