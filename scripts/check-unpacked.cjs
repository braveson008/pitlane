// afterSign: fails the build when what agents need at runtime is not runnable from the packaged app.
// The hook script and node-pty's spawn-helper must sit outside the asar, and the helper must be executable,
// or every session fails with "posix_spawnp failed" and needs-you never fires.
const fs = require("node:fs");
const path = require("node:path");

exports.default = async function checkUnpacked(context) {
  if (context.electronPlatformName !== "darwin") return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const unpacked = path.join(app, "Contents", "Resources", "app.asar.unpacked");
  const hook = path.join(unpacked, "electron", "agentHook.cjs");
  if (!fs.existsSync(hook)) throw new Error(`agentHook.cjs is not unpacked (${hook})`);
  const helpers = fs.readdirSync(path.join(unpacked, "node_modules", "node-pty", "prebuilds"))
    .map((dir) => path.join(unpacked, "node_modules", "node-pty", "prebuilds", dir, "spawn-helper"))
    .filter((file) => fs.existsSync(file));
  if (!helpers.length) throw new Error("node-pty's spawn-helper is not in the packaged app");
  for (const helper of helpers) {
    if (!(fs.statSync(helper).mode & 0o111)) throw new Error(`${helper} is not executable`);
  }
  console.log(`[check-unpacked] hook script and ${helpers.length} spawn-helper(s) are in place`);
};
