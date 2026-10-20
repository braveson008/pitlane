const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("pitlane", {
  e2e: process.env.PITLANE_E2E === "1",
  projects: {
    list: () => ipcRenderer.invoke("projects:list"),
    add: (path) => ipcRenderer.invoke("projects:add", { path }),
    open: (id) => ipcRenderer.invoke("projects:open", { id }),
    status: (id) => ipcRenderer.invoke("projects:status", { id }),
    locate: (id) => ipcRenderer.invoke("projects:locate", { id }),
    chooseFolder: () => ipcRenderer.invoke("projects:choose-folder"),
    update: (id, patch) => ipcRenderer.invoke("projects:update", { id, ...patch }),
    detectLocalFiles: (id) => ipcRenderer.invoke("projects:detect-local-files", { id }),
  },
  links: { open: (url) => ipcRenderer.invoke("links:open", { url }) },
  updates: {
    state: () => ipcRenderer.invoke("update:state"),
    install: () => ipcRenderer.invoke("update:install"),
    check: () => ipcRenderer.invoke("update:check"),
    onState: (handler) => {
      const listener = (_event, payload) => handler(payload);
      ipcRenderer.on("update:state", listener);
      return () => ipcRenderer.removeListener("update:state", listener);
    },
  },
  changes: {
    subscribe: (sessionId) => ipcRenderer.invoke("live-changes:subscribe", { sessionId }),
    unsubscribe: (sessionId) => ipcRenderer.invoke("live-changes:unsubscribe", { sessionId }),
    onUpdate: (handler) => {
      const listener = (_event, payload) => handler(payload);
      ipcRenderer.on("live-changes:update", listener);
      return () => ipcRenderer.removeListener("live-changes:update", listener);
    },
    fileDiff: (sessionId, file) => ipcRenderer.invoke("live-changes:file-diff", { sessionId, file }),
    revert: (sessionId, file, hunk) => ipcRenderer.invoke("live-changes:revert", { sessionId, file, hunk }),
    keep: (sessionId, file) => ipcRenderer.invoke("live-changes:keep", { sessionId, file }),
  },
  watches: {
    servers: (id) => ipcRenderer.invoke("watches:servers", { id }),
    create: (id, kind, server) => ipcRenderer.invoke("watches:create", { id, kind, server }),
    edit: (id, watchId, patch) => ipcRenderer.invoke("watches:edit", { id, watchId, patch }),
    remove: (id, watchId) => ipcRenderer.invoke("watches:remove", { id, watchId }),
    toggle: (id, watchId) => ipcRenderer.invoke("watches:toggle", { id, watchId }),
    check: (id, watchId) => ipcRenderer.invoke("watches:check", { id, watchId }),
    overlaps: (id) => ipcRenderer.invoke("watches:overlaps", { id }),
  },
  reviews: {
    update: (projectId, key, draft) => ipcRenderer.invoke("reviews:update", { projectId, key, draft }),
    post: (projectId, key) => ipcRenderer.invoke("reviews:post", { projectId, key }),
    discard: (projectId, key) => ipcRenderer.invoke("reviews:discard", { projectId, key }),
  },
  tickets: {
    list: (projectId) => ipcRenderer.invoke("tickets:list", { projectId }),
    start: (projectId, key) => ipcRenderer.invoke("tickets:start", { projectId, key }),
    unqueue: (projectId, key) => ipcRenderer.invoke("tickets:unqueue", { projectId, key }),
    onChanged: (handler) => {
      const listener = (_event, payload) => handler(payload);
      ipcRenderer.on("tickets:changed", listener);
      return () => ipcRenderer.removeListener("tickets:changed", listener);
    },
  },
  onProjectChanged: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("project:changed", listener);
    return () => ipcRenderer.removeListener("project:changed", listener);
  },
  onOpenSession: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("sessions:open", listener);
    return () => ipcRenderer.removeListener("sessions:open", listener);
  },
  workspaces: {
    list: (projectId) => ipcRenderer.invoke("workspaces:list", { projectId }),
    park: (projectId, slot, sessionId) => ipcRenderer.invoke("workspaces:park", { projectId, slot, sessionId }),
  },
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    set: (patch) => ipcRenderer.invoke("settings:set", patch),
  },
  sessions: {
    list: (projectId) => ipcRenderer.invoke("sessions:list", { projectId }),
    create: (projectId, agent) => ipcRenderer.invoke("sessions:create", { projectId, agent }),
    write: (id, data) => ipcRenderer.invoke("sessions:write", { id, data }),
    resize: (id, cols, rows) => ipcRenderer.invoke("sessions:resize", { id, cols, rows }),
    stop: (id) => ipcRenderer.invoke("sessions:stop", { id }),
    clearEnded: (projectId) => ipcRenderer.invoke("sessions:clear-ended", { projectId }),
    attach: (id) => ipcRenderer.invoke("sessions:attach", { id }),
    detach: (id) => ipcRenderer.invoke("sessions:detach", { id }),
    pasteFiles: (id, files) => ipcRenderer.invoke("sessions:paste-paths", { id, paths: Array.from(files, (file) => webUtils.getPathForFile(file)) }),
    onData: (handler) => {
      const listener = (_event, payload) => handler(payload);
      ipcRenderer.on("sessions:data", listener);
      return () => ipcRenderer.removeListener("sessions:data", listener);
    },
    onChanged: (handler) => {
      const listener = (_event, payload) => handler(payload);
      ipcRenderer.on("sessions:changed", listener);
      return () => ipcRenderer.removeListener("sessions:changed", listener);
    },
  },
});
