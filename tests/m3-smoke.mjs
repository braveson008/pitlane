// Milestone 3 end to end: a watch finds tickets, the dispatcher starts the lead agent, the ticket follows its PR.
//   npm run build && node tests/m3-smoke.mjs
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { assertNothingCut, gitIn, launch, makeRepo, projectWindow, root, tempDir, terminalText, until } from "./helpers.mjs";

const temp = await tempDir("pitlane-m3-");
const home = path.join(temp, "home");
await mkdir(home, { recursive: true });
const repo = await makeRepo(temp, "shop", { origin: true });
const before = { branch: gitIn(repo)("branch", "--show-current"), status: gitIn(repo)("status", "--porcelain") };
await writeFile(path.join(home, ".claude.json"), JSON.stringify({ projects: { [repo]: { mcpServers: { atlassian: { type: "http", url: "https://mcp.atlassian.com/v1/sse" } } } } }));
const ticketsFile = path.join(temp, "tickets.json");
const prsFile = path.join(temp, "prs.json");
const ticket = (id, title) => ({ id, title, description: `Description of ${id}`, url: `https://jira.example/${id}`, status: "To Do", group: "", updatedAt: "" });
await writeFile(ticketsFile, JSON.stringify([ticket("SHOP-1", "First thing")]));
const fakeClaude = JSON.stringify(["node", path.join(root, "tests", "fake-claude.mjs")]);

const app = await launch(temp, {
  HOME: home,
  PITLANE_TEST_FOLDER: repo,
  PITLANE_AGENT_COMMAND: fakeClaude,
  PITLANE_CLAUDE_COMMAND: fakeClaude,
  PITLANE_GH_COMMAND: JSON.stringify(["node", path.join(root, "tests", "fake-gh.mjs")]),
  PITLANE_FAKE_TICKETS: ticketsFile,
  PITLANE_FAKE_PRS: prsFile,
  PITLANE_WATCH_TICK_MS: "1000",
  PITLANE_WATCH_INTERVAL_MS: "1000",
});
try {
  const picker = await app.firstWindow();
  await picker.waitForLoadState("domcontentloaded");
  await picker.getByText("Open folder…").click();
  const page = await projectWindow(app);
  const watches = page.getByLabel("Watches");
  await page.getByLabel("Sessions").waitFor();

  await page.keyboard.press("w");
  await page.getByText("No watches yet · a adds one").waitFor();
  await page.keyboard.press("a");
  await page.getByLabel("Add watch").getByText("atlassian").waitFor();
  await page.keyboard.press("Enter");
  await watches.getByText("atlassian").waitFor();
  assert.match(await watches.innerText(), /paused/);
  // Edit before switching on: a scope, and a slower interval.
  await page.keyboard.press("e");
  const editor = page.getByLabel("Edit watch");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.getByLabel("Only from").fill("SHOP project");
  await page.getByLabel("Only from").press("Enter");
  await until("the scope saved", async () => /only SHOP project/.test(await watches.innerText()));
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowRight");
  await until("the interval saved", async () => /every 10m/.test(await editor.innerText()));
  const shotsDir = path.join((await import("node:os")).tmpdir(), "pitlane-shots");
  await mkdir(shotsDir, { recursive: true });
  await page.screenshot({ path: path.join(shotsDir, "watch-edit.png") });
  await page.keyboard.press("Escape");
  await assertNothingCut(page, "watches screen");
  await page.keyboard.press(" ");
  await until("the watch on", async () => /on · every 10m/.test(await watches.innerText()));
  await page.screenshot({ path: path.join(shotsDir, "watches.png") });
  await page.keyboard.press("Escape");
  await page.getByLabel("Sessions").waitFor();
  const notStarted = page.getByLabel("Not started");
  await until("SHOP-1 baselined", async () => (await notStarted.count()) > 0 && /1 assigned before the watch began/.test(await notStarted.innerText()), 20000);
  assert.doesNotMatch(await notStarted.innerText(), /SHOP-1/, "not-started tickets are folded away until asked for");
  console.log("PASS a watch is added, scoped and timed on its own screen; tickets already assigned are folded under not started");

  await writeFile(ticketsFile, JSON.stringify([ticket("SHOP-1", "First thing"), ticket("SHOP-2", "Second thing")]));
  const sessions = page.getByLabel("Sessions");
  await until("SHOP-2 started", async () => /SHOP-2[\s\S]*running/.test(await sessions.innerText()), 30000);
  await sessions.getByRole("button", { name: /SHOP-2/ }).click();
  await until("the lead prompt", async () => /prompt: Work on SHOP-2\./.test(await terminalText(page)));
  await page.keyboard.type("branch");
  await page.keyboard.press("Enter");
  await until("the branch", async () => /branch: shop-2-second-thing/.test(await terminalText(page)));
  console.log("PASS a newly assigned ticket starts the lead agent on its own branch with the ticket in its prompt");

  // Real agents sit at their prompt when done; the PR at the end of the turn is what ends the session.
  await page.keyboard.type("open-pr");
  await page.keyboard.press("Enter");
  await until("the PR", async () => /opened https:/.test(await terminalText(page)));
  await page.keyboard.press("Meta+ArrowUp");
  const review = page.getByLabel("In review");
  await until("SHOP-2 in review", async () => /SHOP-2[\s\S]*pull\/1/.test(await review.innerText()), 20000);
  await until("the idle agent ended", async () => !/SHOP-2[^\n]*\n[^\n]*\n[^\n]*running/.test(await sessions.innerText()) && !/workspaces 1\/1/.test(await sessions.innerText()), 20000);
  console.log("PASS an agent that opens its PR and goes idle hands its workspace back; the ticket is in review");

  const prs = JSON.parse(await readFile(prsFile, "utf8"));
  for (const branch of Object.keys(prs)) prs[branch].state = "MERGED";
  await writeFile(prsFile, JSON.stringify(prs));
  await until("SHOP-2 done", async () => (await review.count()) === 0 || !/SHOP-2/.test(await review.innerText()), 30000);
  assert.doesNotMatch(await page.locator(".screen").innerText(), /SHOP-2[^\n]*\n[^\n]*needs you/);
  console.log("PASS a merged PR takes the ticket out of review");

  // From the keyboard: move the one cursor down to the ticket and press Enter.
  await page.keyboard.press("a");
  await notStarted.getByText("SHOP-1").waitFor();
  await page.screenshot({ path: path.join(shotsDir, "not-started.png") });
  const queueSelection = async () => ((await notStarted.locator(".row.sel").count()) ? notStarted.locator(".row.sel").innerText() : "");
  for (let step = 0; step < 12 && !/SHOP-1/.test(await queueSelection()); step += 1) await page.keyboard.press("j");
  assert.match(await queueSelection(), /SHOP-1/, "the keyboard reaches a not-started ticket");
  await page.keyboard.press("Enter");
  await until("SHOP-1 started", async () => /SHOP-1[\s\S]*running/.test(await sessions.innerText()), 20000);
  console.log("PASS a not-started ticket starts when the owner chooses it");

  // A busy home screen in each theme: one ticket needing the owner, one running, one queued, one in review.
  const all = [ticket("SHOP-1", "First thing"), ticket("SHOP-2", "Second thing")];
  await writeFile(ticketsFile, JSON.stringify([...all, ticket("SHOP-3", "Third thing")]));
  const queue = page.getByLabel("Up next");
  await until("SHOP-3 up next", async () => (await queue.count()) > 0 && /1\s+SHOP-3/.test(await queue.innerText()), 20000);
  await sessions.getByRole("button", { name: /SHOP-1/ }).click();
  await page.locator(".xterm").waitFor();
  await page.keyboard.type("exit");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Meta+ArrowUp");
  await until("SHOP-3 running", async () => /SHOP-3[\s\S]*running/.test(await sessions.innerText()), 20000);
  await sessions.getByRole("button", { name: /SHOP-3/ }).first().click();
  await page.locator(".xterm").waitFor();
  await page.keyboard.type("open-pr");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Meta+ArrowUp");
  await until("SHOP-3 in review", async () => /SHOP-3/.test(await review.innerText()), 20000);
  await writeFile(ticketsFile, JSON.stringify([...all, ticket("SHOP-3", "Third thing"), ticket("SHOP-4", "Fourth thing")]));
  await until("SHOP-4 running", async () => /SHOP-4[\s\S]*running/.test(await sessions.innerText()), 20000);
  await writeFile(ticketsFile, JSON.stringify([...all, ticket("SHOP-3", "Third thing"), ticket("SHOP-4", "Fourth thing"), ticket("SHOP-5", "Fifth thing")]));
  await until("SHOP-5 up next", async () => (await queue.count()) > 0 && /1\s+SHOP-5/.test(await queue.innerText()), 20000);
  assert.match(await sessions.innerText(), /SHOP-1[\s\S]*needs you/);
  const shots = path.join((await import("node:os")).tmpdir(), "pitlane-shots");
  await mkdir(shots, { recursive: true });
  const id = new URL(page.url()).searchParams.get("project");
  let current = page;
  for (const theme of ["vt220", "acme", "night-city", "green-screen", "daylight", "synthwave", "midnight"]) {
    await current.evaluate(({ id, theme }) => window.pitlane.projects.update(id, { theme }), { id, theme }).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 800));
    current = await projectWindow(app);
    await current.reload();
    await current.getByLabel("In review").waitFor();
    await new Promise((resolve) => setTimeout(resolve, 300));
    await current.screenshot({ path: path.join(shots, `${theme}-queue.png`) });
    await assertNothingCut(current, `busy home (${theme})`);
  }
  console.log(`PASS a busy home screen in every theme, in ${shots}`);

  assert.equal(gitIn(repo)("branch", "--show-current"), before.branch);
  assert.equal(gitIn(repo)("status", "--porcelain"), before.status);
  console.log("PASS the project folder itself was never touched");
} finally {
  await app.close();
}
