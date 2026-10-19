import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Loads a gitignored .env into process.env.
 *
 * Build-time secrets fall back to a file because the alternative is that every
 * release depends on someone remembering to export them, and a forgotten export
 * produces a build that looks fine and is wrong in a way nothing announces.
 *
 * A real environment variable always wins, so CI is unaffected.
 */
export function loadEnv(root) {
  let contents = "";
  try {
    contents = readFileSync(path.join(root, ".env"), "utf8");
  } catch {
    return;
  }
  for (const line of contents.split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.trim().replace(/^["']|["']$/g, "");
  }
}
