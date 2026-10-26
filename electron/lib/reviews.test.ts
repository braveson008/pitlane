import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { findReviewRequests, repoSlug } = require("./reviews.cjs");

const answering = (answers: Record<string, string>, calls: string[][] = []) => async (cmd: string, args: string[]) => {
  calls.push([cmd, ...args]);
  const key = Object.keys(answers).find((prefix) => [cmd, ...args].join(" ").startsWith(prefix));
  if (!key) throw new Error(`unexpected ${cmd} ${args.join(" ")}`);
  return answers[key];
};

describe("review requests", () => {
  it("review requests are found with gh search for this repository", async () => {
    const calls: string[][] = [];
    const exec = answering({
      "git remote get-url origin": "git@github.com:acme/shop.git\n",
      "gh search prs": JSON.stringify([{ number: 42, title: "Add cart badge", url: "https://github.com/acme/shop/pull/42", author: { login: "teammate" }, authorAssociation: "MEMBER" }]),
      "gh pr list": "[]",
    }, calls);
    const result = await findReviewRequests({ cwd: "/repo", kind: "github", exec });
    // Only fields `gh search prs` has: it rejects headRefName outright.
    expect(calls[1]).toEqual(["gh", "search", "prs", "--review-requested=@me", "--state=open", "--repo", "acme/shop", "--json", "number,title,url,author,authorAssociation", "--limit", "30"]);
    expect(result).toEqual({ ok: true, tasks: [{ id: "review:42", title: "Add cart badge", url: "https://github.com/acme/shop/pull/42", description: "", status: "", group: "", updatedAt: "", pr: { number: 42, author: "teammate", trusted: true } }] });
  });

  it("GitLab reviewer requests use glab", async () => {
    const calls: string[][] = [];
    const exec = answering({
      "git remote get-url origin": "https://gitlab.com/acme/web/storefront.git\n",
      "glab mr list": JSON.stringify([{ iid: 7, title: "Fix menu", web_url: "https://gitlab.com/acme/web/storefront/-/merge_requests/7", source_branch: "fix/menu", author: { username: "teammate" } }]),
    }, calls);
    const result = await findReviewRequests({ cwd: "/repo", kind: "gitlab", exec });
    expect(calls[1]).toEqual(["glab", "mr", "list", "--reviewer=@me", "-F", "json"]);
    expect(result.tasks[0]).toMatchObject({ id: "review:7", pr: { number: 7, author: "teammate", trusted: true } });
  });

  it("the owner's own open PRs are found too, once each, and not on a branch a ticket owns", async () => {
    const calls: string[][] = [];
    const exec = answering({
      "git remote get-url origin": "git@github.com:acme/shop.git\n",
      "gh search prs": JSON.stringify([{ number: 42, title: "Asked of me", url: "u42", author: { login: "teammate" }, authorAssociation: "MEMBER" }]),
      "gh pr list": JSON.stringify([
        { number: 42, title: "Asked of me", url: "u42", author: { login: "me" }, headRefName: "x" },
        { number: 50, title: "My change", url: "u50", author: { login: "me" }, headRefName: "my-change" },
        { number: 51, title: "Ticket PR", url: "u51", author: { login: "me" }, headRefName: "shop-1-thing" },
      ]),
    }, calls);
    const result = await findReviewRequests({ cwd: "/repo", kind: "github", exec, skipBranches: new Set(["shop-1-thing"]) });
    expect(calls[2]).toEqual(["gh", "pr", "list", "--author", "@me", "--state", "open", "--repo", "acme/shop", "--json", "number,title,url,author,headRefName", "--limit", "30"]);
    expect(result.tasks.map((task: { id: string; pr: { own: boolean } }) => [task.id, Boolean(task.pr.own)])).toEqual([["review:42", false], ["review:50", true]]);
    expect(result.tasks[1].pr).toEqual({ number: 50, author: "me", trusted: true, own: true, head: "my-change" });
  });

  it("GitLab finds the owner's own merge requests with glab", async () => {
    const calls: string[][] = [];
    const exec = answering({
      "git remote get-url origin": "https://gitlab.com/acme/web.git\n",
      "glab mr list --reviewer": "[]",
      "glab mr list --author": JSON.stringify([{ iid: 9, title: "Mine", web_url: "w9", source_branch: "mine", author: { username: "me" } }]),
    }, calls);
    const result = await findReviewRequests({ cwd: "/repo", kind: "gitlab", exec });
    expect(calls[2]).toEqual(["glab", "mr", "list", "--author=@me", "-F", "json"]);
    expect(result.tasks[0]).toMatchObject({ id: "review:9", pr: { number: 9, own: true, head: "mine" } });
  });

  it("a failure is an error, not an empty list", async () => {
    const exec = async () => { throw new Error("gh: not logged in"); };
    expect(await findReviewRequests({ cwd: "/repo", kind: "github", exec })).toEqual({ ok: false, error: "gh: not logged in" });
  });

  it("repoSlug reads ssh and https remotes", () => {
    expect(repoSlug("git@github.com:acme/shop.git")).toBe("acme/shop");
    expect(repoSlug("https://github.com/acme/shop")).toBe("acme/shop");
  });

  it("a PR from outside the team is not trusted to start unattended", async () => {
    const exec = answering({
      "git remote get-url origin": "git@github.com:acme/shop.git\n",
      "gh search prs": JSON.stringify([{ number: 5, title: "Drive-by", url: "u", author: { login: "stranger" }, authorAssociation: "CONTRIBUTOR" }]),
      "gh pr list": "[]",
    });
    expect((await findReviewRequests({ cwd: "/repo", kind: "github", exec })).tasks[0].pr.trusted).toBe(false);
  });
});
