// Stands in for the claude CLI in end-to-end tests.
//  -p: answers a tracker poll from the PITLANE_FAKE_TICKETS fixture.
//  otherwise: an interactive agent that prints its first prompt, echoes lines, and can "open a PR".
import fs from "node:fs";
import readline from "node:readline";
import { execFileSync, execSync } from "node:child_process";

const args = process.argv.slice(2);
if (args.includes("-p")) {
  let input = "";
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    const tasks = JSON.parse(fs.readFileSync(process.env.PITLANE_FAKE_TICKETS, "utf8"));
    const asked = input.match(/Match this optional search: (\S+)/)?.[1];
    const chosen = asked ? tasks.filter((task) => task.id === asked.replace(/\.$/, "")) : tasks;
    process.stdout.write(JSON.stringify({ type: "result", result: JSON.stringify({ tasks: chosen }) }));
  });
} else {
  const prompt = args.filter((arg, index) => !arg.startsWith("--") && !(args[index - 1] || "").startsWith("--")).pop() || "";
  process.stdout.write("fake agent ready\r\n");
  if (prompt) process.stdout.write(`prompt: ${prompt.split("\n")[0]}\r\n`);
  if (prompt.includes("```feedback")) process.stdout.write("prompt has feedback\r\n");
  // Like Claude, run the Stop hook at the end of every turn.
  const settingsAt = args.indexOf("--settings");
  const stopHook = settingsAt >= 0 ? JSON.parse(args[settingsAt + 1]).hooks?.Stop?.[0]?.hooks?.[0]?.command : null;
  const turnEnded = () => { if (stopHook) execSync(stopHook, { input: "{}", stdio: ["pipe", "ignore", "ignore"] }); };
  const lines = readline.createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    handle(line);
    turnEnded();
  });
  const handle = (line) => {
    if (line === "exit") process.exit(0);
    if (line === "review") {
      fs.mkdirSync(".pitlane", { recursive: true });
      fs.writeFileSync(".pitlane/review.json", JSON.stringify({
        summary: "One real issue and a nit.",
        verdict: "request-changes",
        comments: [{ path: "README.md", line: 2, body: "This line needs a test." }, { path: "README.md", line: 2, body: "Nit: wording." }],
      }));
      return process.stdout.write("review written\r\n");
    }
    if (line === "branch") return process.stdout.write(`branch: ${execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim()}\r\n`);
    if (line === "open-pr") {
      const branch = execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim();
      const file = process.env.PITLANE_FAKE_PRS;
      const prs = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
      prs[branch] = { url: `https://github.com/acme/shop/pull/${Object.keys(prs).length + 1}`, state: "OPEN" };
      fs.writeFileSync(file, JSON.stringify(prs));
      return process.stdout.write(`opened ${prs[branch].url}\r\n`);
    }
    process.stdout.write(`you said: ${line}\r\n`);
  };
}
