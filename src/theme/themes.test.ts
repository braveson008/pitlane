import { describe, expect, it } from "vitest";
import { THEME_LABEL, THEME_ORDER, nextTheme, themeFor, xtermTheme } from "./themes";

const ANSI = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan", "brightWhite"] as const;
const COLOUR = /^(#[0-9a-f]{6}|rgba\([^)]+\))$/i;

describe("themes", () => {
  it("nextTheme cycles through all five and wraps", () => {
    expect(THEME_ORDER).toEqual(["github-dark", "nord", "one-dark", "dracula", "tokyo-night"]);
    expect(nextTheme("github-dark")).toBe("nord");
    expect(nextTheme("tokyo-night")).toBe("github-dark");
    expect(THEME_LABEL).toEqual({ "github-dark": "GitHub Dark", nord: "Nord", "one-dark": "Atom One Dark", dracula: "Dracula", "tokyo-night": "Tokyo Night" });
  });

  it("themeFor prefers the project, then the default, then GitHub Dark", () => {
    expect(themeFor({ theme: "nord" }, { defaultTheme: "dracula" })).toBe("nord");
    expect(themeFor({}, { defaultTheme: "dracula" })).toBe("dracula");
    expect(themeFor(undefined, undefined)).toBe("github-dark");
  });

  it("a theme saved by an earlier version that is gone now falls back to the next choice", () => {
    expect(themeFor({ theme: "night-city" as never }, { defaultTheme: "nord" })).toBe("nord");
    expect(themeFor({ theme: "vt220" as never }, { defaultTheme: "acme" as never })).toBe("github-dark");
  });

  it("xtermTheme sets every ANSI colour for every theme", () => {
    for (const id of THEME_ORDER) {
      const theme = xtermTheme(id);
      for (const key of [...ANSI, "background", "foreground", "cursor", "selectionBackground"] as const) {
        expect(theme[key], `${id}.${key}`).toMatch(COLOUR);
      }
    }
  });

  it("each theme uses its own well-known background", () => {
    expect(xtermTheme("github-dark").background).toBe("#0d1117");
    expect(xtermTheme("nord").background).toBe("#2e3440");
    expect(xtermTheme("one-dark").background).toBe("#282c34");
    expect(xtermTheme("dracula").background).toBe("#282a36");
    expect(xtermTheme("tokyo-night").background).toBe("#1a1b26");
  });
});
