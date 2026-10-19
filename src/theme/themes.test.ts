import { describe, expect, it } from "vitest";
import { THEME_LABEL, THEME_ORDER, nextTheme, themeFor, xtermTheme } from "./themes";

const ANSI = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan", "brightWhite"] as const;
const COLOUR = /^(#[0-9a-f]{6}|rgba\([^)]+\))$/i;

describe("themes", () => {
  it("nextTheme cycles through all seven and wraps", () => {
    expect(THEME_ORDER).toEqual(["vt220", "acme", "night-city", "green-screen", "daylight", "synthwave", "midnight"]);
    expect(nextTheme("vt220")).toBe("acme");
    expect(nextTheme("night-city")).toBe("green-screen");
    expect(nextTheme("midnight")).toBe("vt220");
    for (const id of THEME_ORDER) expect(THEME_LABEL[id]).toBeTruthy();
  });

  it("light themes keep white text readable on paper", () => {
    for (const id of ["acme", "daylight"] as const) {
      expect(xtermTheme(id).white).not.toMatch(/^#f/i);
      expect(xtermTheme(id).brightWhite).not.toMatch(/^#f/i);
    }
  });

  it("themeFor prefers the project, then the default, then vt220", () => {
    expect(themeFor({ theme: "acme" }, { defaultTheme: "night-city" })).toBe("acme");
    expect(themeFor({}, { defaultTheme: "night-city" })).toBe("night-city");
    expect(themeFor(undefined, undefined)).toBe("vt220");
  });

  it("xtermTheme sets every ANSI colour for every theme", () => {
    for (const id of THEME_ORDER) {
      const theme = xtermTheme(id);
      for (const key of [...ANSI, "background", "foreground", "cursor", "selectionBackground"] as const) {
        expect(theme[key], `${id}.${key}`).toMatch(COLOUR);
      }
    }
  });

  it("night city selection is the flat cyan tint", () => {
    expect(xtermTheme("night-city").selectionBackground).toBe("rgba(5,217,232,.14)");
  });

  it("vt220 and acme use their paper and phosphor", () => {
    expect(xtermTheme("vt220").background).toBe("#0a0a08");
    expect(xtermTheme("acme").background).toBe("#ffffea");
    expect(xtermTheme("night-city").background).toBe("#07080b");
  });
});
