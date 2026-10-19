// Shared by the end-to-end smokes.
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";

export const root = process.cwd();

export const until = async (what, check, timeout = 15000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await check().catch(() => null);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${what}`);
};

export const tempDir = (prefix) => mkdtemp(path.join(realpathSync(os.tmpdir()), prefix));

export const gitIn = (cwd) => (...args) => execFileSync("git", ["-c", "user.email=a@b", "-c", "user.name=t", ...args], { cwd, encoding: "utf8" }).trim();

/** A project repository, optionally with a bare origin it has pushed to, as a real project has. */
export async function makeRepo(temp, name, { origin = false, files = { "README.md": `# ${name}\n` } } = {}) {
  const repo = path.join(temp, name);
  if (origin) {
    const remote = path.join(temp, `${name}-origin.git`);
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
    execFileSync("git", ["clone", "-q", remote, repo]);
  } else {
    await mkdir(repo, { recursive: true });
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
  }
  for (const [file, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(repo, file)), { recursive: true });
    await writeFile(path.join(repo, file), text);
  }
  const git = gitIn(repo);
  git("add", "-A");
  git("commit", "-qm", "root");
  if (origin) {
    git("push", "-q", "origin", "main");
    git("remote", "set-head", "origin", "main");
  }
  return repo;
}

export function launch(temp, extraEnv = {}) {
  return electron.launch({
    args: [root],
    cwd: root,
    env: {
      ...process.env,
      PITLANE_E2E: "1",
      PITLANE_USER_DATA_DIR: path.join(temp, "profile"),
      PITLANE_AGENT_COMMAND: JSON.stringify(["node", path.join(root, "tests", "fake-agent.mjs")]),
      ...extraEnv,
    },
  });
}

export const projectWindow = (app) => until("the project window", async () => app.windows().find((page) => !page.isClosed() && page.url().includes("project=")));

export const terminalText = (page) => page.evaluate(() => window.__pitlaneTerminalText?.() ?? "");

/** Fails if any text in a row is cut short: everything on screen must be readable in full. */
export async function assertNothingCut(page, where) {
  const cut = await page.evaluate(() => [...document.querySelectorAll(".row > span, .row > span > span, .changes-row > span")]
    .filter((element) => element.scrollWidth > element.clientWidth + 1)
    .map((element) => element.textContent));
  if (cut.length) throw new Error(`${where}: text cut short: ${JSON.stringify(cut)}`);
}
