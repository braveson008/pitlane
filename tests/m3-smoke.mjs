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
const customFile = path.join(temp, "custom-tickets.json");
const ticket = (id, title) => ({ id, title, description: `Description of ${id}`, url: `https://jira.example/${id}`, status: "To Do", group: "", updatedAt: "" });
await writeFile(ticketsFile, JSON.stringify([ticket("SHOP-1", "First thing")]));
const asked = "unassigned bugs labelled frontend";
await writeFile(customFile, JSON.stringify({ [asked]: [ticket("SHOP-9", "Old bug")] }));
const fakeClaude = JSON.stringify(["node", path.join(root, "tests", "fake-claude.mjs")]);

const app = await launch(temp, {
  HOME: home,
  PITLANE_TEST_FOLDER: repo,
  PITLANE_AGENT_COMMAND: fakeClaude,
  PITLANE_CLAUDE_COMMAND: fakeClaude,
  PITLANE_GH_COMMAND: JSON.stringify(["node", path.join(root, "tests", "fake-gh.mjs")]),
  PITLANE_FAKE_TICKETS: ticketsFile,
  PITLANE_FAKE_PRS: prsFile,
  PITLANE_FAKE_CUSTOM_TICKETS: customFile,
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
  await page.keyboard.press("r");
  await page.getByRole("alert").getByText("no watch is on · w to switch one on").waitFor();
  console.log("PASS r on home with no watch on says how to get one");

  await page.keyboard.press("w");
  await page.getByText("No watches yet · a adds one").waitFor();
  await page.keyboard.press("a");
  await page.getByLabel("Add watch").getByText("atlassian").first().waitFor();
  await page.keyboard.press("Enter");
  await watches.getByText("atlassian").waitFor();
  assert.match(await watches.innerText(), /paused/);
  // Edit before switching on: a scope, and a slower interval.
  await page.keyboard.press("e");
  const editor = page.getByLabel("Edit watch");
  await page.keyboard.press("ArrowDown");
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
  // Run now checks a paused watch once and leaves it paused.
  await page.keyboard.press("r");
  await until("the paused watch checked", async () => /checked /.test(await watches.innerText()), 20000);
  assert.match(await watches.innerText(), /paused/);
  console.log("PASS r runs a paused watch once and it stays paused");
  await page.keyboard.press(" ");
  await until("the watch on", async () => /on · every 10m/.test(await watches.innerText()));
  await page.screenshot({ path: path.join(shotsDir, "watches.png") });
  await page.keyboard.press("Escape");
  await page.getByLabel("Sessions").waitFor();
  const notStarted = page.getByLabel("Not started");
  await until("SHOP-1 baselined", async () => (await notStarted.count()) > 0 && /1 already under way, assigned before the watch began/.test(await notStarted.innerText()), 20000);
  assert.doesNotMatch(await notStarted.innerText(), /SHOP-1/, "not-started tickets are folded away until asked for");
  console.log("PASS a watch is added, scoped and timed on its own screen; tickets already assigned are folded under not started");

  // Assigned after the watch began but already past development: listed with its status, never up next.
  await writeFile(ticketsFile, JSON.stringify([ticket("SHOP-1", "First thing"), { ...ticket("SHOP-9", "Already in QA"), status: "Ready for QA", stage: "started" }]));
  await until("SHOP-9 listed", async () => /2 already under way/.test(await notStarted.innerText()), 20000);
  assert.equal(await page.getByLabel("Up next").count(), 0, "a ticket under way in the tracker is not queued");
  await writeFile(ticketsFile, JSON.stringify([ticket("SHOP-1", "First thing"), ticket("SHOP-2", "Second thing"), { ...ticket("SHOP-9", "Already in QA"), status: "Ready for QA", stage: "started" }]));
  const sessions = page.getByLabel("Sessions");
  console.log("PASS a ticket already under way in the tracker is listed under not started, not queued");
  // A new ticket is planned first; the work starts only when the owner starts it from the plan.
  const planAndStart = async (key, { shot } = {}) => {
    await until(`${key} planning`, async () => new RegExp(`${key} plan[\\s\\S]*running`).test(await sessions.innerText()), 30000);
    await sessions.getByRole("button", { name: new RegExp(`${key} plan`) }).first().click();
    await until(`the ${key} planning prompt`, async () => new RegExp(`prompt: Plan ${key}\\.`).test(await terminalText(page)));
    if (shot) {
      // The planner runs like a reviewer: no host credentials, and no gh, glab or git push.
      await page.keyboard.type("creds");
      await page.keyboard.press("Enter");
      await until("the planner's sandbox", async () => /gh-token:\[\] denied:true/.test(await terminalText(page)));
      // A question while planning waits on the owner; the plan written after it still arrives.
      await page.keyboard.type("ask");
      await page.keyboard.press("Enter");
      await until("asked", async () => /asked/.test(await terminalText(page)));
    }
    await page.keyboard.type("plan");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Meta+ArrowUp");
    await until(`${key} plan ready`, async () => new RegExp(`${key}[^\\n]*\\n?[^\\n]*plan ready`).test(await sessions.innerText()), 20000);
    await sessions.getByRole("button", { name: new RegExp(`${key}.*plan ready`) }).click();
    await page.getByLabel("Plan").getByText("Do the thing.").waitFor();
    if (shot) {
      await page.screenshot({ path: path.join(shotsDir, "plan.png") });
      await assertNothingCut(page, "plan screen");
      // The plan reads as formatted text, wraps inside the window, and the whole screen scrolls with j.
      const layout = await page.evaluate(() => {
        const screen = document.querySelector('[aria-label="Plan"]');
        const hints = document.querySelector(".hints").getBoundingClientRect();
        const widest = Math.max(...[...screen.querySelectorAll(".plan-text p")].map((line) => line.getBoundingClientRect().right));
        return { text: screen.innerText, hintsBottom: hints.bottom, widest, width: innerWidth, height: innerHeight, scrollable: screen.scrollHeight > screen.clientHeight };
      });
      assert.doesNotMatch(layout.text, /\*\*|```|^#/m, "markdown marks are not shown raw");
      assert.ok(layout.widest <= layout.width && layout.hintsBottom <= layout.height, `plan fits the window: ${JSON.stringify(layout)}`);
      assert.ok(layout.scrollable, "a long plan scrolls the screen");
      await page.keyboard.press("j");
      await until("the plan scrolled", () => page.evaluate(() => document.querySelector('[aria-label="Plan"]').scrollTop > 0));
    }
    await page.keyboard.press("s");
    await page.getByText(`start work on ${key} in its own branch? s again`).waitFor();
    await page.keyboard.press("s");
    await sessions.waitFor();
  };
  await planAndStart("SHOP-2", { shot: true });
  console.log("PASS a newly assigned ticket is planned first, and the plan waits for the owner");
  await until("SHOP-2 started", async () => /SHOP-2 Second thing[\s\S]*running/.test(await sessions.innerText()), 30000);
  await sessions.getByRole("button", { name: /SHOP-2 Second thing/ }).click();
  await until("the lead prompt", async () => /prompt: Work on SHOP-2\./.test(await terminalText(page)));
  await page.keyboard.type("branch");
  await page.keyboard.press("Enter");
  await until("the branch", async () => /branch: shop-2-second-thing/.test(await terminalText(page)));
  console.log("PASS starting the plan runs the lead agent on its own branch with the ticket in its prompt");

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
  await until("SHOP-1 planning", async () => /SHOP-1 plan[\s\S]*running/.test(await sessions.innerText()), 20000);
  console.log("PASS a not-started ticket is planned when the owner chooses it");

  // A busy home screen in each theme: one ticket needing the owner, one running, one queued, one in review.
  const all = [ticket("SHOP-1", "First thing"), ticket("SHOP-2", "Second thing")];
  await writeFile(ticketsFile, JSON.stringify([...all, ticket("SHOP-3", "Third thing")]));
  const queue = page.getByLabel("Up next");
  await until("SHOP-3 up next", async () => (await queue.count()) > 0 && /1\s+SHOP-3/.test(await queue.innerText()), 20000);
  await sessions.getByRole("button", { name: /SHOP-1 plan/ }).click();
  await page.locator(".xterm").waitFor();
  await page.keyboard.type("exit");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Meta+ArrowUp");
  await until("SHOP-1 without a plan", async () => /SHOP-1[^\n]*\n?[^\n]*needs you[^\n]*\n?[^\n]*no plan written/.test(await sessions.innerText()), 20000);
  assert.doesNotMatch(await sessions.innerText(), /SHOP-1[^\n]*\n?[^\n]*needs you[^\n]*\n?[^\n]*no PR/);
  console.log("PASS a planner that stops without a plan leaves the ticket waiting on the owner, saying so");
  await until("the tab says so", async () => /shop !\d/.test(await page.getByLabel("Projects").innerText()));
  console.log("PASS the project's tab shows how many things wait on the owner");
  await planAndStart("SHOP-3");
  await until("SHOP-3 running", async () => /SHOP-3 Third thing[\s\S]*running/.test(await sessions.innerText()), 20000);
  await sessions.getByRole("button", { name: /SHOP-3 Third thing/ }).first().click();
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
  for (const theme of ["github-dark", "nord", "one-dark", "dracula", "tokyo-night"]) {
    assert.equal((await current.evaluate(({ id, theme }) => window.pitlane.projects.update(id, { theme }), { id, theme })).theme, theme);
    await current.reload();
    assert.equal(await current.evaluate(() => document.documentElement.dataset.theme), theme);
    await current.getByLabel("In review").waitFor();
    await new Promise((resolve) => setTimeout(resolve, 300));
    await current.screenshot({ path: path.join(shots, `${theme}-queue.png`) });
    await assertNothingCut(current, `busy home (${theme})`);
  }
  console.log(`PASS a busy home screen in every theme, in ${shots}`);

  // A watch in the owner's own words: it finds tickets nobody assigned, and a new one is planned like any other.
  await current.keyboard.press("w");
  const watchList = current.getByLabel("Watches");
  await watchList.waitFor();
  await current.keyboard.press("a");
  const addList = current.getByLabel("Add watch");
  await addList.getByText("in your own words").waitFor();
  for (let i = 0; i < 6 && !/in your own words/.test(await addList.locator(".row.sel").innerText()); i += 1) await current.keyboard.press("j");
  await current.keyboard.press("Enter");
  await current.getByLabel("Looks for").fill(asked);
  await current.getByLabel("Looks for").press("Enter");
  await until("the described watch", async () => /Tickets I describe atlassian · “unassigned bugs labelled frontend”/.test(await watchList.innerText()));
  await current.screenshot({ path: path.join(shotsDir, "watch-describe.png") });
  await assertNothingCut(current, "watches with a described watch");
  await current.keyboard.press(" ");
  await until("the described watch baselined", async () => /(?<!not )checked /.test(await watchList.locator(".row.sel").innerText()), 20000);
  await writeFile(customFile, JSON.stringify({ [asked]: [ticket("SHOP-9", "Old bug"), ticket("SHOP-10", "New bug")] }));
  await current.keyboard.press("Escape");
  const currentSessions = current.getByLabel("Sessions");
  await until("SHOP-10 planned", async () => /SHOP-10 plan[\s\S]*running/.test(await currentSessions.innerText()), 30000);
  assert.doesNotMatch(await currentSessions.innerText(), /SHOP-9 plan/, "what the watch found when it began is listed, not planned");
  console.log("PASS a watch in the owner's own words finds tickets nobody assigned, and plans a new one");

  assert.equal(gitIn(repo)("branch", "--show-current"), before.branch);
  assert.equal(gitIn(repo)("status", "--porcelain"), before.status);
  console.log("PASS the project folder itself was never touched");
} finally {
  await app.close();
}
