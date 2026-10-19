// Stands in for an agent CLI in end-to-end tests: says it's ready, echoes each line, and runs a few commands.
import fs from "node:fs";
import readline from "node:readline";

process.stdout.write("fake agent ready\r\n");
const lines = readline.createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const [command, file] = line.split(" ");
  if (line === "exit") process.exit(0);
  if (line === "pwd") return process.stdout.write(`cwd: ${process.cwd()}\r\n`);
  if (command === "touch") {
    fs.writeFileSync(file, "made by the agent\n");
    return process.stdout.write(`touched ${file}\r\n`);
  }
  if (command === "edit") {
    fs.appendFileSync(file, "edited by the agent\n");
    return process.stdout.write(`edited ${file}\r\n`);
  }
  process.stdout.write(`you said: ${line.replace(/\x1b/g, "<esc>")}\r\n`);
});
