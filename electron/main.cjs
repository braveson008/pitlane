const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require("electron");
const { isAppUrl, externalUrl, quotePath } = require("./lib/navigation.cjs");
const { createBatcher } = require("./lib/batch.cjs");
const { randomUUID } = require("node:crypto");
const { createWorkspacePool } = require("./lib/workspaces.cjs");
const { detectLocalFiles, syncLocalFiles } = require("./lib/localFiles.cjs");
const { createLiveChanges } = require("./lib/liveChanges.cjs");
const { runGit } = require("./lib/git.cjs");
const { credentialEnv, reviewerEnv } = require("./lib/credentials.cjs");
const { carryMovedProjects } = require("./lib/projectMoves.cjs");
const { startUpdates, readUpdateConfig } = require("./lib/updates.cjs");
const { addWatch, editWatch, removeWatch, withIds } = require("./lib/watchEdits.cjs");
const { ensureClaudeTrust } = require("./lib/claudeTrust.cjs");
const { hookSettings } = require("./lib/agentEvents.cjs");
const { createTicketBook } = require("./lib/tickets.cjs");
const { createDispatcher } = require("./lib/dispatcher.cjs");
const { ticketBranch, adoptableBranch, remoteBranches } = require("./lib/branches.cjs");
const { leadPrompt } = require("./lib/leadPrompt.cjs");
const { readTicket, pollAssigned } = require("./lib/tracker.cjs");
const { trackerSourceFamily } = require("./lib/trackerTasks.cjs");
const { prForBranch, prsForProject } = require("./lib/prs.cjs");
const { findReviewRequests } = require("./lib/reviews.cjs");
const { reviewPrompt } = require("./lib/reviewPrompt.cjs");
const { readDraft, changedLines, postDraft } = require("./lib/reviewDraft.cjs");
const { repoSlug } = require("./lib/reviews.cjs");
const { readFeedback, githubLogin } = require("./lib/feedback.cjs");
const { afterTurn, isTerminalReply } = require("./lib/ticketFlow.cjs");
const { watchAgentEvents } = require("./lib/agentEvents.cjs");
const { Notification } = require("electron");
const os = require("node:os");
const fs = require("node:fs");
const { readJson, writeJsonAtomic } = require("./lib/atomicJson.cjs");
const { createRegistry } = require("./lib/registry.cjs");
const { createWindowManager } = require("./lib/windows.cjs");
const { createSessionManager } = require("./lib/sessions.cjs");
const { resolveCommand, agentEnv } = require("./lib/agents.cjs");

if (process.env.PITLANE_USER_DATA_DIR) app.setPath("userData", process.env.PITLANE_USER_DATA_DIR);
const E2E = process.env.PITLANE_E2E === "1";
const dataFile = (name) => path.join(app.getPath("userData"), name);

let registry;
let windows;
let sessions;
let pool;
let liveChanges;
// End-to-end tests only: a downloaded update, so the status line and its key can be seen.
let updateState = E2E && process.env.PITLANE_FAKE_UPDATE ? JSON.parse(process.env.PITLANE_FAKE_UPDATE) : null;
let updates = null;

function installUpdate() {
  // Quitting asks first when agents are running; the update is installed either way at the next quit.
  updates?.install();
}

async function checkForUpdatesByHand() {
  if (!updates) {
    return void dialog.showMessageBox({ message: "Updates are checked in the installed app", detail: "This copy is a development build, or was built without an update feed." });
  }
  const state = await updates.check();
  if (state.status === "ready") {
    const { response } = await dialog.showMessageBox({ message: `Pitlane ${state.version} is ready`, detail: "Restart now to update. Agents that are running are stopped; their workspaces and changes are kept.", buttons: ["Restart Now", "Later", "What's New"], defaultId: 0, cancelId: 1 });
    if (response === 0) installUpdate();
    if (response === 2 && state.notesUrl) void shell.openExternal(state.notesUrl);
  } else if (state.status === "downloading") {
    dialog.showMessageBox({ message: `Pitlane ${state.version} is downloading`, detail: "You'll get a notification when it's ready." });
  } else if (state.status === "current") {
    dialog.showMessageBox({ message: "Pitlane is up to date", detail: `You have the latest version, ${app.getVersion()}.` });
  } else if (state.status === "error") {
    dialog.showMessageBox({ type: "warning", message: "Couldn't check for updates", detail: state.error });
  }
}
let tickets;
let dispatcher;
const attachments = new Map();
const liveSubscriptions = new Map();

const APP_URL = process.env.PITLANE_DEV_SERVER
  ? `${process.env.PITLANE_DEV_SERVER}/`
  : pathToFileURL(path.join(__dirname, "..", "dist", "index.html")).href;

function openExternal(url) {
  const safe = externalUrl(url);
  if (safe) void shell.openExternal(safe);
}

function guardNavigation(contents) {
  contents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    if (!isAppUrl(url, APP_URL)) event.preventDefault();
  });
}

function loadRenderer(window, query = {}) {
  const search = new URLSearchParams(query).toString();
  if (process.env.PITLANE_DEV_SERVER) return window.loadURL(`${process.env.PITLANE_DEV_SERVER}/?${search}`);
  return window.loadFile(path.join(__dirname, "..", "dist", "index.html"), { search });
}

const settings = () => readJson(dataFile("settings.json"), {});
const themeOf = (project) => project?.theme || settings().defaultTheme || "vt220";
const BACKGROUND = { vt220: "#0a0a08", acme: "#ffffea", "night-city": "#00000000", "green-screen": "#040a05", daylight: "#fafafa", synthwave: "#1a1033", midnight: "#0e1320" };
const pendingBounds = new Map();

function createWindow(projectId) {
  const project = projectId ? registry.get(projectId) : null;
  const theme = themeOf(project);
  // Night City's cut corners need a see-through window without the system shadow, which would draw the square.
  const nightCity = theme === "night-city";
  const bounds = pendingBounds.get(projectId);
  pendingBounds.delete(projectId);
  const window = new BrowserWindow({
    width: project ? 1100 : 720,
    height: project ? 720 : 520,
    ...(bounds || {}),
    minWidth: 640,
    minHeight: 420,
    title: project ? project.name : "Pitlane",
    backgroundColor: BACKGROUND[theme],
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 12, y: 8 },
    transparent: nightCity,
    hasShadow: !nightCity,
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: false },
  });
  guardNavigation(window.webContents);
  const contentsId = window.webContents.id;
  window.webContents.once("destroyed", () => {
    for (const map of [attachments, liveSubscriptions]) {
      for (const [key, stop] of map) {
        if (!key.startsWith(`${contentsId}:`)) continue;
        stop();
        map.delete(key);
      }
    }
  });
  void loadRenderer(window, projectId ? { project: projectId } : {});
  return window;
}

function rebuildDockMenu() {
  if (!app.dock) return;
  app.dock.setMenu(Menu.buildFromTemplate(registry.list().map((project) => ({
    label: project.name,
    click: () => windows.openProject(project.id),
  }))));
}

function updateMenuItem() {
  if (updateState?.status === "ready") return { label: `Restart to Update to ${updateState.version}`, click: () => installUpdate() };
  if (updateState?.status === "downloading") return { label: `Downloading ${updateState.version}${updateState.percent ? ` (${updateState.percent}%)` : ""}…`, enabled: false };
  return { label: "Check for Updates…", click: () => void checkForUpdatesByHand() };
}

function buildAppMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: "about" },
        updateMenuItem(),
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { label: "File", submenu: [{ label: "Open Project…", accelerator: "CmdOrCtrl+N", click: () => windows.openPicker() }, { role: "close" }] },
    { role: "editMenu" },
    { role: "windowMenu" },
  ]));
}

async function chooseFolder() {
  if (E2E) return process.env.PITLANE_TEST_FOLDER ? { path: process.env.PITLANE_TEST_FOLDER } : null;
  const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
  return result.canceled || !result.filePaths[0] ? null : { path: result.filePaths[0] };
}

const failure = (error) => ({ error: error instanceof Error ? error.message : String(error) });

function workspaceList(projectId) {
  const project = registry.get(projectId);
  return project ? pool.slots(project) : [];
}

function broadcastSessions(projectId) {
  const window = windows.windowFor(projectId);
  if (window && !window.isDestroyed()) window.webContents.send("sessions:changed", { projectId, sessions: sessions.list(projectId), workspaces: workspaceList(projectId) });
}

const busyMessage = (message) => (/busy$/.test(message) ? `${message} — park one (x) or raise the limit (L)` : message);

function detach(webContents, id) {
  const key = `${webContents.id}:${id}`;
  attachments.get(key)?.();
  attachments.delete(key);
}

/**
 * Starts an agent in a workspace slot on `branch`: the one way a session begins, for `n` and for tickets.
 * Returns the session, `{ busy, error }` when every slot is taken, or `{ error }`.
 */
// A review agent reads and writes a draft; it has no reason to talk to the host or fetch anything.
const REVIEW_DENIED = ["Bash(gh:*)", "Bash(glab:*)", "Bash(git push:*)", "Bash(curl:*)", "Bash(wget:*)"];

async function startSession(project, { id = randomUUID(), agent, branch, review, initialPrompt, ticketKey, extraArgs = [], name }) {
  // A pty started in a folder that is gone prints nothing and exits 1, which reads as a broken agent.
  if ((await registry.status(project.id)) !== "ok") return { error: "Folder not found", missing: true };
  if (project.localFiles === undefined) {
    const candidates = await detectLocalFiles(project.path).catch(() => []);
    if (candidates.length) return { error: "confirm-local-files", candidates };
    registry.update(project.id, { localFiles: [] });
  }
  // Agents never work in the owner's checkout: each session takes a workspace slot on its own branch.
  let slot;
  try {
    slot = review
      ? await pool.acquireDetached(project, { sessionId: id, fetchRef: review.fetchRef, baseRef: review.baseRef, env: (await credentialEnv(project)).env })
      : await pool.acquire(project, { sessionId: id, branch });
  } catch (error) {
    return /busy$/.test(error.message) ? { busy: true, error: error.message } : { error: error.message };
  }
  let credentials;
  const args = [...extraArgs];
  const env = {};
  try {
    if (review) {
      // A PR that ships its own review draft would be putting words in the owner's mouth.
      if (await runGit(slot.path, ["ls-files", "--", ".pitlane"])) throw new Error("this PR contains a .pitlane/ folder — review it yourself");
      fs.rmSync(path.join(slot.path, ".pitlane"), { recursive: true, force: true });
      // The owner's .env and tokens stay out of a teammate's code: no local files, no host credentials.
      const emptyDir = dataFile("reviewer-config");
      fs.mkdirSync(emptyDir, { recursive: true });
      credentials = { env: reviewerEnv({ emptyDir }) };
      if (agent === "claude") args.push("--disallowedTools", ...REVIEW_DENIED);
    } else {
      await syncLocalFiles(project.path, slot.path, registry.get(project.id).localFiles || []).catch((error) => console.log(`[local-files] ${error.message}`));
      credentials = await credentialEnv(registry.get(project.id));
    }
    // Where "what the agent changed" is measured from; bounded so a large repository never holds up the start.
    await Promise.race([liveChanges.start(id, slot.path).catch(() => {}), new Promise((resolve) => setTimeout(resolve, 1500))]);
    if (agent === "claude") {
      // A fresh workspace would otherwise stop on Claude's "trust this folder?" screen, with nobody there to answer.
      // It is trusted only as far as the owner already trusts the project: trust is what lets a repo's hooks run.
      if (!E2E) {
        if (ticketKey && !claudeTrusts(project.path)) throw new Error("open this project in Claude once and trust it, then Pitlane can run agents in its workspaces");
        if (claudeTrusts(project.path)) ensureClaudeTrust(slot.path, os.homedir());
      }
      args.push("--settings", hookSettings({ sessionId: id, node: hookNode(), hookScript: hookScriptPath(), asNode: true }));
      env.PITLANE_EVENTS_DIR = dataFile("agent-events");
    }
  } catch (error) {
    // Nothing started, so the slot it took is handed back rather than left busy forever.
    await pool.release(project, slot.index, id).catch(() => {});
    return { error: error.message };
  }
  // A review's prompt names the base commit, which is only known once the slot has fetched it.
  const prompt = typeof initialPrompt === "function" ? initialPrompt(slot) : initialPrompt;
  if (prompt) args.push(prompt);
  return sessions.create({
    id,
    projectId: project.id,
    agent,
    name,
    cwd: slot.path,
    slot: slot.index,
    branch: slot.branch,
    ticketKey,
    warning: credentials.warning,
    args,
    extraEnv: { ...credentials.env, ...env },
  });
}

function claudeTrusts(projectPath) {
  try {
    return JSON.parse(fs.readFileSync(path.join(os.homedir(), ".claude.json"), "utf8")).projects?.[projectPath]?.hasTrustDialogAccepted === true;
  } catch {
    return false;
  }
}

// The lead agent runs in each CLI's own unattended mode: Claude's auto mode (its denials surface as needs-you),
// and the one flag Codex documents for no prompts, in a workspace slot of its own.
const UNATTENDED = { claude: ["--permission-mode", "auto"], codex: ["--dangerously-bypass-approvals-and-sandbox"] };

const hostKind = (project, remotes) => (project.github?.kind === "gitlab" || /gitlab/i.test(remotes) ? "gitlab" : "github");

/** The branch a PR merges into, so its diff is its own and not whatever the trunk gained since. */
async function prBase(project, host, number) {
  const env = (await credentialEnv(project)).env;
  const remote = await runGit(project.path, ["remote", "get-url", "origin"]).catch(() => "");
  const answer = await new Promise((resolve) => {
    const [cmd, args] = host === "gitlab"
      ? ["glab", ["mr", "view", String(number), "-F", "json"]]
      : ["gh", ["pr", "view", String(number), "--repo", repoSlug(remote) || "", "--json", "baseRefName"]];
    const command = E2E && process.env.PITLANE_GH_COMMAND && cmd === "gh" ? JSON.parse(process.env.PITLANE_GH_COMMAND) : [cmd];
    require("node:child_process").execFile(command[0], [...command.slice(1), ...args], { cwd: project.path, env: { ...agentEnv(process.env), ...env }, timeout: 30_000 }, (error, stdout) => resolve(error ? "" : String(stdout)));
  });
  try {
    const parsed = JSON.parse(answer || "{}");
    return parsed.baseRefName || parsed.target_branch || project.trunk;
  } catch {
    return project.trunk;
  }
}

/** Starts the lead agent on a teammate's PR: its head, detached, and a review that is written down, never posted. */
async function startReview(project, item) {
  const remotes = await runGit(project.path, ["remote", "-v"]).catch(() => "");
  const host = hostKind(project, remotes);
  const number = item.pr?.number;
  if (!number) return { ok: false, error: "the review request has no PR number" };
  const agent = project.leadAgent === "codex" ? "codex" : "claude";
  const baseRef = await prBase(project, host, number);
  const prompt = (slot) => reviewPrompt({ pr: { number, title: item.title, url: item.url, author: item.pr.author }, base: slot.base || `origin/${baseRef}`, host });
  const result = await startSession(project, {
    agent,
    review: { fetchRef: host === "gitlab" ? `merge-requests/${number}/head` : `pull/${number}/head`, baseRef },
    initialPrompt: prompt,
    ticketKey: item.key,
    extraArgs: UNATTENDED[agent],
    name: `${item.key} ${item.title}`,
  });
  if (result.busy) return { ok: false, busy: true };
  if (result.error) return { ok: false, error: result.error === "confirm-local-files" ? "confirm which local files to copy first (press n once)" : result.error };
  if (result.state === "failed") return { ok: false, error: result.error };
  return { ok: true, sessionId: result.id };
}

/** Starts the project's lead agent on one ticket: its branch (adopted if one exists), the ticket in full, the workflow. */
async function startTicket(project, ticket) {
  const remote = await remoteBranches(project.path);
  // A remote branch name is someone else's text; one that could mean anything to a shell is not adopted.
  const found = adoptableBranch({ key: ticket.key, remoteBranches: remote });
  const adopted = found && /^[A-Za-z0-9._/-]+$/.test(found) ? found : null;
  const branch = adopted || ticketBranch({ key: ticket.key, title: ticket.title, remoteBranches: remote });
  const watch = (project.watches || []).filter((candidate) => candidate.kind === "ticket-assigned" && candidate.server).sort((a, b) => Number(b.enabled) - Number(a.enabled))[0];
  const full = watch ? await readTicket({ cwd: project.path, server: watch.server, scope: watch.scope, key: ticket.key, model: watch.model }).catch(() => null) : null;
  // Without its description an unattended agent would work from the title alone.
  if (watch && !full) return { ok: false, error: "could not read the ticket from the tracker" };
  // The branch may still be in a slot an earlier attempt left held; its work is kept as a local commit first.
  const holding = pool.slots(project).find((slot) => slot.state === "held" && slot.branch === branch);
  if (holding) await pool.park(project, holding.index, holding.sessionId).catch(() => {});
  const remotes = await runGit(project.path, ["remote", "-v"]).catch(() => "");
  const agent = project.leadAgent === "codex" ? "codex" : "claude";
  const prompt = leadPrompt({
    ticket: { ...ticket, description: full?.description || ticket.description, url: full?.url || ticket.url },
    branch,
    base: await pool.base(project),
    adopted: Boolean(adopted),
    host: hostKind(project, remotes),
    feedback: ticket.priority === "feedback" ? ticket.feedback : "",
  });
  const result = await startSession(project, { agent, branch, initialPrompt: prompt, ticketKey: ticket.key, extraArgs: UNATTENDED[agent], name: `${ticket.key} ${ticket.title}` });
  if (result.busy) return { ok: false, busy: true };
  if (result.error === "confirm-local-files") return { ok: false, error: "confirm which local files to copy first (press n once)" };
  if (result.error) return { ok: false, error: result.error };
  if (result.state === "failed") return { ok: false, error: result.error };
  // The feedback is in this prompt; a later restart of the ticket is not about it any more.
  if (ticket.priority === "feedback") setTicket(project.id, ticket.key, { priority: undefined });
  return { ok: true, sessionId: result.id, branch };
}

function broadcastTickets(projectId) {
  const window = windows.windowFor(projectId);
  if (window && !window.isDestroyed()) window.webContents.send("tickets:changed", { projectId, tickets: tickets.list(projectId), pausedUntil: dispatcher.pausedUntil() });
}

const runningTicketSessions = () => registry.list().reduce((count, project) => count + sessions.list(project.id).filter((session) => session.ticketKey && session.state === "running").length, 0);

const PAUSE_MS = 30 * 60_000;
let quitting = false;

// Held until clicked or closed: an unreferenced notification can be collected and its click lost.
const shownNotifications = new Set();
function notify(title, body, target) {
  if (E2E || !Notification.isSupported()) return;
  const note = new Notification({ title, body });
  shownNotifications.add(note);
  const forget = () => shownNotifications.delete(note);
  note.on("close", forget);
  note.on("click", () => {
    forget();
    if (!target?.projectId) {
      const open = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
      return open ? open.focus() : windows.openPicker();
    }
    const window = windows.openProject(target.projectId);
    if (!target.sessionId) return;
    const open = () => window.webContents.send("sessions:open", { sessionId: target.sessionId });
    // A window made for this click has not loaded yet, and would miss the message.
    if (window.webContents.isLoading()) window.webContents.once("did-finish-load", open);
    else open();
  });
  note.show();
}

function setTicket(projectId, key, patch) {
  try {
    const ticket = tickets.set(projectId, key, patch);
    broadcastTickets(projectId);
    return ticket;
  } catch {
    return null;
  }
}

async function lookUpPr(project, branch) {
  const remotes = await runGit(project.path, ["remote", "-v"]).catch(() => "");
  const credentials = await credentialEnv(project);
  return prForBranch({ cwd: project.path, branch, kind: hostKind(project, remotes), env: credentials.env });
}

function pauseForUsageLimit(project, key) {
  const until = Date.now() + PAUSE_MS;
  dispatcher.pause(until);
  setTicket(project.id, key, { state: "queued", sessionId: undefined });
  notify("Pitlane paused", `Usage limit reached. Tickets resume at ${new Date(until).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`, { projectId: project.id });
  for (const each of registry.list()) broadcastTickets(each.id);
}

function applyTurn(project, session, decision) {
  const key = session.ticketKey;
  if (decision.pause) {
    pauseForUsageLimit(project, key);
    sessions.stop(session.id);
    return;
  }
  const before = tickets.get(project.id, key)?.state;
  setTicket(project.id, key, { state: decision.state, prUrl: decision.prUrl, reason: undefined });
  if (decision.state === "in-review" && before !== "in-review") notify(`${key}: PR opened`, decision.prUrl, { projectId: project.id, sessionId: session.id });
  // Agents wait at their prompt when done; ending the session gives its workspace and its place under the cap back.
  if (decision.end && session.state === "running") sessions.stop(session.id);
}

/** A review session's draft, once written: the owner reads it next; the idle agent is ended. Returns whether one was read. */
async function reviewDraftReady(project, session, { final }) {
  const state = tickets.get(project.id, session.ticketKey)?.state;
  if (state === "review-ready" || state === "done") return true;
  // The commits the slot fetched for this review, recorded before the agent ran; HEAD now may be anything.
  const slot = pool.slots(project).find((candidate) => candidate.sessionId === session.id);
  const base = slot?.base || (await pool.base(project));
  const changed = await changedLines(session.cwd, base).catch(() => new Map());
  const result = readDraft(session.cwd, changed, { since: session.createdAt });
  if (!result.ok) {
    if (final) setTicket(project.id, session.ticketKey, { state: "needs-you", reason: result.error });
    return false;
  }
  setTicket(project.id, session.ticketKey, { state: "review-ready", draft: result.draft, reviewedSha: slot?.head || "", reason: undefined });
  notify(`${session.ticketKey} review ready`, result.draft.summary.slice(0, 120), { projectId: project.id });
  if (session.state === "running") sessions.stop(session.id);
  return true;
}

/** The end of one of the agent's turns (Claude's Stop hook): an open PR means the ticket's work is done. */
async function ticketTurnEnded(session) {
  const project = registry.get(session.projectId);
  if (!project || !session.ticketKey || session.state !== "running") return;
  if (session.ticketKey.startsWith("review:")) return void (await reviewDraftReady(project, session, { final: false }));
  const pr = await lookUpPr(project, session.branch);
  const decision = afterTurn({ pr: pr?.url ? pr : null, tail: sessions.tail(session.id, 4096) });
  if (decision) applyTurn(project, session, decision);
}

/** What a ticket session's exit means: its PR first, then a usage-limit banner, then a failure. */
async function ticketSessionEnded(session) {
  const project = registry.get(session.projectId);
  // A session that never started was already marked by the dispatcher, with the reason; a quit is not an outcome.
  if (!project || !session.ticketKey || session.state === "failed" || quitting) return;
  const key = session.ticketKey;
  const state = tickets.get(project.id, key)?.state;
  if (state === "in-review" || state === "done" || state === "review-ready") return;
  if (key.startsWith("review:")) return void (await reviewDraftReady(project, session, { final: true }));
  const pr = await lookUpPr(project, session.branch);
  const decision = afterTurn({ pr: pr?.url ? pr : null, tail: sessions.tail(session.id, 4096) });
  if (decision) return applyTurn(project, session, decision);
  // The owner stopped it on purpose; they know, so no notification, but the ticket waits for them.
  if (session.stopped) return void setTicket(project.id, key, { state: "needs-you", reason: "you stopped its agent" });
  if (session.exitCode) {
    setTicket(project.id, key, { state: "needs-you", reason: `the agent stopped with exit code ${session.exitCode}` });
    notify(`${key} needs you`, "The agent stopped with an error.", { projectId: project.id, sessionId: session.id });
    return;
  }
  setTicket(project.id, key, { state: "needs-you", reason: pr?.error ? `PR check failed: ${pr.error}` : "no PR" });
  notify(`${key} needs you`, "The agent finished without opening a PR.", { projectId: project.id, sessionId: session.id });
}

const REVIEW_EVERY_MS = 2 * 60_000;
const ownerLogins = new Map();
/** The owner's own login on the host, so their comments on Pitlane's PRs are not taken as feedback. */
async function ownerLogin(project, env) {
  const key = project.github?.login || "default";
  if (!ownerLogins.has(key)) {
    const login = project.github?.login || (await githubLogin({ env }));
    if (login) ownerLogins.set(key, login);
  }
  return ownerLogins.get(key) || null;
}
let reviewedAt = 0;
/** In-review tickets follow their PR: one listing per project, every couple of minutes, not one call per ticket per tick. */
async function recheckReviews() {
  const every = (E2E && Number(process.env.PITLANE_WATCH_TICK_MS)) || REVIEW_EVERY_MS;
  if (Date.now() - reviewedAt < every) return;
  reviewedAt = Date.now();
  for (const project of registry.list()) {
    const waiting = tickets.list(project.id).filter((each) => each.state === "in-review" && each.branch);
    if (!waiting.length) continue;
    const remotes = await runGit(project.path, ["remote", "-v"]).catch(() => "");
    const credentials = await credentialEnv(project);
    const prs = await prsForProject({ cwd: project.path, kind: hostKind(project, remotes), env: credentials.env });
    const owner = hostKind(project, remotes) === "github" ? await ownerLogin(project, credentials.env) : null;
    for (const ticket of waiting) {
      const pr = prs.get(ticket.branch);
      if (pr?.state === "merged" || pr?.state === "closed") {
        setTicket(project.id, ticket.key, { state: "done" });
        continue;
      }
      if (!owner || !ticket.prUrl) continue;
      const since = ticket.feedbackAt || ticket.updatedAt;
      const feedback = await readFeedback({ cwd: project.path, url: ticket.prUrl, since, owner, env: credentials.env });
      if (!feedback.trigger) {
        setTicket(project.id, ticket.key, { feedbackAt: feedback.checkedAt });
        continue;
      }
      const count = (ticket.feedbackCount || 0) + 1;
      // Its own fixes can keep failing the same check; after three rounds a person looks.
      if (count > 3) {
        setTicket(project.id, ticket.key, { state: "needs-you", reason: "feedback keeps coming back", feedbackAt: feedback.checkedAt });
        notify(`${ticket.key} needs you`, "Feedback on its PR keeps coming back.", { projectId: project.id });
        continue;
      }
      setTicket(project.id, ticket.key, { state: "queued", priority: "feedback", feedback: feedback.text, feedbackCount: count, feedbackAt: feedback.checkedAt, sessionId: undefined });
    }
  }
}

const posting = new Set();

function pushProject(project) {
  const window = windows.windowFor(project.id);
  if (window && !window.isDestroyed()) window.webContents.send("project:changed", { project });
}

/** The project's Jira and Linear MCP servers, from Claude's own config for the project and its global servers. */
function trackerServersFor(project) {
  let config = {};
  try {
    config = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".claude.json"), "utf8"));
  } catch {
    return [];
  }
  const names = [...Object.keys(config.projects?.[project.path]?.mcpServers || {}), ...Object.keys(config.mcpServers || {})];
  return [...new Set(names.filter((name) => ["atlassian", "linear"].includes(trackerSourceFamily(name))))];
}

let polling = false;
/** Polls each enabled watch that is due; the first successful poll of a watch only records what is already assigned. */
async function pollWatches() {
  if (polling) return;
  polling = true;
  try {
    for (const project of registry.list()) {
      for (const watch of withIds(project.watches)) {
        if (!watch.enabled || (watch.kind === "ticket-assigned" && !watch.server) || !["ticket-assigned", "review-requested"].includes(watch.kind)) continue;
        const intervalMs = (E2E && Number(process.env.PITLANE_WATCH_INTERVAL_MS)) || watch.intervalSeconds * 1000;
        if (watch.lastCheckedAt && Date.now() - watch.lastCheckedAt < intervalMs) continue;
        const result = watch.kind === "review-requested"
          ? await findReviewRequests({ cwd: project.path, kind: hostKind(project, await runGit(project.path, ["remote", "-v"]).catch(() => "")), env: (await credentialEnv(project)).env })
          : await pollAssigned({ cwd: project.path, server: watch.server, scope: watch.scope, model: watch.model || "sonnet" });
        // The poll can take minutes; whatever the owner changed meanwhile (paused it, its interval) is kept.
        // If the owner retargeted the watch meanwhile, this answer is about something it no longer watches.
        const current = withIds(registry.get(project.id)?.watches).map((each) => ({ ...each }));
        const live = current.find((each) => each.id === watch.id && each.server === watch.server && each.scope === watch.scope);
        if (!live) continue;
        live.lastCheckedAt = Date.now();
        if (!result.ok) {
          live.lastError = result.error;
        } else {
          delete live.lastError;
          const outcome = tickets.observe(project.id, result.tasks, { baseline: !live.baselined, kind: watch.kind === "review-requested" ? "review" : "ticket" });
          live.baselined = true;
          for (const key of outcome.flagged) notify(`${key} needs you`, "It is no longer assigned to you.", { projectId: project.id });
          broadcastTickets(project.id);
        }
        pushProject(registry.update(project.id, { watches: current }));
      }
    }
  } finally {
    polling = false;
  }
}

/** One pass: poll the watches that are due, follow PRs, then start what the queue allows. */
let ticking = null;
function watchTick() {
  ticking ??= (async () => {
    await pollWatches().catch((error) => console.log(`[watches] ${error.message}`));
    await recheckReviews().catch((error) => console.log(`[reviews] ${error.message}`));
    await dispatch();
  })().finally(() => { ticking = null; });
  return ticking;
}

function registerWatchIpc() {
  const withProject = (payload, work) => {
    const project = registry.get(payload?.id);
    if (!project) return failure("Unknown project");
    try {
      const updated = work(project, withIds(project.watches).map((watch) => ({ ...watch })));
      pushProject(updated);
      return updated;
    } catch (error) {
      return failure(error);
    }
  };
  ipcMain.handle("watches:servers", (_event, payload) => {
    const project = registry.get(payload?.id);
    return project ? trackerServersFor(project) : [];
  });
  ipcMain.handle("watches:create", (_event, payload) => withProject(payload, (project, watches) =>
    registry.update(project.id, { watches: addWatch(watches, { kind: payload?.kind, server: payload?.server }, { servers: trackerServersFor(project) }) })));
  ipcMain.handle("watches:edit", (_event, payload) => withProject(payload, (project, watches) => {
    const patch = payload?.patch || {};
    const edited = editWatch(watches, String(payload?.watchId), { intervalSeconds: patch.intervalSeconds, model: patch.model, server: patch.server, scope: patch.scope }, { servers: trackerServersFor(project) });
    return registry.update(project.id, { watches: edited });
  }));
  ipcMain.handle("watches:remove", (_event, payload) => withProject(payload, (project, watches) =>
    registry.update(project.id, { watches: removeWatch(watches, String(payload?.watchId)) })));
  ipcMain.handle("watches:toggle", (_event, payload) => withProject(payload, (project, watches) => {
    const watch = watches.find((each) => each.id === payload?.watchId);
    if (!watch) throw new Error("No such watch");
    watch.enabled = !watch.enabled;
    if (watch.enabled) delete watch.lastCheckedAt;
    const updated = registry.update(project.id, { watches });
    if (watch.enabled) setImmediate(() => void watchTick());
    return updated;
  }));
  ipcMain.handle("watches:check", (_event, payload) => withProject(payload, (project, watches) => {
    const watch = watches.find((each) => each.id === payload?.watchId);
    if (!watch) throw new Error("No such watch");
    if (!watch.enabled) throw new Error("switch it on first (space)");
    delete watch.lastCheckedAt;
    const updated = registry.update(project.id, { watches });
    setImmediate(() => void watchTick());
    return updated;
  }));
  ipcMain.handle("reviews:update", (_event, payload) => {
    const ticket = tickets.get(String(payload?.projectId || ""), String(payload?.key || ""));
    if (!ticket || ticket.state !== "review-ready") return failure("No draft to change");
    const draft = payload?.draft;
    if (!draft || typeof draft.summary !== "string" || !draft.summary.trim() || !Array.isArray(draft.comments)) return failure("Invalid draft");
    // The window may change the summary and verdict and drop comments; it cannot add or rewrite one, and
    // whether a comment is on the diff stays what Pitlane worked out, not what the window says.
    const same = (a, b) => a.path === b.path && a.line === b.line && a.body === b.body;
    const kept = ticket.draft.comments.filter((stored) => draft.comments.some((comment) => comment && same(comment, stored)));
    return setTicket(payload.projectId, ticket.key, {
      draft: { ...ticket.draft, summary: draft.summary.slice(0, 20_000), verdict: ["approve", "comment", "request-changes"].includes(draft.verdict) ? draft.verdict : "comment", comments: kept },
    });
  });
  ipcMain.handle("reviews:post", async (_event, payload) => {
    const project = registry.get(String(payload?.projectId || ""));
    const ticket = project && tickets.get(project.id, String(payload?.key || ""));
    if (!ticket || ticket.state !== "review-ready" || !ticket.draft) return failure("No draft to post");
    // One post at a time per draft: a second press while the first is on its way must not post twice.
    if (posting.has(ticket.key)) return failure("already posting");
    posting.add(ticket.key);
    try {
    const remote = await runGit(project.path, ["remote", "get-url", "origin"]).catch(() => "");
    const remotes = await runGit(project.path, ["remote", "-v"]).catch(() => "");
    const result = await postDraft({ cwd: project.path, kind: hostKind(project, remotes), repo: repoSlug(remote), pr: ticket.pr, draft: ticket.draft, sha: ticket.reviewedSha, env: (await credentialEnv(project)).env });
    if (!result.ok) {
      setTicket(project.id, ticket.key, { reason: result.error, ...(result.notePosted ? { draft: { ...ticket.draft, notePosted: true } } : {}) });
      return failure(result.error);
    }
    setTicket(project.id, ticket.key, { state: "done", postedUrl: result.url, reason: undefined });
    return { ok: true, url: result.url };
    } finally {
      posting.delete(ticket.key);
    }
  });
  ipcMain.handle("reviews:discard", (_event, payload) => {
    const ticket = tickets.get(String(payload?.projectId || ""), String(payload?.key || ""));
    if (!ticket || ticket.state !== "review-ready") return failure("No draft to discard");
    return setTicket(payload.projectId, ticket.key, { state: "done", reason: "discarded" });
  });
  ipcMain.handle("tickets:list", (_event, payload) => ({ tickets: tickets.list(String(payload?.projectId || "")), pausedUntil: dispatcher.pausedUntil() }));
  ipcMain.handle("tickets:start", (_event, payload) => {
    const projectId = String(payload?.projectId || "");
    const ticket = tickets.get(projectId, String(payload?.key || ""));
    if (!ticket) return failure("Unknown ticket");
    const alive = ticket.sessionId && sessions.get(ticket.sessionId)?.state === "running";
    if (!alive && (ticket.state === "not-started" || ticket.state === "needs-you")) setTicket(projectId, ticket.key, { state: "queued", reason: undefined });
    void dispatch();
    return { ok: true };
  });
  ipcMain.handle("tickets:unqueue", (_event, payload) => {
    const projectId = String(payload?.projectId || "");
    const ticket = tickets.get(projectId, String(payload?.key || ""));
    if (!ticket || ticket.state !== "queued") return failure("Only a ticket that is up next can be taken out");
    setTicket(projectId, ticket.key, { state: "not-started" });
    return { ok: true };
  });
}

async function dispatch() {
  const started = await dispatcher.tick().catch((error) => {
    console.log(`[dispatcher] ${error.message}`);
    return [];
  });
  if (started.length) for (const project of registry.list()) broadcastTickets(project.id);
}

// Hooks run the app's own Node (Electron as Node), so they work without a node install; the script lives outside the asar.
const hookNode = () => process.execPath;
const hookScriptPath = () => path.join(__dirname, "agentHook.cjs").replace("app.asar", "app.asar.unpacked");

function registerSessionIpc() {
  ipcMain.handle("sessions:list", (_event, payload) => sessions.list(payload?.projectId));
  ipcMain.handle("sessions:create", async (_event, payload) => {
    const project = registry.get(payload?.projectId);
    if (!project) return failure("Unknown project");
    const id = randomUUID();
    const result = await startSession(project, { id, agent: String(payload?.agent || "claude"), branch: `pitlane/session-${id.slice(0, 8)}` });
    return result.busy ? failure(busyMessage(result.error)) : result;
  });
  ipcMain.handle("workspaces:list", (_event, payload) => workspaceList(payload?.projectId));
  registerLiveChangesIpc();
  registerWatchIpc();
  ipcMain.handle("workspaces:park", async (_event, payload) => {
    const project = registry.get(payload?.projectId);
    if (!project) return failure("Unknown project");
    try {
      await pool.park(project, Number(payload?.slot), typeof payload?.sessionId === "string" ? payload.sessionId : undefined);
      broadcastSessions(project.id);
      return { ok: true };
    } catch (error) {
      return failure(error);
    }
  });
  ipcMain.handle("sessions:write", (_event, payload) => {
    const session = sessions.get(payload?.id);
    const data = String(payload?.data ?? "");
    // Focus reports and the like are the terminal talking, not the owner answering.
    const quiet = isTerminalReply(data);
    if (!quiet && session?.attention && session.ticketKey && tickets.get(session.projectId, session.ticketKey)?.reason !== "unassigned") {
      setTicket(session.projectId, session.ticketKey, { state: "working", reason: undefined });
    }
    sessions.write(payload?.id, data, { quiet });
  });
  ipcMain.handle("sessions:resize", (_event, payload) => sessions.resize(payload?.id, Number(payload?.cols), Number(payload?.rows)));
  ipcMain.handle("sessions:stop", (_event, payload) => sessions.stop(payload?.id));
  ipcMain.handle("sessions:clear-ended", (_event, payload) => {
    const project = registry.get(String(payload?.projectId || ""));
    if (!project) return 0;
    // A session whose workspace still holds its uncommitted work stays until that work is parked.
    const held = new Set(pool.slots(project).filter((slot) => slot.state === "held").map((slot) => slot.sessionId));
    return sessions.clearEnded(project.id, { keep: (session) => held.has(session.id) });
  });
  ipcMain.handle("sessions:attach", (event, payload) => {
    const sender = event.sender;
    const id = payload?.id;
    detach(sender, id);
    const batch = createBatcher((data) => {
      if (!sender.isDestroyed()) sender.send("sessions:data", { id, data });
    });
    const attached = sessions.attach(id, (data) => batch.push(data));
    attachments.set(`${sender.id}:${id}`, () => {
      attached.detach();
      batch.stop();
    });
    return { scrollback: attached.scrollback };
  });
  ipcMain.handle("sessions:detach", (event, payload) => detach(event.sender, payload?.id));
  ipcMain.handle("sessions:paste-paths", (_event, payload) => {
    const paths = Array.isArray(payload?.paths) ? payload.paths.filter((item) => typeof item === "string" && item) : [];
    if (paths.length) sessions.write(payload?.id, `${paths.map(quotePath).join(" ")} `);
  });
  ipcMain.handle("links:open", (_event, payload) => openExternal(String(payload?.url || "")));
}

function liveFile(payload) {
  const file = payload?.file;
  if (!file || typeof file.path !== "string" || !file.path) throw new Error("Missing file");
  return { path: file.path, from: typeof file.from === "string" && file.from ? file.from : null };
}

/** After the agent has gone, a revert is the owner's change: it is committed (and pushed where the branch is) so the slot can be freed. */
async function commitOwnerRevert(session, file) {
  const project = registry.get(session.projectId);
  if (!project || !session.slot) return;
  if ((await pool.commitRevert(project, session.slot, session.id, file.path)) === "committed") {
    await pool.release(project, session.slot, session.id).catch(() => {});
  }
  broadcastSessions(project.id);
}

/** An ended session's slot may already be another session's; its Changes view must not act on that live work. */
function ownsItsWorkspace(session) {
  if (session.state === "running" || !session.slot) return true;
  const project = registry.get(session.projectId);
  return Boolean(project && pool.owns(project, session.slot, session.id));
}
const MOVED_ON = "This session's workspace has been reused by a newer session, so its changes can't be shown or reverted here.";

function registerLiveChangesIpc() {
  ipcMain.handle("live-changes:subscribe", (event, payload) => {
    const session = sessions.get(String(payload?.sessionId || ""));
    if (!session) return failure("Unknown session");
    if (!ownsItsWorkspace(session)) {
      if (!event.sender.isDestroyed()) event.sender.send("live-changes:update", { sessionId: session.id, ok: false, error: MOVED_ON, files: [], additions: 0, deletions: 0 });
      return failure(MOVED_ON);
    }
    const sender = event.sender;
    const key = `${sender.id}:${session.id}`;
    liveSubscriptions.get(key)?.();
    const stop = liveChanges.subscribe(session.id, session.cwd, (summary) => {
      if (!sender.isDestroyed()) sender.send("live-changes:update", summary);
    });
    liveSubscriptions.set(key, stop);
    return { ok: true };
  });
  ipcMain.handle("live-changes:unsubscribe", (event, payload) => {
    const key = `${event.sender.id}:${String(payload?.sessionId || "")}`;
    liveSubscriptions.get(key)?.();
    liveSubscriptions.delete(key);
  });
  ipcMain.handle("live-changes:file-diff", async (_event, payload) => {
    try {
      const owner = sessions.get(String(payload?.sessionId || ""));
      if (owner && !ownsItsWorkspace(owner)) throw new Error(MOVED_ON);
      return { ok: true, ...(await liveChanges.fileDiff(String(payload?.sessionId || ""), liveFile(payload))) };
    } catch (error) {
      return { ok: false, diff: "", hunks: [], error: error.message };
    }
  });
  ipcMain.handle("live-changes:revert", async (_event, payload) => {
    try {
      const session = sessions.get(String(payload?.sessionId || ""));
      if (!session) throw new Error("Unknown session");
      if (!ownsItsWorkspace(session)) throw new Error(MOVED_ON);
      const file = liveFile(payload);
      await liveChanges.revert(session.id, file, typeof payload?.hunk === "string" ? payload.hunk : undefined);
      if (session.state !== "running") await commitOwnerRevert(session, file);
      return { ok: true };
    } catch (error) {
      return failure(error);
    }
  });
  ipcMain.handle("live-changes:keep", async (_event, payload) => {
    try {
      const owner = sessions.get(String(payload?.sessionId || ""));
      if (owner && !ownsItsWorkspace(owner)) throw new Error(MOVED_ON);
      await liveChanges.keep(String(payload?.sessionId || ""), payload?.file ? liveFile(payload) : undefined);
      return { ok: true };
    } catch (error) {
      return failure(error);
    }
  });
}

function carryProjectMoves(moves) {
  // Tests run against the real home folder, whose Claude config must never be rewritten by them.
  if (E2E) return Promise.resolve([]);
  const carried = {
    has: (key) => (settings().carriedMoves || []).includes(key),
    add: (key) => writeJsonAtomic(dataFile("settings.json"), { ...settings(), carriedMoves: [...new Set([...(settings().carriedMoves || []), key])] }),
  };
  return carryMovedProjects({ moves, home: os.homedir(), store: carried, log: (message) => console.log(message) });
}

/** Claude keys its config by real path: a project reached through a symlink, or re-pointed earlier, carries it across. */
function carryAllProjectMoves() {
  const moves = [];
  for (const project of registry.list()) {
    for (const from of project.previousPaths || []) moves.push({ from, to: project.path });
    const real = fs.existsSync(project.path) ? fs.realpathSync(project.path) : project.path;
    if (real !== project.path) moves.push({ from: project.path, to: real });
  }
  return carryProjectMoves(moves);
}

function registerIpc() {
  ipcMain.handle("projects:list", () => registry.list());
  ipcMain.handle("projects:add", async (_event, payload) => {
    try {
      const project = await registry.add(String(payload?.path || ""));
      rebuildDockMenu();
      return project;
    } catch (error) {
      return failure(error);
    }
  });
  ipcMain.handle("projects:open", (_event, payload) => {
    if (registry.get(payload?.id)) windows.openProject(payload.id);
    return { ok: true };
  });
  ipcMain.handle("projects:status", (_event, payload) => registry.status(payload?.id));
  ipcMain.handle("projects:choose-folder", () => chooseFolder());
  ipcMain.handle("projects:locate", async (_event, payload) => {
    const chosen = await chooseFolder();
    if (!chosen) return null;
    try {
      const before = registry.get(payload?.id)?.path;
      const located = await registry.locate(payload?.id, chosen.path);
      void carryProjectMoves([{ from: before, to: located.path }]);
      await pool.repair(located).catch((error) => console.log(`[workspaces] repair failed: ${error.message}`));
      return located;
    } catch (error) {
      return failure(error);
    }
  });
  ipcMain.handle("projects:update", (_event, payload) => {
    try {
      const before = themeOf(registry.get(payload?.id));
      const patch = {};
      if (payload?.theme !== undefined) {
        if (!Object.hasOwn(BACKGROUND, payload.theme)) return failure("Unknown theme");
        patch.theme = payload.theme;
      }
      if (payload?.agentLimit !== undefined) patch.agentLimit = Math.min(3, Math.max(1, Math.round(Number(payload.agentLimit)) || 1));
      if (Array.isArray(payload?.localFiles)) patch.localFiles = payload.localFiles.filter((file) => typeof file === "string" && !file.includes("/"));
      const project = registry.update(payload?.id, patch);
      const after = themeOf(project);
      const window = windows.windowFor(project.id);
      if (window && (before === "night-city") !== (after === "night-city")) {
        // Transparency is fixed when a window is made, so it is made again in the same place; agents keep running.
        pendingBounds.set(project.id, window.getBounds());
        window.once("closed", () => setImmediate(() => windows.openProject(project.id)));
        window.close();
      } else if (window && before !== after) {
        window.setBackgroundColor(BACKGROUND[after]);
      }
      return project;
    } catch (error) {
      return failure(error);
    }
  });
  ipcMain.handle("projects:detect-local-files", async (_event, payload) => {
    const project = registry.get(payload?.id);
    return project ? detectLocalFiles(project.path).catch(() => []) : [];
  });
  ipcMain.handle("update:state", () => updateState);
  ipcMain.handle("update:install", () => installUpdate());
  ipcMain.handle("update:check", () => checkForUpdatesByHand());
  ipcMain.handle("settings:get", () => settings());
  ipcMain.handle("settings:set", (_event, payload) => {
    const next = { ...settings(), ...(Object.hasOwn(BACKGROUND, payload?.defaultTheme || "") ? { defaultTheme: payload.defaultTheme } : {}) };
    writeJsonAtomic(dataFile("settings.json"), next);
    return next;
  });
}

app.whenReady().then(() => {
  registry = createRegistry({ file: dataFile("registry.json") });
  windows = createWindowManager({
    create: createWindow,
    store: {
      get: () => readJson(dataFile("windows.json"), []).filter((id) => registry.get(id)),
      set: (ids) => writeJsonAtomic(dataFile("windows.json"), ids),
    },
  });
  sessions = createSessionManager({
    spawn: (...args) => require("node-pty").spawn(...args),
    resolveCommand,
    store: { get: () => readJson(dataFile("sessions.json"), []), set: (list) => writeJsonAtomic(dataFile("sessions.json"), list) },
  });
  pool = createWorkspacePool({
    root: dataFile("workspaces"),
    store: { get: () => readJson(dataFile("workspaces.json"), {}), set: (value) => writeJsonAtomic(dataFile("workspaces.json"), value) },
    log: (message) => console.log(message),
  });
  liveChanges = createLiveChanges({ storePath: dataFile("live-changes.json"), log: (message) => console.log(message) });
  tickets = createTicketBook({ store: { get: () => readJson(dataFile("tickets.json"), {}), set: (value) => writeJsonAtomic(dataFile("tickets.json"), value) } });
  dispatcher = createDispatcher({
    projects: () => registry.list(),
    book: tickets,
    start: (project, item) => (item.key.startsWith("review:") ? startReview(project, item) : startTicket(project, item)),
    running: runningTicketSessions,
    maxAgents: () => Math.min(9, Math.max(1, Number(settings().maxAgents) || 3)),
  });
  sessions.onChange(broadcastSessions);
  sessions.onExit((session) => {
    const project = registry.get(session.projectId);
    if (!project || !session.slot) return;
    // A review's draft is read before its slot is reset; afterwards the file and the PR's commits are gone.
    const readFirst = session.ticketKey?.startsWith("review:") && !quitting ? reviewDraftReady(project, session, { final: true }).catch(() => false) : Promise.resolve();
    void readFirst.then(() => pool.release(project, session.slot, session.id))
      .catch((error) => console.log(`[workspaces] release failed: ${error.message}`))
      .finally(() => {
        broadcastSessions(project.id);
        // A freed slot may be the one a queued ticket is waiting for.
        void ticketSessionEnded(session).catch((error) => console.log(`[tickets] ${error.message}`)).finally(() => void dispatch());
      });
  });
  watchAgentEvents(dataFile("agent-events"), (sessionId, event) => {
    const session = sessions.get(sessionId);
    if (!session || session.state !== "running") return;
    if (event.event === "Stop") return void ticketTurnEnded(session).catch((error) => console.log(`[tickets] ${error.message}`));
    if (event.event !== "Notification") return;
    // An idle reminder after the work is done (PR open) is not a question.
    const ticketState = session.ticketKey && tickets.get(session.projectId, session.ticketKey)?.state;
    if (ticketState === "in-review" || ticketState === "done" || ticketState === "review-ready") return;
    sessions.flag(sessionId, event.message);
    if (session.ticketKey) setTicket(session.projectId, session.ticketKey, { state: "needs-you", reason: event.message || "the agent asked something" });
    notify(session.ticketKey ? `${session.ticketKey} needs you` : `${session.name} needs you`, event.message || "The agent is waiting for you.", { projectId: session.projectId, sessionId });
  });
  const tickMs = (E2E && Number(process.env.PITLANE_WATCH_TICK_MS)) || 15_000;
  setInterval(() => void watchTick(), tickMs).unref?.();
  registerIpc();
  registerSessionIpc();
  buildAppMenu();
  rebuildDockMenu();
  void carryAllProjectMoves().catch((error) => console.log(`[projects] ${error.message}`));
  // Tickets the last run left working have no agent any more.
  for (const project of registry.list()) {
    for (const ticket of tickets.list(project.id).filter((each) => each.state === "working")) {
      if (sessions.get(ticket.sessionId)?.state !== "running") tickets.set(project.id, ticket.key, { state: "needs-you", reason: "Pitlane was closed while it worked" });
    }
  }
  // No agent survives a quit, so slots the last run left busy are released (or held, if they kept work).
  void (async () => {
    for (const project of registry.list()) {
      const running = new Set(sessions.list(project.id).filter((session) => session.state === "running").map((session) => session.id));
      await pool.reconcile(project, running).catch((error) => console.log(`[workspaces] ${error.message}`));
    }
  })();
  windows.restore();
  updates = startUpdates({
    autoUpdater: require("electron-updater").autoUpdater,
    packaged: app.isPackaged,
    config: readUpdateConfig(path.join(process.resourcesPath, "update-config.json")),
    onState: (state) => {
      const becameReady = state.status === "ready" && updateState?.status !== "ready";
      updateState = state;
      buildAppMenu();
      if (becameReady) notify(`Pitlane ${state.version} is ready`, "Restart to update: press U on a project's home screen, or use the Pitlane menu.");
      for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send("update:state", state);
    },
    log: (message) => console.log(message),
  });
});

let confirmedQuit = false;
app.on("before-quit", (event) => {
  const running = sessions?.runningCount() ?? 0;
  if (running && !confirmedQuit && !E2E) {
    const choice = dialog.showMessageBoxSync({
      type: "warning",
      buttons: ["Quit", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      message: `${running} ${running === 1 ? "agent is" : "agents are"} running. Quit and stop them?`,
    });
    if (choice !== 0) return event.preventDefault();
  }
  confirmedQuit = true;
  quitting = true;
  windows?.quitting();
  sessions?.stopAll();
});
app.on("window-all-closed", () => {});
app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) windows.openPicker(); });
