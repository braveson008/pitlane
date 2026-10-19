import { describe, expect, it } from "vitest";
import {
  buildPickTaskPrompt,
  buildListTasksPrompt,
  parsePickedTask,
  parseTaskList,
  describePickedTask,
  extractJsonObject,
  normalizedMcpSourceName,
  resolveMcpTaskSource,
  readOnlyTrackerToolNames,
} from "./trackerTasks.cjs";

describe("resolveMcpTaskSource", () => {
  it("preserves the private Claude auth alias for an Atlassian plugin display name", () => {
    const result = resolveMcpTaskSource(
      { source: "plugin:atlassian:atlassian", target: "https://mcp.atlassian.com/v1/sse" },
      [{ name: "plugin:atlassian:atlassian", target: "https://mcp.atlassian.com/v1/sse", status: "connected" }],
      [{ name: "Atlassian", alias: "tool_atlassian_123", target: "https://mcp.atlassian.com/v1/sse", authenticatedAt: "now" }],
    );
    expect(result.profile?.alias).toBe("tool_atlassian_123");
  });

  it("reads the alias the tool authenticated, not the user's same-named server", () => {
    // The exact shape that broke a real import: a tool registers its own
    // server under an alias and authenticates that; the user's own server of
    // the same name sits beside it unauthenticated. Matching the plain name
    // reported the source as disconnected while the tool's was connected.
    const result = resolveMcpTaskSource(
      { source: "linear", target: "https://mcp.linear.app/mcp" },
      [
        { name: "linear", target: "https://mcp.linear.app/mcp", status: "needs-auth", statusText: "Needs authentication" },
        { name: "tool_linear_3eb8a846c6", target: "https://mcp.linear.app/mcp", status: "connected" },
      ],
      [{ name: "linear", alias: "tool_linear_3eb8a846c6", target: "https://mcp.linear.app/mcp", authenticatedAt: "2026-08-20T00:00:00.000Z" }],
    );
    expect(result.server?.name).toBe("tool_linear_3eb8a846c6");
    expect(result.server?.status).toBe("connected");
    expect(result.profile?.alias).toBe("tool_linear_3eb8a846c6");
  });

  it("still finds the server by name when no binding exists", () => {
    const result = resolveMcpTaskSource(
      { source: "linear", target: "https://mcp.linear.app/mcp" },
      [{ name: "linear", target: "https://mcp.linear.app/mcp", status: "connected" }],
      [],
    );
    expect(result.server?.name).toBe("linear");
    expect(result.profile).toBeUndefined();
  });

  it("does not match an unrelated tracker merely because both use HTTP", () => {
    const result = resolveMcpTaskSource(
      { source: "Jira", target: "https://jira.example/mcp" },
      [{ name: "Linear", target: "https://linear.example/mcp", status: "connected" }],
      [{ name: "Linear", alias: "linear_private", target: "https://linear.example/mcp" }],
    );
    expect(result).toEqual({ profile: undefined, server: undefined });
    expect(normalizedMcpSourceName("plugin:atlassian:atlassian")).toBe("atlassian");
  });

  it("prefers the selected profile name when hosted trackers share an endpoint", () => {
    const result = resolveMcpTaskSource(
      { source: "team-b", target: "https://mcp.atlassian.com/v1/sse" },
      [{ name: "team-b", target: "https://mcp.atlassian.com/v1/sse", status: "connected" }],
      [
        { name: "team-a", alias: "alias_a", target: "https://mcp.atlassian.com/v1/sse" },
        { name: "team-b", alias: "alias_b", target: "https://mcp.atlassian.com/v1/sse" },
      ],
    );
    expect(result.profile?.alias).toBe("alias_b");
  });
});

describe("readOnlyTrackerToolNames", () => {
  it("grants exact audited reads and never tracker mutations", () => {
    const tools = readOnlyTrackerToolNames({ source: "Jira", server: "tool_atlassian_123" });
    expect(tools).toContain("mcp__tool_atlassian_123__searchJiraIssuesUsingJql");
    expect(tools).toContain("mcp__tool_atlassian_123__getJiraIssue");
    expect(tools.some((tool) => /__(?:create|update|transition|comment|addWorklog)/i.test(tool))).toBe(false);
  });

  it("refuses unknown MCP families rather than granting a whole server", () => {
    expect(readOnlyTrackerToolNames({ source: "custom-mcp", server: "custom-mcp" })).toEqual([]);
  });
});

describe("buildListTasksPrompt", () => {
  it("asks only for the list when brief, and for every word when not", () => {
    const brief = buildListTasksPrompt({ source: "atlassian", brief: true });
    expect(brief).toMatch(/Leave every description as an empty string/);
    expect(brief).not.toMatch(/copied verbatim/);
    expect(buildListTasksPrompt({ source: "atlassian" })).toMatch(/copied verbatim/);
  });

  it("requests a read-only, bounded preview of open assigned work", () => {
    const prompt = buildListTasksPrompt({ source: "Linear", query: "parser", limit: 12 });
    expect(prompt).toMatch(/read-only request/i);
    expect(prompt).toMatch(/assigned to the currently authenticated user/i);
    expect(prompt).toMatch(/at most 12 items/i);
    expect(prompt).toMatch(/parser/);
    expect(prompt).toMatch(/do not create, update, transition, assign, or comment/i);
  });

  it("confines the read to the project's own site or key when one is set", () => {
    expect(buildListTasksPrompt({ source: "Atlassian" })).not.toMatch(/only items from/i);
    const prompt = buildListTasksPrompt({ source: "Atlassian", scope: "SHOP" });
    expect(prompt).toMatch(/only items from SHOP/i);
    expect(prompt).toMatch(/even when they are assigned to the user/i);
  });
});

describe("buildPickTaskPrompt", () => {
  it("pins down what 'latest' means instead of leaving it to the tracker", () => {
    const prompt = buildPickTaskPrompt({ source: "Linear" });
    expect(prompt).toMatch(/assigned to the currently authenticated user/i);
    expect(prompt).toMatch(/most recently updated/i);
    expect(prompt).toMatch(/never one that is done, closed, or cancelled/i);
  });

  it("tells it to return nothing rather than a near miss", () => {
    // Starting a session on the wrong ticket costs far more than asking again.
    const prompt = buildPickTaskPrompt({ source: "Jira" });
    expect(prompt).toMatch(/"none": true/);
    expect(prompt).toMatch(/do not invent an item/i);
  });

  it("passes on what the user said about which item they meant", () => {
    expect(buildPickTaskPrompt({ source: "Linear", hint: "the parser bug" })).toMatch(/the parser bug/);
    expect(buildPickTaskPrompt({ source: "Linear" })).not.toMatch(/the user described it as/i);
  });
});

describe("extractJsonObject", () => {
  it("finds the object through the wrappers a model actually emits", () => {
    const expected = { id: "ENG-412" };
    expect(extractJsonObject('{"id":"ENG-412"}')).toEqual(expected);
    expect(extractJsonObject('```json\n{"id":"ENG-412"}\n```')).toEqual(expected);
    expect(extractJsonObject('Here you go:\n\n{"id":"ENG-412"}\n\nHope that helps!')).toEqual(expected);
  });

  it("returns null rather than a guess", () => {
    for (const raw of ["", "I couldn't find anything.", "[1,2,3]", "{not json}"]) {
      expect(extractJsonObject(raw), raw).toBeNull();
    }
  });
});

describe("parsePickedTask", () => {
  it("reads a real answer", () => {
    const result = parsePickedTask(
      '{"id":"ENG-412","title":"Fix the parser","description":"It drops the last token.","url":"https://linear.app/x/ENG-412","status":"In Progress","updatedAt":"2026-08-01T10:00:00Z"}',
    );
    expect(result.ok).toBe(true);
    expect(result.task).toMatchObject({
      id: "ENG-412",
      title: "Fix the parser",
      description: "It drops the last token.",
      status: "In Progress",
    });
  });

  it("keeps only the fields it declares, whatever else came back", () => {
    // The tracker's reply is untrusted; letting arbitrary keys through would
    // mean the model decides what kind of thing this is.
    const result = parsePickedTask(
      '{"title":"Fix the parser","assignee":"someone","__proto__":"x","command":"rm -rf /","priority":9}',
    );
    expect(result.ok).toBe(true);
    expect(Object.keys(result.task).sort()).toEqual(["title"]);
    expect((result.task as any).command).toBeUndefined();
  });

  it("explains an empty result in the tracker's own words", () => {
    const result = parsePickedTask('{"none":true,"why":"Nothing is assigned to you right now."}');
    expect(result.ok).toBe(false);
    expect(result.why).toBe("Nothing is assigned to you right now.");
  });

  it("refuses an item with no title", () => {
    // A task nobody can name cannot be spoken back or checked, so a session
    // must not start on it.
    expect(parsePickedTask('{"id":"ENG-412"}').ok).toBe(false);
    expect(parsePickedTask('{"title":"   "}').ok).toBe(false);
  });

  it("refuses an unreadable reply instead of starting work on nothing", () => {
    for (const raw of ["", "I'm not sure which one you mean.", "```\nnope\n```"]) {
      expect(parsePickedTask(raw).ok, raw).toBe(false);
    }
  });

  it("keeps a long description whole", () => {
    // It used to be cut at 4kB, and the cut landed silently in the middle of the
    // acceptance criteria — a truncated description is a different ticket
    // wearing the same key. Trimming for a prompt happens where the prompt is
    // built, and says so when it does.
    const body = "a".repeat(40_000);
    const parsed = parsePickedTask(JSON.stringify({ id: "T-1", title: "t", description: body }));
    expect(parsed.ok).toBe(true);
    expect(parsed.task.description.length).toBe(40_000);
  });

  it("flattens newlines out of the title so it stays one spoken line", () => {
    const result = parsePickedTask(JSON.stringify({ title: "Fix\n\nthe   parser" }));
    expect(result.task.title).toBe("Fix the parser");
  });
});

describe("parseTaskList", () => {
  it("normalizes, deduplicates, and strips undeclared tracker fields", () => {
    const result = parseTaskList(JSON.stringify({
      tasks: [
        { id: "ENG-412", title: "Fix parser", status: "Todo", command: "ignore safeguards" },
        { id: "ENG-412", title: "Duplicate" },
        { id: "ENG-413", title: "Ship preview", url: "https://linear.app/ENG-413" },
        { id: "ENG-414" },
      ],
    }));
    expect(result.ok).toBe(true);
    expect(result.tasks).toEqual([
      { id: "ENG-412", title: "Fix parser", status: "Todo" },
      { id: "ENG-413", title: "Ship preview", url: "https://linear.app/ENG-413" },
    ]);
    expect((result.tasks[0] as any).command).toBeUndefined();
  });

  it("accepts an empty list but rejects an unreadable envelope", () => {
    expect(parseTaskList('{"tasks":[]}')).toEqual({ ok: true, tasks: [] });
    expect(parseTaskList('{"items":[]}').ok).toBe(false);
  });

  it("bounds oversized replies", () => {
    const tasks = Array.from({ length: 80 }, (_, index) => ({ id: `ENG-${index}`, title: `Task ${index}` }));
    const result = parseTaskList(JSON.stringify({ tasks }));
    expect(result.ok).toBe(true);
    expect(result.tasks).toHaveLength(50);
  });
});

describe("describePickedTask", () => {
  it("leads with the identifier, which is the part the user can check", () => {
    expect(describePickedTask({ id: "ENG-412", title: "Fix the parser" }, { source: "Linear" })).toBe(
      "Your latest Linear item is ENG-412, Fix the parser.",
    );
  });

  it("still says something useful when the tracker gave no id", () => {
    expect(describePickedTask({ title: "Fix the parser" }, { source: "Jira" })).toBe(
      "Your latest Jira item is Fix the parser.",
    );
  });
});
