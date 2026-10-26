export type Part = { kind: "text" | "bold" | "code"; text: string };
export type Line = { kind: "text" | "heading" | "code"; parts: Part[] };

const INLINE = /\*\*([^*]+)\*\*|`([^`]+)`/g;

function inline(text: string): Part[] {
  const parts: Part[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) parts.push({ kind: "text", text: text.slice(last, match.index) });
    parts.push(match[1] !== undefined ? { kind: "bold", text: match[1] } : { kind: "code", text: match[2] });
    last = match.index + match[0].length;
  }
  if (last < text.length || !parts.length) parts.push({ kind: "text", text: text.slice(last) });
  return parts;
}

/** Just enough markdown to read an agent's plan in a terminal look: headings, bold, code spans and fenced blocks. */
export function markdownLines(text: string): Line[] {
  const lines: Line[] = [];
  let fenced = false;
  for (const line of text.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    if (fenced) lines.push({ kind: "code", parts: [{ kind: "text", text: line }] });
    else if (/^#{1,6} /.test(line)) lines.push({ kind: "heading", parts: inline(line.replace(/^#+ /, "")) });
    else lines.push({ kind: "text", parts: inline(line) });
  }
  return lines;
}
