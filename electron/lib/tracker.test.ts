import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { pollAssigned, readTicket } = require("./tracker.cjs");

type Call = { args: string[]; input: string; options: { cwd: string; timeoutMs: number } };

function runner(result: { ok: boolean; stdout?: string; stderr?: string }) {
  const calls: Call[] = [];
  const run = async (args: string[], input: string, options: Call["options"]) => {
    calls.push({ args, input, options });
    return { stdout: "", stderr: "", ...result };
  };
  return { calls, run };
}

const envelope = (tasks: unknown[]) => JSON.stringify({ type: "result", result: JSON.stringify({ tasks }) });

const after = (args: string[], flag: string) => {
  const start = args.indexOf(flag) + 1;
  const end = args.findIndex((arg, index) => index >= start && arg.startsWith("--"));
  return args.slice(start, end === -1 ? undefined : end);
};

describe("tracker poll", () => {
  it("poll denies every editing tool and allows only the server's read-only tools", async () => {
    const { calls, run } = runner({ ok: true, stdout: envelope([]) });
    await pollAssigned({ cwd: "/repo", server: "atlassian", run });
    const args = calls[0].args;
    expect(args.slice(0, 3)).toEqual(["-p", "--output-format", "json"]);
    expect(after(args, "--model")).toEqual(["sonnet"]);
    expect(after(args, "--disallowedTools")).toEqual(expect.arrayContaining(["Bash", "Edit", "Write", "NotebookEdit", "Read", "WebFetch", "Task"]));
    const allowed = after(args, "--allowedTools");
    expect(allowed.length).toBeGreaterThan(0);
    expect(allowed.every((tool) => tool.startsWith("mcp__atlassian__"))).toBe(true);
    expect(allowed).not.toContain("mcp__atlassian__editJiraIssue");
    expect(calls[0].input).toMatch(/^Use only the explicitly allowed read-only tools in MCP namespace atlassian\./);
    expect(calls[0].options).toEqual({ cwd: "/repo", timeoutMs: 240_000 });
  });

  it("runs where anything not explicitly allowed is refused, and leaves no session behind", async () => {
    const { calls, run } = runner({ ok: true, stdout: envelope([]) });
    await pollAssigned({ cwd: "/repo", server: "atlassian", run });
    // The owner's default mode may be auto, which would hand unlisted tools to a classifier instead of refusing them.
    expect(after(calls[0].args, "--permission-mode")).toEqual(["dontAsk"]);
    expect(calls[0].args).toContain("--no-session-persistence");
  });

  it("a watch's scope narrows what the poll asks for", async () => {
    const { calls, run } = runner({ ok: true, stdout: envelope([]) });
    await pollAssigned({ cwd: "/repo", server: "atlassian", scope: "SHOP project", run });
    expect(calls[0].input).toContain("Only items from SHOP project");
  });

  it("a watch's instructions go into the poll in place of assigned-to-me", async () => {
    const { calls, run } = runner({ ok: true, stdout: envelope([]) });
    await pollAssigned({ cwd: "/repo", server: "atlassian", instructions: "tickets where I'm mentioned", run });
    expect(calls[0].input).toContain("in their words: tickets where I'm mentioned");
    expect(calls[0].input).not.toMatch(/assigned to the currently authenticated user/);
  });

  it("reading a ticket asks for that key alone, so one a custom watch found can be read too", async () => {
    const { calls, run } = runner({ ok: true, stdout: envelope([{ id: "SHOP-7", title: "Bug", url: "https://x/SHOP-7", status: "To Do" }]) });
    const ticket = await readTicket({ cwd: "/repo", server: "atlassian", key: "SHOP-7", run });
    expect(ticket).toMatchObject({ id: "SHOP-7" });
    expect(calls[0].input).toContain("Only the item whose key is SHOP-7");
    expect(calls[0].input).not.toMatch(/assigned to the currently authenticated user/);
  });

  it("poll parses tickets from Claude's JSON envelope", async () => {
    const { run } = runner({ ok: true, stdout: envelope([{ id: "SHOP-1", title: "Fix it", url: "https://x/SHOP-1", status: "To Do" }]) });
    const result = await pollAssigned({ cwd: "/repo", server: "atlassian", run });
    expect(result).toMatchObject({ ok: true, tasks: [{ id: "SHOP-1", title: "Fix it" }] });
  });

  it("prose instead of JSON is an error, not an empty list", async () => {
    const { run } = runner({ ok: true, stdout: JSON.stringify({ type: "result", result: "I could not reach Jira, sorry." }) });
    const result = await pollAssigned({ cwd: "/repo", server: "atlassian", run });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/task list/);
  });

  it("a timeout is an error", async () => {
    const { run } = runner({ ok: false, stderr: "timed out after 240000ms" });
    expect(await pollAssigned({ cwd: "/repo", server: "linear", run })).toEqual({ ok: false, error: "timed out after 240000ms" });
  });

  it("a server that is not a known tracker is refused before running", async () => {
    const { calls, run } = runner({ ok: true, stdout: envelope([]) });
    const result = await pollAssigned({ cwd: "/repo", server: "figma", run });
    expect(result).toEqual({ ok: false, error: "figma is not a Jira or Linear MCP server" });
    expect(calls).toEqual([]);
  });

  it("readTicket asks for one key with the full description", async () => {
    const { calls, run } = runner({ ok: true, stdout: envelope([{ id: "SHOP-2", title: "Two", description: "Full text", url: "u" }]) });
    const ticket = await readTicket({ cwd: "/repo", server: "atlassian", key: "SHOP-2", run });
    expect(ticket).toMatchObject({ id: "SHOP-2", description: "Full text" });
    expect(calls[0].input).toContain("SHOP-2");
    expect(calls[0].input).toContain("copied verbatim");
  });
});
