#!/usr/bin/env node
/**
 * Runs a command with .env loaded.
 *
 * `.env` was being read by prepare-release.mjs, which is its own process. That
 * is enough for the values it writes into files — the update feed, the
 * analytics key — and useless for anything a *sibling* process needs to read
 * from its own environment. electron-builder reads APPLE_API_KEY and friends
 * that way, so a signed build quietly skipped notarisation while reporting
 * success: "`notarize` options were unable to be generated", exit code 0.
 *
 *   node scripts/with-env.mjs electron-builder --mac dmg zip
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./load-env.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv(root);

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("usage: node scripts/with-env.mjs <command> [args...]");
  process.exit(2);
}

const child = spawn(command, args, { stdio: "inherit", env: process.env, shell: false });
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
child.on("error", (error) => {
  console.error(`could not run ${command}: ${error.message}`);
  process.exit(1);
});
