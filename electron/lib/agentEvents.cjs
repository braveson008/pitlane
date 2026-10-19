const fs = require("node:fs");
const path = require("node:path");

const quote = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;

/** `--settings` for a Claude session: Notification (it needs the owner) and Stop (its turn ended) reach Pitlane. */
function hookSettings({ sessionId, node, hookScript, asNode = false }) {
  // Set on the hook's command line only: in the agent's environment it would break any Electron app the agent runs.
  const prefix = asNode ? "ELECTRON_RUN_AS_NODE=1 " : "";
  const hook = (event) => [{ hooks: [{ type: "command", command: `${prefix}${quote(node)} ${quote(hookScript)} ${quote(sessionId)} ${quote(event)}` }] }];
  return JSON.stringify({ hooks: { Notification: hook("Notification"), Stop: hook("Stop") } });
}

/** Reports each new event line as it is appended; lines already there when watching starts are history. */
function watchAgentEvents(dir, onEvent) {
  fs.mkdirSync(dir, { recursive: true });
  const offsets = new Map();
  for (const name of fs.readdirSync(dir)) offsets.set(name, fs.statSync(path.join(dir, name)).size);
  const read = (name) => {
    if (!name || !name.endsWith(".jsonl")) return;
    const file = path.join(dir, name);
    let size;
    try {
      size = fs.statSync(file).size;
    } catch {
      return;
    }
    const from = offsets.get(name) ?? 0;
    if (size <= from) return;
    const fd = fs.openSync(file, "r");
    const buffer = Buffer.alloc(size - from);
    fs.readSync(fd, buffer, 0, buffer.length, from);
    fs.closeSync(fd);
    const text = buffer.toString("utf8");
    const complete = text.lastIndexOf("\n") + 1;
    offsets.set(name, from + Buffer.byteLength(text.slice(0, complete)));
    for (const line of text.slice(0, complete).split("\n").filter(Boolean)) {
      try {
        onEvent(name.slice(0, -".jsonl".length), JSON.parse(line));
      } catch {
        // A torn line is skipped; the hook writes whole lines.
      }
    }
  };
  // macOS can merge or drop change notifications, so any one of them re-reads every file, and a slow poll
  // catches what none announced: a missed event would be a missed "needs you".
  const readAll = () => {
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) read(name);
  };
  const watcher = fs.watch(dir, readAll);
  const poll = setInterval(readAll, 2000);
  poll.unref?.();
  return () => {
    watcher.close();
    clearInterval(poll);
  };
}

module.exports = { hookSettings, watchAgentEvents };
