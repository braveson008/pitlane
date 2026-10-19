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
    });
    expect((await findReviewRequests({ cwd: "/repo", kind: "github", exec })).tasks[0].pr.trusted).toBe(false);
  });
});
