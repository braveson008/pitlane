const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { readJson, writeJsonAtomic } = require("./atomicJson.cjs");
const { runGit } = require("./git.cjs");
const { withIds } = require("./watchEdits.cjs");

const normalised = (project) => (project.watches ? { ...project, watches: withIds(project.watches) } : project);

// Projects are known by id; the path is only where one was last found, so a moved folder can be re-pointed.
function createRegistry({ file, git = runGit }) {
  let projects = readJson(file, { projects: [] }).projects.map(normalised);
  const save = () => writeJsonAtomic(file, { projects });

  async function inspect(folder) {
    const real = await fs.promises.realpath(folder);
    const top = await git(real, ["rev-parse", "--show-toplevel"]).catch(() => null);
    if (!top) throw new Error("Not a git repository");
    const root = await fs.promises.realpath(top);
    const rootCommit = (await git(root, ["rev-list", "--max-parents=0", "HEAD"])).split("\n")[0];
    const remoteHead = await git(root, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).catch(() => "");
    const trunk = remoteHead ? remoteHead.replace(/^origin\//, "") : await git(root, ["branch", "--show-current"]).catch(() => "main");
    return { path: root, rootCommit, trunk: trunk || "main" };
  }

  return {
    list: () => projects.slice(),
    get: (id) => projects.find((project) => project.id === id),
    async add(folder) {
      const found = await inspect(folder);
      const existing = projects.find((project) => project.path === found.path && project.rootCommit === found.rootCommit);
      if (existing) return existing;
      const project = { id: randomUUID(), name: path.basename(found.path), ...found, createdAt: Date.now() };
      projects.push(project);
      save();
      return project;
    },
    async status(id) {
      const project = projects.find((candidate) => candidate.id === id);
      if (!project || !fs.existsSync(project.path)) return "missing";
      const found = await inspect(project.path).catch(() => null);
      if (!found) return "missing";
      return found.rootCommit === project.rootCommit ? "ok" : "moved-repo";
    },
    async locate(id, folder) {
      const project = projects.find((candidate) => candidate.id === id);
      if (!project) throw new Error("Unknown project");
      const found = await inspect(folder);
      if (found.rootCommit !== project.rootCommit) throw new Error("That folder is a different repository");
      // Remembered so what other tools keyed by the old path (Claude's MCP servers, history) can follow.
      if (found.path !== project.path) project.previousPaths = [...new Set([...(project.previousPaths || []), project.path])];
      project.path = found.path;
      save();
      return project;
    },
    update(id, patch) {
      const project = projects.find((candidate) => candidate.id === id);
      if (!project) throw new Error("Unknown project");
      Object.assign(project, patch.watches ? { ...patch, watches: withIds(patch.watches) } : patch);
      save();
      return project;
    },
  };
}

module.exports = { createRegistry, runGit };
