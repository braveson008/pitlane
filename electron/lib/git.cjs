const { execFile } = require("node:child_process");

function runGit(cwd, args, { env, input, timeout = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile("git", args, {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...env },
      timeout,
      maxBuffer: 64 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) reject(new Error(String(stderr || error.message).trim()));
      else resolve(String(stdout).trim());
    });
    if (input !== undefined) child.stdin.end(input);
  });
}

module.exports = { runGit };
