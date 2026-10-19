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

const notesUrl = (version) => `https://github.com/${GITHUB.owner}/${GITHUB.repo}/releases/tag/v${version}`;

/**
 * Checks the feed at launch and every six hours, downloads quietly, and installs when the app next quits or when
 * the owner restarts into it. `onState` hears every step; `check()` is a check by hand and resolves with its outcome.
 */
function startUpdates({ autoUpdater, packaged, env = process.env, config, onState, every = EVERY_MS, log = () => {} }) {
  if (!packaged || env.PITLANE_E2E === "1" || config?.enabled === false) return null;
  autoUpdater.setFeedURL(feedFor(config));
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  let state = { status: "idle" };
  const set = (next) => {
    state = next;
    onState(state);
  };
  autoUpdater.on("update-available", (info) => set({ status: "downloading", version: info?.version }));
  autoUpdater.on("download-progress", (progress) => set({ status: "downloading", version: state.version, percent: Math.round(progress?.percent ?? 0) }));
  autoUpdater.on("update-not-available", (info) => set({ status: "current", version: info?.version }));
  autoUpdater.on("update-downloaded", (info) => set({ status: "ready", version: info?.version, notesUrl: notesUrl(info?.version) }));
  autoUpdater.on("error", (error) => {
    log(`[updates] ${error?.message || error}`);
    // A download that fails is retried at the next check; an update already downloaded is still ready.
    if (state.status !== "ready") set({ status: "error", error: String(error?.message || error) });
  });
  const check = async () => {
    if (state.status === "ready" || state.status === "downloading") return state;
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      if (state.status !== "error") set({ status: "error", error: String(error?.message || error) });
    }
    return state;
  };
  void check();
  const timer = setInterval(() => void check(), every);
  timer.unref?.();
  return {
    check,
    install: () => autoUpdater.quitAndInstall(),
    state: () => state,
    stop: () => clearInterval(timer),
  };
}

module.exports = { feedFor, startUpdates, readUpdateConfig };
