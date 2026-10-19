import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { prForBranch, prsForProject } = require("./prs.cjs");

const answering = (stdout: string, calls: string[][] = []) => async (cmd: string, args: string[]) => {
  calls.push([cmd, ...args]);
  return stdout;
};

describe("pull request lookup", () => {
  it("an open GitHub PR is found for the branch", async () => {
    const calls: string[][] = [];
    const pr = await prForBranch({ cwd: "/s", branch: "feature/SHOP-1-x", kind: "github", env: { GH_TOKEN: "t" }, exec: answering('[{"url":"https://github.com/o/r/pull/7","state":"OPEN"}]', calls) });
    expect(pr).toEqual({ url: "https://github.com/o/r/pull/7", state: "open" });
    expect(calls[0]).toEqual(["gh", "pr", "list", "--head", "feature/SHOP-1-x", "--state", "all", "--json", "url,state", "--limit", "1"]);
  });

  it("merged and closed map to their states, and none is null", async () => {
    expect(await prForBranch({ cwd: "/s", branch: "b", kind: "github", exec: answering('[{"url":"u","state":"MERGED"}]') })).toEqual({ url: "u", state: "merged" });
    expect(await prForBranch({ cwd: "/s", branch: "b", kind: "github", exec: answering('[{"url":"u","state":"CLOSED"}]') })).toEqual({ url: "u", state: "closed" });
    expect(await prForBranch({ cwd: "/s", branch: "b", kind: "github", exec: answering("[]") })).toBeNull();
  });

  it("GitLab uses glab and reads its JSON", async () => {
    const calls: string[][] = [];
    const pr = await prForBranch({ cwd: "/s", branch: "b", kind: "gitlab", exec: answering('[{"web_url":"https://gitlab.com/g/p/-/merge_requests/3","state":"merged"}]', calls) });
    expect(pr).toEqual({ url: "https://gitlab.com/g/p/-/merge_requests/3", state: "merged" });
    expect(calls[0]).toEqual(["glab", "mr", "list", "--source-branch", "b", "--all", "-F", "json"]);
  });

  it("no gh or glab is an error, not a crash", async () => {
    const exec = async () => { throw Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" }); };
    expect(await prForBranch({ cwd: "/s", branch: "b", kind: "github", exec })).toEqual({ error: "gh is not installed" });
  });

  it("one listing per project maps every branch to its PR", async () => {
    const calls: string[][] = [];
    const map = await prsForProject({ cwd: "/s", kind: "github", exec: answering('[{"headRefName":"a","url":"ua","state":"OPEN"},{"headRefName":"b","url":"ub","state":"MERGED"}]', calls) });
    expect(calls).toEqual([["gh", "pr", "list", "--state", "all", "--json", "headRefName,url,state", "--limit", "100"]]);
    expect(map.get("a")).toEqual({ url: "ua", state: "open" });
    expect(map.get("b")).toEqual({ url: "ub", state: "merged" });
  });

  it("GitLab's listing reads source_branch", async () => {
    const map = await prsForProject({ cwd: "/s", kind: "gitlab", exec: answering('[{"source_branch":"a","web_url":"ua","state":"opened"}]') });
    expect(map.get("a")).toEqual({ url: "ua", state: "open" });
  });
});
