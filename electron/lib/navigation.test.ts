import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { isAppUrl, externalUrl, quotePath } = require("./navigation.cjs");

const APP = "file:///Applications/Pitlane.app/Contents/Resources/app/dist/index.html";

describe("navigation guard", () => {
  it("only the app's own page counts as the app", () => {
    expect(isAppUrl(`${APP}?project=abc`, APP)).toBe(true);
    expect(isAppUrl("http://127.0.0.1:5274/?project=abc", "http://127.0.0.1:5274/")).toBe(true);
    expect(isAppUrl("file:///Users/me/Downloads/evil.html", APP)).toBe(false);
    expect(isAppUrl("https://example.com/", APP)).toBe(false);
  });

  it("opens only web links outside the app", () => {
    expect(externalUrl("https://github.com/x/y/pull/1")).toBe("https://github.com/x/y/pull/1");
    expect(externalUrl("http://localhost:3000/")).toBe("http://localhost:3000/");
    expect(externalUrl("file:///etc/passwd")).toBeNull();
    expect(externalUrl("javascript:alert(1)")).toBeNull();
    expect(externalUrl("not a url")).toBeNull();
  });

  it("quotes a dropped path for the shell", () => {
    expect(quotePath("/Users/me/My Shots/a.png")).toBe("'/Users/me/My Shots/a.png'");
    expect(quotePath("/tmp/it's.txt")).toBe("'/tmp/it'\\''s.txt'");
  });
});
