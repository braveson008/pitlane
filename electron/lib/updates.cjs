const GITHUB = { provider: "github", owner: "braveson008", repo: "pitlane" };
const EVERY_MS = 6 * 3600_000;

/** The feed a build was packaged with (resources/update-config.json); a build without one uses Pitlane's GitHub releases. */
function feedFor(config) {
  if (config?.url) return { provider: "generic", url: config.url };
  if (config?.provider === "github" && config.owner && config.repo) return { provider: "github", owner: config.owner, repo: config.repo };
  return GITHUB;
}

function readUpdateConfig(file) {
  try {
    return JSON.parse(require("node:fs").readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

/** Checks the feed at launch and every six hours, downloads quietly, and installs when the app next quits. */
function startUpdates({ autoUpdater, packaged, env = process.env, config, onState, every = EVERY_MS, log = () => {} }) {
  if (!packaged || env.PITLANE_E2E === "1" || config?.enabled === false) return null;
  autoUpdater.setFeedURL(feedFor(config));
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("update-downloaded", (info) => onState({ ready: true, version: info?.version }));
  autoUpdater.on("error", (error) => log(`[updates] ${error?.message || error}`));
  const check = () => Promise.resolve(autoUpdater.checkForUpdates()).catch((error) => log(`[updates] ${error.message}`));
  void check();
  const timer = setInterval(check, every);
  timer.unref?.();
  return () => clearInterval(timer);
}

module.exports = { feedFor, startUpdates, readUpdateConfig };
