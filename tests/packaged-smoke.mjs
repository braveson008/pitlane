// The packaged app, not the dev build: a session starts and runs, so node-pty and its helper survived packaging.
//   npm run dist:unsigned && node tests/packaged-smoke.mjs
import assert from "node:assert/strict";
import path from "node:path";
import { _electron as electron } from "playwright";
import { makeRepo, projectWindow, root, tempDir, terminalText, until } from "./helpers.mjs";

const temp = await tempDir("pitlane-packaged-");
const repo = await makeRepo(temp, "shop", { origin: true });
const executablePath = path.join(root, "release", "mac-arm64", "Pitlane.app", "Contents", "MacOS", "Pitlane");
const app = await electron.launch({
  executablePath,
  env: {
    ...process.env,
    PITLANE_E2E: "1",
    PITLANE_USER_DATA_DIR: path.join(temp, "profile"),
    PITLANE_TEST_FOLDER: repo,
    PITLANE_AGENT_COMMAND: JSON.stringify(["node", path.join(root, "tests", "fake-agent.mjs")]),
  },
});
try {
  const picker = await app.firstWindow();
  await picker.waitForLoadState("domcontentloaded");
  assert.equal(await picker.title(), "Pitlane");
  await picker.getByText("Open folder…").click();
  const page = await projectWindow(app);
  await page.getByLabel("Sessions").waitFor();
  await page.keyboard.press("n");
  await page.keyboard.press("Enter");
  await until("the packaged app's agent", async () => /fake agent ready/.test(await terminalText(page)));
  await page.keyboard.type("pwd");
  await page.keyboard.press("Enter");
  await until("its workspace", async () => /cwd: .*workspaces/.test(await terminalText(page)));
  console.log("PASS the packaged app starts an agent in a workspace");
} finally {
  await app.close();
}
