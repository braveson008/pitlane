// Milestone 4 end to end: a review request is reviewed ahead of tickets, drafted, edited and posted only on
// approval; feedback on Pitlane's own PR sends its ticket back to work.
//   npm run build && node tests/m4-smoke.mjs
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { gitIn, launch, makeRepo, projectWindow, root, tempDir, terminalText, until } from "./helpers.mjs";

const temp = await tempDir("pitlane-m4-");
const home = path.join(temp, "home");
await mkdir(home, { recursive: true });
const repo = await makeRepo(temp, "shop", { origin: true, files: { "README.md": "# shop\n" } });
const git = gitIn(repo);
const before = { branch: git("branch", "--show-current"), status: git("status", "--porcelain") };
// A teammate's PR, as GitHub stores it: refs/pull/1/head on the remote.
git("switch", "-q", "-c", "teammate");
await writeFile(path.join(repo, "README.md"), "# shop\nA teammate's line\n");
git("commit", "-qam", "teammate change");
git("push", "-q", "origin", "HEAD:refs/pull/1/head");
git("switch", "-q", "main");
const after = { branch: git("branch", "--show-current"), status: git("status", "--porcelain") };

await writeFile(path.join(home, ".claude.json"), JSON.stringify({ projects: { [repo]: { mcpServers: { atlassian: {} } } } }));
const file = (name) => path.join(temp, name);
await writeFile(file("tickets.json"), "[]");
await writeFile(file("reviews.json"), "[]");
const fakeClaude = JSON.stringify(["node", path.join(root, "tests", "fake-claude.mjs")]);

const app = await launch(temp, {
  HOME: home,
  PITLANE_TEST_FOLDER: repo,
  PITLANE_AGENT_COMMAND: fakeClaude,
  PITLANE_CLAUDE_COMMAND: fakeClaude,
  PITLANE_GH_COMMAND: JSON.stringify(["node", path.join(root, "tests", "fake-gh.mjs")]),
  PITLANE_FAKE_TICKETS: file("tickets.json"),
  PITLANE_FAKE_PRS: file("prs.json"),
  PITLANE_FAKE_REVIEWS: file("reviews.json"),
  PITLANE_FAKE_FEEDBACK: file("feedback.json"),
  PITLANE_FAKE_POSTED: file("posted.json"),
  PITLANE_WATCH_TICK_MS: "1000",
  PITLANE_WATCH_INTERVAL_MS: "1000",
});
try {
  const picker = await app.firstWindow();
  await picker.waitForLoadState("domcontentloaded");
  await picker.getByText("Open folder…").click();
  const page = await projectWindow(app);
  let sessions = page.getByLabel("Sessions");
  const watches = page.getByLabel("Watches");
  await sessions.waitFor();

  await page.keyboard.press("w");
  for (const name of ["Tickets assigned to me", "PRs that need my review"]) {
    await page.keyboard.press("a");
    await page.getByLabel("Add watch").getByText(name).waitFor();
    for (let step = 0; step < 3 && !(await page.getByLabel("Add watch").locator(".row.sel").innerText()).includes(name); step += 1) await page.keyboard.press("j");
    await page.keyboard.press("Enter");
    await watches.getByText(name).waitFor();
    await page.keyboard.press(" ");
  }
  await until("both watches on", async () => ((await watches.innerText()).match(/on · every/g) || []).length === 2);
  await page.keyboard.press("Escape");
  await new Promise((resolve) => setTimeout(resolve, 2500));
  console.log("PASS w adds a ticket watch and a review watch, both switched on");

  // Which watch is polled first is timing; the dispatcher's own ordering is unit-tested. Here: a ticket that
  // arrives while the review holds the only workspace waits for it, and the review is never interrupted.
  await writeFile(file("reviews.json"), JSON.stringify([{ number: 1, title: "Teammate change", url: "https://github.com/acme/shop/pull/1", headRefName: "teammate", author: { login: "teammate" }, authorAssociation: "MEMBER" }]));
  await until("the review started", async () => /review:1[\s\S]*running/.test(await sessions.innerText()), 30000);
  await writeFile(file("tickets.json"), JSON.stringify([{ id: "SHOP-9", title: "Ninth thing", description: "Do it", url: "https://jira.example/SHOP-9", status: "To Do", group: "", updatedAt: "" }]));
  const queue = page.getByLabel("Up next");
  await until("SHOP-9 waiting", async () => (await queue.count()) > 0 && /SHOP-9/.test(await queue.innerText()), 20000);
  assert.match(await sessions.innerText(), /review:1[\s\S]*running/, "the review keeps its workspace");
  await sessions.getByRole("button", { name: /review:1/ }).first().click();
  await until("the review prompt", async () => /prompt: Review pull request #1/.test(await terminalText(page)));
  await page.keyboard.type("review");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Meta+ArrowUp");
  await until("review ready", async () => /review:1[\s\S]*review ready/.test(await sessions.innerText()), 20000);
  console.log("PASS a review request is reviewed ahead of tickets, and its draft waits for the owner");

  // The draft in each theme, to look over by eye.
  const shots = path.join((await import("node:os")).tmpdir(), "pitlane-shots");
  await mkdir(shots, { recursive: true });
  const id = new URL(page.url()).searchParams.get("project");
  let current = page;
  const openDraft = async () => {
    for (let step = 0; step < 12 && !/review:1/.test(await current.locator(".row.sel").first().innerText().catch(() => "")); step += 1) await current.keyboard.press("j");
    await current.keyboard.press("Enter");
    await current.getByLabel("Review draft").getByText("One real issue and a nit.").waitFor();
  };
  for (const theme of ["acme", "night-city", "vt220"]) {
    await current.evaluate(({ id, theme }) => window.pitlane.projects.update(id, { theme }), { id, theme }).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 800));
    current = await projectWindow(app);
    await current.reload();
    await current.getByLabel("Sessions").waitFor();
    await openDraft();
    await current.screenshot({ path: path.join(shots, `${theme}-draft.png`) });
    await current.keyboard.press("Escape");
  }
  const page2 = current;
  sessions = page2.getByLabel("Sessions");
  await openDraft();
  const draft = page2.getByLabel("Review draft");
  await page2.keyboard.press("j");
  await page2.keyboard.press("x");
  await until("one comment left", async () => (await page2.locator(".draft-comment").count()) === 1);
  await page2.keyboard.press("a");
  await page2.getByText(/post this request-changes with 1 comment/).waitFor();
  await page2.keyboard.press("a");
  await until("the review posted", async () => JSON.parse(await readFile(file("posted.json"), "utf8").catch(() => "[]")).length === 1, 15000);
  const posted = JSON.parse(await readFile(file("posted.json"), "utf8"))[0].body;
  assert.equal(posted.event, "REQUEST_CHANGES");
  assert.deepEqual(posted.comments, [{ path: "README.md", line: 2, side: "RIGHT", body: "This line needs a test." }]);
  console.log("PASS the owner drops a comment and approves; exactly one review is posted, with what they kept");

  await until("SHOP-9 running", async () => /SHOP-9[\s\S]*running/.test(await sessions.innerText()), 30000);
  await sessions.getByRole("button", { name: /SHOP-9/ }).click();
  await page2.locator(".xterm").waitFor();
  await page2.keyboard.type("open-pr");
  await page2.keyboard.press("Enter");
  await page2.keyboard.press("Meta+ArrowUp");
  const review = page2.getByLabel("In review");
  await until("SHOP-9 in review", async () => /SHOP-9/.test(await review.innerText()), 20000);
  await writeFile(file("feedback.json"), JSON.stringify({ reviewDecision: "CHANGES_REQUESTED", reviews: [{ author: { login: "lead" }, authorAssociation: "MEMBER", state: "CHANGES_REQUESTED", body: "Handle the empty cart.", submittedAt: new Date(Date.now() + 60_000).toISOString() }], comments: [], statusCheckRollup: [] }));
  await until("SHOP-9 back at work", async () => /SHOP-9[\s\S]*running/.test(await sessions.innerText()), 30000);
  await sessions.getByRole("button", { name: /SHOP-9/ }).first().click();
  await until("feedback in the prompt", async () => /prompt has feedback/.test(await terminalText(page2)), 15000);
  console.log("PASS changes requested on its own PR send the ticket back to work with the feedback");

  assert.equal(git("branch", "--show-current"), after.branch);
  assert.equal(git("status", "--porcelain"), after.status);
  assert.equal(before.branch, after.branch);
  console.log("PASS the project folder itself was never touched");
} finally {
  await app.close();
}
