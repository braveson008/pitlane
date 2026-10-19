/**
 * Turning a unified diff into something that can be rendered line by line.
 *
 * Only what a reviewer reads is kept: the hunks, and for each line whether it
 * was added, removed or is context, with the line numbers on each side. The
 * `diff --git`, `index` and mode headers are dropped — they carry nothing a
 * person reviewing a change needs, and every one of them is a row that pushes
 * the actual change further down the panel.
 */

export type DiffLineKind = "added" | "removed" | "context" | "meta";

export type DiffLine = {
  kind: DiffLineKind;
  text: string;
  /** Line number in the old file, or null for an added line. */
  before: number | null;
  /** Line number in the new file, or null for a removed line. */
  after: number | null;
};

export type DiffHunk = {
  /** The `@@ … @@` line, which often names the enclosing function. */
  header: string;
  lines: DiffLine[];
};

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

/** Headers that describe the file rather than the change. */
function isFileHeader(line: string): boolean {
  return (
    line.startsWith("diff --git ") ||
    line.startsWith("index ") ||
    line.startsWith("--- ") ||
    line.startsWith("+++ ") ||
    line.startsWith("old mode ") ||
    line.startsWith("new mode ") ||
    line.startsWith("new file mode ") ||
    line.startsWith("deleted file mode ") ||
    line.startsWith("similarity index ") ||
    line.startsWith("rename from ") ||
    line.startsWith("rename to ")
  );
}

export function parseDiff(patch: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let before = 0;
  let after = 0;

  for (const raw of String(patch ?? "").split(/\r?\n/)) {
    const match = raw.match(HUNK);
    if (match) {
      before = Number(match[1]);
      after = Number(match[3]);
      current = { header: match[5].trim(), lines: [] };
      hunks.push(current);
      continue;
    }

    // Every content line in a unified diff carries a prefix character, even a
    // blank one, which arrives as a single space. A genuinely empty string is
    // therefore not content — it is the trailing element left by splitting a
    // patch that ends in a newline, and rendering it adds a phantom blank line
    // to the bottom of every file.
    if (raw === "") continue;

    if (!current) {
      // Anything before the first hunk is a file header, except for the
      // synthesised all-plus patch used for a file git has never seen.
      if (isFileHeader(raw)) continue;
      if (raw.startsWith("+")) {
        current = { header: "", lines: [] };
        hunks.push(current);
        before = 0;
        after = 1;
      } else {
        continue;
      }
    }

    if (raw.startsWith("+")) {
      current.lines.push({ kind: "added", text: raw.slice(1), before: null, after });
      after += 1;
    } else if (raw.startsWith("-")) {
      current.lines.push({ kind: "removed", text: raw.slice(1), before, after: null });
      before += 1;
    } else if (raw.startsWith("\\")) {
      // "\ No newline at end of file" — true, and not worth a row.
      continue;
    } else {
      const text = raw.startsWith(" ") ? raw.slice(1) : raw;
      current.lines.push({ kind: "context", text, before, after });
      before += 1;
      after += 1;
    }
  }

  return hunks.filter((hunk) => hunk.lines.length > 0);
}

/** Whether a patch is large enough that showing all of it is unkind. */
export const LARGE_DIFF_LINES = 600;

export function countLines(hunks: DiffHunk[]): number {
  return hunks.reduce((total, hunk) => total + hunk.lines.length, 0);
}
