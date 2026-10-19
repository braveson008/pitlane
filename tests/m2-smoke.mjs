// Milestone 2 end to end: agents work in workspace slots, never the project folder.
//   npm run build && node tests/m2-smoke.mjs
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { gitIn, launch, makeRepo, projectWindow, tempDir, terminalText, until } from "./helpers.mjs";

const temp = await tempDir("pitlane-m2-");
const repo = await makeRepo(temp, "shop", { origin: true, files: { "README.md": "# shop\n", ".gitignore": ".env\n", "package-lock.json": "{}\n" } });
const { writeFile } = await import("node:fs/promises");
await writeFile(path.join(repo, ".env"), "SECRET=1\n");
const git = gitIn(repo);
const before = { branch: git("branch", "--show-current"), status: git("status", "--porcelain") };

const app = await launch(temp, { PITLANE_TEST_FOLDER: repo });
try {
  const picker = await app.firstWindow();
  await picker.waitForLoadState("domcontentloaded");
  await picker.getByText("Open folder…").click();
  const project = await projectWindow(app);
  const sessions = project.getByLabel("Sessions");
  await sessions.getByText("No sessions yet").waitFor();

  await project.keyboard.press("n");
  await project.keyboard.press("Enter");
  const confirm = project.getByLabel("Local files");
  await confirm.getByText(".env").waitFor();
  await project.keyboard.press("Enter");
  await project.locator(".terminal[data-session]").waitFor();
  console.log("PASS the first session asks which local files to copy");

  await until("the agent", async () => (await terminalText(project)).includes("fake agent ready"));
  await project.keyboard.type("pwd");
  await project.keyboard.press("Enter");
  const cwd = (await until("the cwd", async () => (await terminalText(project)).match(/cwd: (.+)/)))[1].trim();
  assert.ok(cwd.startsWith(path.join(temp, "profile", "workspaces")), cwd);
  assert.notEqual(cwd, repo);
  assert.equal(readFileSync(path.join(cwd, ".env"), "utf8"), "SECRET=1\n");
  const branch = gitIn(cwd)("branch", "--show-current");
  assert.match(branch, /^pitlane\/session-[0-9a-f]{8}$/);
  console.log("PASS the agent works in a workspace slot on its own branch, with .env copied in");

  await project.keyboard.press("Meta+ArrowUp");
  await sessions.getByText("workspaces 1/1").waitFor();
  await project.keyboard.press("n");
  await project.keyboard.press("Enter");
  await project.getByText("All 1 workspace is busy").waitFor();
  console.log("PASS at the limit, a new session says the workspace is busy");

  await sessions.getByRole("button", { name: /New session · claude/ }).click();
  await project.locator(".terminal[data-session]").waitFor();
  await project.keyboard.type("touch notes.txt");
  await project.keyboard.press("Enter");
  await until("the file", async () => existsSync(path.join(cwd, "notes.txt")));
  await project.keyboard.type("exit");
  await project.keyboard.press("Enter");
  await project.keyboard.press("Meta+ArrowUp");
  const row = sessions.getByRole("button", { name: /New session · claude/ });
  await until("the held slot", async () => /held · uncommitted/.test(await row.innerText()));
  await project.keyboard.press("x");
  await project.getByText("park? x again").waitFor();
  await project.keyboard.press("x");
  await sessions.getByText("workspaces 0/1").waitFor();
  assert.equal(gitIn(repo)("log", "-1", "--format=%s", branch), "WIP: parked by Pitlane");
  console.log("PASS an ended session with work holds its slot until parked, and parking keeps the work");

  await project.keyboard.press("n");
  await project.keyboard.press("Enter");
  await project.locator(".terminal[data-session]").waitFor();
  await until("the second agent", async () => (await terminalText(project)).split("fake agent ready").length > 1);
  await project.keyboard.type("pwd");
  await project.keyboard.press("Enter");
  const slot = (await until("the cwd", async () => [...(await terminalText(project)).matchAll(/cwd: (.+)/g)].pop()))[1].trim();
  await project.keyboard.type("edit README.md");
  await project.keyboard.press("Enter");
  await until("the edit", async () => readFileSync(path.join(slot, "README.md"), "utf8").includes("edited by the agent"));
  await project.keyboard.press("Meta+d");
  const files = project.getByLabel("Changed files");
  await until("README.md in the changes", async () => /README\.md[\s\S]*\+1/.test(await files.innerText()));
  console.log("PASS ⌘D shows what the agent changed, live");

  await project.locator(".changes-hunk").first().waitFor();
  await project.keyboard.press("Shift+R");
  await until("the hunk reverted on disk", async () => readFileSync(path.join(slot, "README.md"), "utf8") === "# shop\n");
  await until("an empty list", async () => /No changes since/.test(await files.innerText()));
  console.log("PASS R reverts the hunk on disk");

  await project.keyboard.press("Escape");
  await project.locator(".terminal[data-session]").waitFor();
  await project.keyboard.type("touch b.txt");
  await project.keyboard.press("Enter");
  await project.keyboard.press("Meta+d");
  await until("b.txt in the changes", async () => /b\.txt/.test(await files.innerText()));
  await project.locator(".changes-hunk").first().waitFor();
  await project.keyboard.press("k");
  await until("b.txt kept", async () => /No changes since/.test(await files.innerText()));
  assert.ok(existsSync(path.join(slot, "b.txt")), "keeping leaves the file on disk");
  await project.keyboard.press("Escape");
  await project.locator(".terminal[data-session]").waitFor();
  console.log("PASS k keeps a file, and esc goes back to the session");

  // The Changes view in each theme, to look over by eye.
  const shots = path.join((await import("node:os")).tmpdir(), "pitlane-shots");
  await (await import("node:fs/promises")).mkdir(shots, { recursive: true });
  const id = new URL(project.url()).searchParams.get("project");
  let page = project;
  for (const theme of ["vt220", "acme", "night-city"]) {
    await page.evaluate(({ id, theme }) => window.pitlane.projects.update(id, { theme }), { id, theme }).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 800));
    page = await projectWindow(app);
    await page.reload();
    await page.getByLabel("Sessions").getByRole("button", { name: /New session · claude/ }).first().waitFor();
    const running = page.getByLabel("Sessions").getByRole("button", { name: /running/ }).first();
    await running.click();
    await page.locator(".xterm").waitFor();
    await page.keyboard.type("edit README.md");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Meta+d");
    await page.locator(".changes-hunk").first().waitFor();
    await page.screenshot({ path: path.join(shots, `${theme}-changes.png`) });
    await page.keyboard.press("Shift+R");
    await until("reverted", async () => /No changes since/.test(await page.getByLabel("Changed files").innerText()));
    await page.keyboard.press("Escape");
    await page.keyboard.press("Meta+ArrowUp");
  }
  console.log(`PASS Changes screenshots in every theme in ${shots}`);

  // An ended session's workspace can be reused; its old Changes view must never act on the new session's work.
  page = await projectWindow(app);
  await page.reload();
  const list = page.getByLabel("Sessions");
  await list.getByRole("button", { name: /running/ }).first().click();
  await page.locator(".xterm").waitFor();
  await page.keyboard.type("exit");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Meta+ArrowUp");
  // The row stops saying running a moment before the slot's release settles into held or free.
  await until("the slot held or freed", async () => /held|workspaces 0\/1/.test(await list.innerText()));
  if (/held/.test(await list.innerText())) {
    await page.keyboard.press("x");
    await page.keyboard.press("x");
  }
  await list.getByText("workspaces 0/1").waitFor();
  await page.keyboard.press("n");
  await page.keyboard.press("Enter");
  await page.locator(".xterm").waitFor();
  await page.keyboard.type("exit");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Meta+ArrowUp");
  await list.getByText("workspaces 0/1").waitFor();
  await page.keyboard.press("n");
  await page.keyboard.press("Enter");
  await page.locator(".xterm").waitFor();
  await page.keyboard.type("edit README.md");
  await page.keyboard.press("Enter");
  await until("the live edit", async () => readFileSync(path.join(slot, "README.md"), "utf8").includes("edited by the agent"));
  await page.keyboard.press("Meta+ArrowUp");
  await page.keyboard.press("j");
  await page.keyboard.press("c");
  await page.getByText("reused by a newer session").waitFor();
  await page.keyboard.press("r");
  await new Promise((resolve) => setTimeout(resolve, 800));
  assert.ok(readFileSync(path.join(slot, "README.md"), "utf8").includes("edited by the agent"), "the running session's edit is untouched");
  assert.ok(gitIn(slot)("status", "--porcelain").includes("README.md"), "nothing was committed in the live slot");
  await page.keyboard.press("Escape");
  console.log("PASS an ended session's Changes view never touches the session now using its workspace");

  assert.equal(git("branch", "--show-current"), before.branch);
  assert.equal(git("status", "--porcelain"), before.status);
  console.log("PASS the project folder itself was never touched");
} finally {
  await app.close();
}

// A project saved by an earlier version: a GitHub login this machine does not have, and a watch with no id.
const fresh = await tempDir("pitlane-m2-login-");
const { mkdir, realpath } = await import("node:fs/promises");
await mkdir(path.join(fresh, "profile"), { recursive: true });
const realRepo = await realpath(repo);
await writeFile(path.join(fresh, "profile", "registry.json"), JSON.stringify({ projects: [{
  id: "shop-1", name: "shop", path: realRepo, rootCommit: git("rev-list", "--max-parents=0", "HEAD").trim(), trunk: "main", agentLimit: 1, createdAt: 1,
  github: { host: "github.com", kind: "github", login: "someone" },
  watches: [{ kind: "ticket-assigned", server: "atlassian", enabled: false, intervalSeconds: 300, model: "sonnet" }],
}] }));
const second = await launch(fresh, { PITLANE_FAKE_UPDATE: JSON.stringify({ status: "ready", version: "9.9.9" }) });
try {
  const picker = await second.firstWindow();
  await picker.waitForLoadState("domcontentloaded");
  await picker.getByRole("button", { name: /shop/ }).first().click();
  const project = await projectWindow(second);
  await project.getByLabel("Watches").getByText("Tickets assigned to me").waitFor();
  assert.match(await project.getByLabel("Watches").innerText(), /paused/);
  console.log("PASS a project saved by an earlier version opens with its watches");
  await until("the update note", async () => /9\.9\.9 ready · U restart to update/.test(await project.locator(".statusline").innerText()));
  console.log("PASS a downloaded update says so in the status line, with the key that installs it");

  // "someone" is not a gh login on this machine, so the session starts without a token and says so.
  await project.keyboard.press("n");
  await project.keyboard.press("Enter");
  await project.getByLabel("Local files").waitFor();
  await project.keyboard.press("Enter");
  await project.locator(".xterm").waitFor();
  await project.keyboard.press("Meta+ArrowUp");
  await until("the warning on the row", async () => /no GitHub login/.test(await project.getByLabel("Sessions").innerText()));
  console.log("PASS a project whose GitHub login is missing still starts its agent, and says so");
} finally {
  await second.close();
}

