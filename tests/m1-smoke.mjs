// Milestone 1 end to end, in the real app.
//   npm run smoke
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rename, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";
import { assertNothingCut } from "./helpers.mjs";

const root = process.cwd();
const temp = await mkdtemp(path.join(realpathSync(os.tmpdir()), "pitlane-smoke-"));
const repo = path.join(temp, "shop");
await mkdir(repo, { recursive: true });
const git = (...args) => execFileSync("git", ["-c", "user.email=a@b", "-c", "user.name=t", ...args], { cwd: repo });
git("init", "-q", "-b", "main");
await writeFile(path.join(repo, "README.md"), "# shop\n");
git("add", "-A");
git("commit", "-qm", "root");

const env = {
  ...process.env,
  PITLANE_E2E: "1",
  PITLANE_USER_DATA_DIR: path.join(temp, "profile"),
  PITLANE_TEST_FOLDER: repo,
  PITLANE_AGENT_COMMAND: JSON.stringify(["node", path.join(root, "tests", "fake-agent.mjs")]),
};

const until = async (what, check, timeout = 15000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await check().catch(() => null);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${what}`);
};

const projectWindow = (app) => until("the project window", async () => app.windows().find((page) => !page.isClosed() && page.url().includes("project=")));

const app = await electron.launch({ args: [root], cwd: root, env });
try {
  let picker = await app.firstWindow();
  await picker.waitForLoadState("domcontentloaded");
  assert.equal(await picker.title(), "Pitlane");
  await picker.getByText("Open folder…").waitFor({ timeout: 15000 });
  await assertNothingCut(picker, "picker");
  console.log("PASS the app opens on the project picker");

  await picker.getByText("Open folder…").click();
  let project = await projectWindow(app);
  await project.getByText("shop").first().waitFor();
  const id = new URL(project.url()).searchParams.get("project");
  // This smoke runs two agents at once; milestone 2 gives each its own workspace.
  console.log("PASS opening a folder opens that project's window, and the picker closes");

  await until("the picker closed", async () => picker.isClosed());
  const count = app.windows().length;
  await project.evaluate((projectId) => window.pitlane.projects.open(projectId), id);
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(app.windows().length, count, "the same project never opens twice");
  console.log("PASS opening the same project again focuses its window");

  await rename(repo, `${repo}-moved`);
  await project.reload();
  await project.getByText("Folder not found").waitFor();
  await project.getByRole("button", { name: "Locate…" }).waitFor();
  await assertNothingCut(project, "folder not found");
  await rename(`${repo}-moved`, repo);
  console.log("PASS a missing folder offers Locate…");

  await project.reload();
  const sessionsList = project.getByLabel("Sessions");
  await sessionsList.getByText("No sessions yet").waitFor();
  await project.keyboard.press("n");
  await project.getByRole("option", { name: "claude" }).waitFor();
  await project.keyboard.press("Enter");
  await project.locator(".terminal[data-session]").waitFor();
  const terminalText = () => project.evaluate(() => window.__pitlaneTerminalText?.() ?? "");
  await until("the agent's first output", async () => (await terminalText()).includes("fake agent ready"));
  await project.keyboard.type("hello");
  await project.keyboard.press("Enter");
  await until("the agent's echo", async () => (await terminalText()).includes("you said: hello"));
  console.log("PASS the session shows the agent's live terminal and typing reaches it");

  await project.keyboard.press("Escape");
  await project.keyboard.press("Enter");
  await until("escape reaching the agent", async () => (await terminalText()).includes("you said: <esc>"));
  assert.equal(await project.locator(".terminal[data-session]").count(), 1, "escape never leaves the session");
  console.log("PASS escape goes to the agent, not the app");

  await project.keyboard.press("Meta+ArrowUp");
  const row = sessionsList.getByRole("button", { name: /New session · claude/ });
  await row.waitFor();
  assert.match(await row.innerText(), /^\*/);
  assert.match(await row.innerText(), /running/);
  console.log("PASS ⌘↑ goes home, where the session is listed as running");

  await row.click();
  await until("the scrollback after coming back", async () => (await terminalText()).includes("you said: hello"));
  await project.keyboard.press("Meta+ArrowUp");
  await row.waitFor();
  console.log("PASS coming back to a session shows what it printed while away");

  const themeNow = () => project.evaluate(() => document.documentElement.dataset.theme);
  assert.equal(await themeNow(), "github-dark");
  const seen = [];
  const cycle = ["nord", "one-dark", "dracula", "tokyo-night", "github-dark"];
  for (let i = 0; i < cycle.length; i += 1) {
    await project.keyboard.press("t");
    const expected = cycle[i];
    const page = await until(`theme ${expected}`, async () => {
      for (const candidate of app.windows()) {
        if (candidate.isClosed() || !candidate.url().includes("project=")) continue;
        const probe = candidate.evaluate(() => document.documentElement.dataset.theme).catch(() => null);
        // A window that is closing can leave evaluate hanging, so each probe gets a second.
        const theme = await Promise.race([probe, new Promise((resolve) => setTimeout(() => resolve(null), 1000))]);
        if (theme === expected) return candidate;
      }
      return null;
    });
    seen.push(expected);
    project = page;
    await project.getByLabel("Sessions").getByRole("button", { name: /New session · claude/ }).waitFor();
  }
  assert.deepEqual(seen, cycle);
  console.log("PASS t cycles through all five themes back to GitHub Dark and the agent keeps running");

  const status = () => project.locator(".statusline").innerText();
  await project.keyboard.press("n");
  await project.getByRole("option", { name: "codex" }).waitFor();
  await project.keyboard.press("ArrowDown");
  await project.keyboard.press("Enter");
  await until("the codex session", async () => /New session · codex/.test(await status()));
  await project.keyboard.press("Meta+ArrowUp");
  await project.getByLabel("Sessions").getByRole("button", { name: /New session · claude/ }).click();
  await until("the claude session", async () => /New session · claude/.test(await status()));

  await project.keyboard.press("Meta+k");
  await project.getByRole("dialog", { name: "Switch session" }).waitFor();
  await project.keyboard.type("codex");
  await project.keyboard.press("Enter");
  await until("switching to codex", async () => /New session · codex/.test(await status()));
  assert.equal(await project.getByRole("dialog", { name: "Switch session" }).count(), 0);
  console.log("PASS ⌘K filters the sessions and Enter switches to one");

  await project.keyboard.press("Meta+Alt+ArrowLeft");
  await until("the previous session", async () => /New session · claude/.test(await status()));
  console.log("PASS ⌥⌘← moves to the neighbouring session");

  await project.close();
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find((item) => item.label === "File").submenu.items.find((item) => item.label === "Open Project…").click());
  picker = await until("the picker from File → Open Project…", async () => app.windows().find((page) => !page.isClosed() && !page.url().includes("project=")));
  await picker.getByRole("button", { name: /shop/ }).waitFor();
  await assertNothingCut(picker, "picker with a project");
  await mkdir(path.join(os.tmpdir(), "pitlane-shots"), { recursive: true });
  await picker.screenshot({ path: path.join(os.tmpdir(), "pitlane-shots", "picker.png") });
  await picker.getByRole("button", { name: /shop/ }).click();
  project = await projectWindow(app);
  const rows = project.getByLabel("Sessions").getByRole("button", { name: /New session/ });
  await until("both sessions after reopening", async () => (await rows.count()) === 2);
  for (const text of await rows.allInnerTexts()) assert.match(text, /^\*.*running/s, text);
  console.log("PASS closing a window never stops its agents");

  const windowsBefore = app.windows().length;
  const opened = await project.evaluate(() => window.open("https://example.com/") === null);
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(opened, true);
  assert.equal(app.windows().length, windowsBefore, "a link never opens a window inside Pitlane");
  const before = project.url();
  await project.evaluate(() => { location.href = "file:///etc/hosts"; }).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(project.url(), before, "the window never navigates away from the app");
  // The blocked navigation leaves Playwright waiting for it to finish; a reload clears that.
  await project.reload();
  console.log("PASS links and navigation never leave the app's own page");

  const countSessions = () => project.evaluate((projectId) => window.pitlane.sessions.list(projectId).then((list) => list.length), id);
  await project.getByLabel("Sessions").getByRole("button", { name: /New session · claude/ }).click();
  await until("the claude session", async () => /New session · claude/.test(await status()));
  await project.keyboard.type("exit");
  await project.keyboard.press("Enter");
  await project.locator(".ended").waitFor();
  const sessionCount = await countSessions();
  await project.keyboard.press("Meta+k");
  await project.keyboard.type("codex");
  await project.keyboard.press("Enter");
  await until("switching to codex", async () => /New session · codex/.test(await status()));
  await new Promise((resolve) => setTimeout(resolve, 800));
  assert.equal(await countSessions(), sessionCount, "picking in the switcher never also starts an agent");
  assert.match(await status(), /New session · codex/);
  console.log("PASS Enter in the switcher over an ended session only switches");

  await project.keyboard.press("Meta+ArrowUp");
  const list = project.getByLabel("Sessions");
  await list.waitFor();
  const selectedRow = async () => ((await list.locator(".row.sel").count()) ? list.locator(".row.sel").first().innerText() : "");
  for (let step = 0; step < 6 && !/codex[\s\S]*running/.test(await selectedRow()); step += 1) await project.keyboard.press("j");
  assert.match(await selectedRow(), /codex/);
  await project.keyboard.press("s");
  await list.getByText("stop this agent? s again").waitFor();
  await project.keyboard.press("s");
  await until("codex stopped", async () => !/codex[\s\S]*running/.test(await list.innerText()));
  await until("ended sessions offered for clearing", async () => /2 ended · C clears them/.test(await list.innerText()));
  await project.keyboard.press("Shift+C");
  await until("ended sessions cleared", async () => (await countSessions()) === 0);
  await list.getByText("No sessions yet").waitFor();
  console.log("PASS s s stops a running agent and C clears the ended sessions");
  await rename(repo, `${repo}-gone`);
  await project.keyboard.press("n");
  await project.keyboard.press("Enter");
  await project.getByText("Folder not found").waitFor();
  await rename(`${repo}-gone`, repo);
  await project.reload();
  await project.getByLabel("Sessions").waitFor();
  console.log("PASS starting an agent after the folder moved shows Locate…, not a blank terminal");

  await project.keyboard.press("n");
  await project.keyboard.press("Enter");
  await project.locator(".xterm").waitFor();
  await until("the new agent's prompt", async () => (await terminalText()).length > 0);
  await project.keyboard.type("hello");
  await project.keyboard.press("Enter");
  await until("the new session", async () => (await terminalText()).includes("you said: hello"));
  await project.keyboard.press("Meta+ArrowUp");

  // A screenshot of home and of a session in each theme, to look over by eye.
  const shots = path.join(os.tmpdir(), "pitlane-shots");
  await mkdir(shots, { recursive: true });
  for (const theme of ["github-dark", "nord", "one-dark", "dracula", "tokyo-night"]) {
    const current = await project.evaluate(() => document.documentElement.dataset.theme);
    if (current !== theme) {
      await project.evaluate(({ id, theme }) => window.pitlane.projects.update(id, { theme }), { id, theme }).catch(() => {});
      // Called directly rather than with t, so the window reloads to pick it up.
      project = await until(`the ${theme} window`, async () => {
        for (const candidate of app.windows()) {
          if (candidate.isClosed() || !candidate.url().includes("project=")) continue;
          await candidate.reload().catch(() => {});
          const probe = candidate.evaluate(() => document.documentElement.dataset.theme).catch(() => null);
          if ((await Promise.race([probe, new Promise((resolve) => setTimeout(() => resolve(null), 1000))])) === theme) return candidate;
        }
        return null;
      });
    }
    await project.getByLabel("Sessions").getByRole("button", { name: /New session · claude/ }).waitFor();
    await new Promise((resolve) => setTimeout(resolve, 300));
    await project.screenshot({ path: path.join(shots, `${theme}-home.png`) });
    await project.getByLabel("Sessions").getByRole("button", { name: /New session · claude/ }).click();
    await until("the session", async () => (await terminalText()).includes("you said: hello"));
    await new Promise((resolve) => setTimeout(resolve, 300));
    await project.screenshot({ path: path.join(shots, `${theme}-session.png`) });
    await project.keyboard.press("Meta+ArrowUp");
  }
  console.log(`PASS screenshots of every theme in ${shots}`);

  // A second project: its tab sits beside the first, and ⌘2 shows it in this same window.
  const cafe = path.join(temp, "cafe");
  await mkdir(cafe, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: cafe });
  await writeFile(path.join(cafe, "README.md"), "# cafe\n");
  execFileSync("git", ["-c", "user.email=a@b", "-c", "user.name=t", "add", "-A"], { cwd: cafe });
  execFileSync("git", ["-c", "user.email=a@b", "-c", "user.name=t", "commit", "-qm", "root"], { cwd: cafe });
  await project.evaluate((folder) => window.pitlane.projects.add(folder), cafe);
  await project.evaluate(() => window.dispatchEvent(new Event("focus")));
  const tabs = project.getByLabel("Projects");
  await tabs.getByRole("button", { name: "cafe" }).waitFor();
  const projectWindows = () => app.windows().filter((each) => !each.isClosed() && each.url().includes("project="));
  const tabWindows = projectWindows().length;
  await project.keyboard.press("Meta+2");
  await until("cafe in the same window", async () => /No sessions yet/.test(await project.getByLabel("Sessions").innerText().catch(() => "")) && (await project.title()) === "cafe");
  assert.equal(projectWindows().length, tabWindows, "switching does not open another window");
  assert.equal(await project.getByLabel("Projects").locator("[aria-current=page]").innerText(), "cafe");
  await project.screenshot({ path: path.join(shots, "project-tabs.png") });
  await assertNothingCut(project, "project tabs");
  await project.getByLabel("Projects").getByRole("button", { name: "shop" }).click();
  await until("shop again, its agent still running", async () => /running/.test(await project.getByLabel("Sessions").innerText().catch(() => "")));
  assert.equal(await project.title(), "shop");
  console.log("PASS ⌘2 and the title-bar tabs switch projects in the same window, and agents keep running");
} finally {
  await app.close();
}
