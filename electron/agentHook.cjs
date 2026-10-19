// Run by Claude Code's hooks inside an agent session: records the event where Pitlane is watching.
const fs = require("node:fs");
const path = require("node:path");

const [sessionId, event] = process.argv.slice(2);
const dir = process.env.PITLANE_EVENTS_DIR;
let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  if (!dir || !/^[\w-]+$/.test(sessionId || "")) return;
  let message;
  try {
    message = JSON.parse(input || "{}").message;
  } catch {
    message = undefined;
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, `${sessionId}.jsonl`), `${JSON.stringify({ event, at: Date.now(), ...(message ? { message } : {}) })}\n`);
});
