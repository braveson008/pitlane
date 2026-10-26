const { randomUUID } = require("node:crypto");
const { agentEnv } = require("./agents.cjs");

const MAX_SCROLLBACK = 4 * 1024 * 1024;

// Output is kept as chunks and only joined when a window attaches; re-slicing one big string per chunk stalled the main process.
function createScrollback(max) {
  let chunks = [];
  let head = 0;
  let size = 0;
  return {
    push(data) {
      chunks.push(data);
      size += data.length;
      while (head < chunks.length - 1 && size - chunks[head].length >= max) size -= chunks[head++].length;
      if (head > 1024) {
        chunks = chunks.slice(head);
        head = 0;
      }
    },
    tail(bytes) {
      let text = "";
      for (let index = chunks.length - 1; index >= head && text.length < bytes; index -= 1) text = chunks[index] + text;
      return text.slice(-bytes);
    },
    text() {
      let text = chunks.slice(head).join("");
      if (text.length > max) {
        let cut = text.length - max;
        // Prefer to start on a line boundary so the first line shown is whole.
        const newline = text.indexOf("\n", cut);
        if (newline !== -1 && newline - cut < 4096) cut = newline + 1;
        text = text.slice(cut);
      }
      return text;
    },
  };
}

/** Agent PTYs, owned by the app rather than a window, so closing a window never stops an agent. */
function createSessionManager({ spawn, resolveCommand, store, now = Date.now, maxScrollback = MAX_SCROLLBACK, env = process.env }) {
  const sessions = new Map();
  const live = new Map();
  const listeners = new Set();
  const exitListeners = new Set();

  for (const saved of store.get() || []) {
    sessions.set(saved.id, saved.state === "running" ? { ...saved, state: "exited", endedAt: saved.endedAt ?? now() } : saved);
  }

  const persist = () => store.set([...sessions.values()]);
  const changed = (projectId) => {
    persist();
    for (const listener of listeners) listener(projectId);
  };

  function create({ id, projectId, agent, cwd, name, slot, branch, warning, ticketKey, args = [], extraEnv = {} }) {
    const session = { id: id || randomUUID(), projectId, agent, name: name || `New session · ${agent}`, cwd, slot, branch, warning, ticketKey, state: "running", createdAt: now() };
    sessions.set(session.id, session);
    const entry = { pty: null, scrollback: createScrollback(maxScrollback), subscribers: new Set() };
    live.set(session.id, entry);

    const fail = (error) => {
      Object.assign(session, { state: "failed", error, endedAt: now() });
      entry.scrollback.push(`${error}\r\n`);
      changed(projectId);
      // It ended before it began; whatever it was holding (its workspace) is let go the same way.
      for (const listener of exitListeners) listener(session);
      return session;
    };
    const resolved = resolveCommand(agent, env);
    if (resolved.error) return fail(resolved.error);

    let pty;
    try {
      pty = spawn(resolved.command, [...resolved.args, ...args], {
        name: "xterm-256color",
        cwd,
        env: { ...agentEnv(env), ...extraEnv, TERM: "xterm-256color", COLORTERM: "truecolor" },
        cols: 120,
        rows: 32,
      });
    } catch (error) {
      return fail(`${agent} could not start: ${error.message}`);
    }
    entry.pty = pty;
    pty.onData((data) => {
      entry.scrollback.push(data);
      for (const subscriber of entry.subscribers) subscriber(data);
    });
    pty.onExit(({ exitCode }) => {
      entry.pty = null;
      Object.assign(session, { state: "exited", exitCode, endedAt: now() });
      delete session.attention;
      changed(projectId);
      for (const listener of exitListeners) listener(session);
    });
    changed(projectId);
    return session;
  }

  return {
    create,
    list: (projectId) => [...sessions.values()].filter((session) => session.projectId === projectId),
    get: (id) => sessions.get(id),
    write(id, data, { quiet = false } = {}) {
      const session = sessions.get(id);
      // The owner answering is what "needs you" was waiting for; replies the terminal sends by itself are not.
      if (session?.attention && !quiet) {
        delete session.attention;
        changed(session.projectId);
      }
      live.get(id)?.pty?.write(data);
    },
    flag(id, message) {
      const session = sessions.get(id);
      if (!session || session.state !== "running") return;
      session.attention = message || "needs you";
      changed(session.projectId);
    },
    tail: (id, bytes = 4096) => live.get(id)?.scrollback.tail(bytes) ?? "",
    resize(id, cols, rows) {
      if (cols > 0 && rows > 0) live.get(id)?.pty?.resize(cols, rows);
    },
    stop(id) {
      const session = sessions.get(id);
      const pty = live.get(id)?.pty;
      if (!session || !pty) return;
      session.stopped = true;
      pty.kill();
    },
    /** Forgets one ended session; a running one has to be stopped first. */
    remove(id) {
      const session = sessions.get(id);
      if (!session) return false;
      if (session.state === "running") throw new Error("That agent is still running — stop it first (s s)");
      sessions.delete(id);
      live.delete(id);
      changed(session.projectId);
      return true;
    },
    /** Forgets the project's ended sessions, except those `keep` says still matter (one holding kept work). */
    clearEnded(projectId, { keep = () => false, before = Infinity } = {}) {
      let removed = 0;
      for (const session of [...sessions.values()]) {
        if (session.projectId !== projectId || session.state === "running" || keep(session) || !((session.endedAt ?? 0) < before)) continue;
        sessions.delete(session.id);
        live.delete(session.id);
        removed += 1;
      }
      if (removed) changed(projectId);
      return removed;
    },
    attach(id, onData) {
      const entry = live.get(id);
      if (!entry) return { scrollback: "", detach: () => {} };
      entry.subscribers.add(onData);
      return { scrollback: entry.scrollback.text(), detach: () => entry.subscribers.delete(onData) };
    },
    onExit(listener) {
      exitListeners.add(listener);
      return () => exitListeners.delete(listener);
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    runningCount: () => [...live.values()].filter((entry) => entry.pty).length,
    stopAll() {
      for (const entry of live.values()) entry.pty?.kill();
    },
  };
}

module.exports = { createSessionManager, MAX_SCROLLBACK };
