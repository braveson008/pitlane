const crypto = require("node:crypto");

const INTERVALS = [300, 600, 1800, 3600];
const MODELS = ["sonnet", "haiku", "opus"];
const KINDS = ["ticket-assigned", "review-requested"];

const newId = () => `w-${crypto.randomBytes(4).toString("hex")}`;
const sameTarget = (a, b) => a.kind === b.kind && (a.server ?? null) === (b.server ?? null) && (a.scope ?? "") === (b.scope ?? "");

function checkServer(server, servers) {
  if (!servers.length) throw new Error("no Jira or Linear MCP server for this project");
  if (!servers.includes(server)) throw new Error(`${server || "(none)"} is not one of this project's tracker servers: ${servers.join(", ")}`);
}

/** Watches stored before they had ids get one, derived from what they watch so it is the same on every read. */
function withIds(watches) {
  return (watches || []).map((watch) => (watch.id ? watch : { ...watch, id: `w-${crypto.createHash("sha1").update(`${watch.kind}|${watch.server ?? ""}`).digest("hex").slice(0, 8)}` }));
}

function addWatch(watches, { kind, server }, { servers }) {
  if (!KINDS.includes(kind)) throw new Error(`Unknown watch kind ${kind}`);
  const watch = { id: newId(), kind, intervalSeconds: 300, model: "sonnet", enabled: false };
  if (kind === "ticket-assigned") {
    checkServer(server, servers);
    watch.server = server;
  }
  if (watches.some((existing) => sameTarget(existing, watch))) throw new Error("that watch is already there");
  return [...watches, watch];
}

/** Applies the owner's changes: server, scope, interval and model. What it watched before is forgotten when that changes. */
function editWatch(watches, id, patch, { servers }) {
  const index = watches.findIndex((watch) => watch.id === id);
  if (index < 0) throw new Error("No such watch");
  const watch = { ...watches[index] };
  if (patch.intervalSeconds !== undefined) {
    if (!INTERVALS.includes(patch.intervalSeconds)) throw new Error(`interval must be one of ${INTERVALS.map((seconds) => `${seconds / 60}m`).join(", ")}`);
    watch.intervalSeconds = patch.intervalSeconds;
  }
  if (patch.model !== undefined) {
    if (!MODELS.includes(patch.model)) throw new Error(`model must be one of ${MODELS.join(", ")}`);
    watch.model = patch.model;
  }
  const before = { ...watch };
  if (watch.kind === "ticket-assigned" && patch.server !== undefined) {
    checkServer(patch.server, servers);
    watch.server = patch.server;
  }
  if (watch.kind === "ticket-assigned" && patch.scope !== undefined) {
    const scope = String(patch.scope).trim().slice(0, 120);
    if (scope) watch.scope = scope;
    else delete watch.scope;
  }
  if (!sameTarget(before, watch)) {
    if (watches.some((other, at) => at !== index && sameTarget(other, watch))) throw new Error("that watch is already there");
    delete watch.baselined;
    delete watch.lastCheckedAt;
  }
  delete watch.lastError;
  return watches.map((each, at) => (at === index ? watch : each));
}

function removeWatch(watches, id) {
  if (!watches.some((watch) => watch.id === id)) throw new Error("No such watch");
  return watches.filter((watch) => watch.id !== id);
}

/** For each of this project's ticket watches, the other projects whose enabled watch asks the same tracker the same question. */
function overlaps(projects, projectId) {
  const ticketWatches = (project) => withIds(project.watches).filter((watch) => watch.kind === "ticket-assigned" && watch.server);
  const project = projects.find((each) => each.id === projectId);
  const found = {};
  for (const watch of project ? ticketWatches(project) : []) {
    const sameAsk = (other) => other.enabled && other.server === watch.server && (other.scope ?? "").toLowerCase() === (watch.scope ?? "").toLowerCase();
    const names = projects.filter((other) => other.id !== projectId && ticketWatches(other).some(sameAsk)).map((other) => other.name);
    if (names.length) found[watch.id] = names;
  }
  return found;
}

module.exports = { addWatch, editWatch, removeWatch, withIds, overlaps, INTERVALS, MODELS, KINDS };
