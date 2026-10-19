import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { credentialEnv, reviewerEnv } = require("./credentials.cjs");

const tokenFor = (calls: string[][]) => async (cmd: string, args: string[]) => {
  calls.push([cmd, ...args]);
  return "tok_123\n";
};

describe("per-project credentials", () => {
  it("GitHub projects get GH_TOKEN and a scoped credential helper", async () => {
    const calls: string[][] = [];
    const { env, warning } = await credentialEnv({ github: { host: "github.com", kind: "github", login: "work-account" } }, { exec: tokenFor(calls) });
    expect(calls).toEqual([["gh", "auth", "token", "--hostname", "github.com", "--user", "work-account"]]);
    expect(warning).toBeUndefined();
    // The empty first helper clears the list, so the system keychain helper can neither win nor store the token.
    expect(env).toEqual({
      GH_TOKEN: "tok_123",
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "credential.https://github.com.helper",
      GIT_CONFIG_VALUE_0: "",
      GIT_CONFIG_KEY_1: "credential.https://github.com.helper",
      GIT_CONFIG_VALUE_1: "!f(){ echo username=x-access-token; echo password=$GH_TOKEN; }; f",
    });
  });

  it("GitLab projects get GITLAB_TOKEN with oauth2", async () => {
    const { env } = await credentialEnv({ github: { host: "gitlab.com", kind: "gitlab", login: "someone" } }, { exec: tokenFor([]) });
    expect(env.GITLAB_TOKEN).toBe("tok_123");
    expect(env.GH_TOKEN).toBeUndefined();
    expect(env.GIT_CONFIG_VALUE_0).toBe("");
    expect(env.GIT_CONFIG_KEY_1).toBe("credential.https://gitlab.com.helper");
    expect(env.GIT_CONFIG_VALUE_1).toBe("!f(){ echo username=oauth2; echo password=$GITLAB_TOKEN; }; f");
  });

  it("a missing gh gives a warning, not an error", async () => {
    const exec = async () => { throw Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" }); };
    expect(await credentialEnv({ github: { host: "github.com", kind: "github", login: "x" } }, { exec })).toEqual({ env: {}, warning: "no GitHub login" });
  });

  it("a project without a login adds nothing", async () => {
    const calls: string[][] = [];
    expect(await credentialEnv({}, { exec: tokenFor(calls) })).toEqual({ env: {} });
    expect(calls).toEqual([]);
  });

  it("a project that needs a sign-in says so", async () => {
    expect(await credentialEnv({ signInNeeded: true }, { exec: tokenFor([]) })).toEqual({ env: {}, warning: "no GitHub login" });
  });

  it("git answers with the project's token even when another helper is configured", async () => {
    const { execFileSync } = await import("node:child_process");
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pitlane-cred-"));
    const global = path.join(dir, "gitconfig");
    // Stands in for the macOS keychain helper that git asks first.
    fs.writeFileSync(global, '[credential]\n\thelper = "!f(){ echo username=personal; echo password=from-keychain; }; f"\n');
    const { env } = await credentialEnv({ github: { host: "example.com", kind: "github", login: "x" } }, { exec: tokenFor([]) });
    const answer = execFileSync("git", ["credential", "fill"], {
      input: "protocol=https\nhost=example.com\n\n",
      env: { ...process.env, GIT_CONFIG_GLOBAL: global, GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", ...env },
      encoding: "utf8",
    });
    fs.rmSync(dir, { recursive: true, force: true });
    expect(answer).toContain("password=tok_123");
    expect(answer).not.toContain("from-keychain");
  });

  it("a review agent gets no host credentials and cannot push", async () => {
    const { execFileSync } = await import("node:child_process");
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "pitlane-reviewer-"));
    const env = reviewerEnv({ emptyDir: empty });
    expect(env).toMatchObject({ GH_TOKEN: "", GITHUB_TOKEN: "", GITLAB_TOKEN: "", GH_CONFIG_DIR: empty, GLAB_CONFIG_DIR: empty, GIT_SSH_COMMAND: "false", GIT_TERMINAL_PROMPT: "0" });
    // The last value wins for pushurl, and an empty last helper empties the helper list.
    const last = (key: string) => execFileSync("git", ["config", "--get", key], { env: { ...process.env, ...env }, encoding: "utf8" }).replace(/\n$/, "");
    expect(last("remote.origin.pushurl")).toBe("disabled://pitlane-review");
    expect(last("credential.helper")).toBe("");
    fs.rmSync(empty, { recursive: true, force: true });
  });
});
