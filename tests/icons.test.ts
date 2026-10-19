import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const build = path.join(process.cwd(), "build");
const ALLOWED = new Set(["#07080b", "#fcee0a", "#ff2a6d", "#05d9e8", "#000000", "none"]);

describe("the Corpo tag icon", () => {
  for (const name of ["icon.svg", "icon-64.svg", "icon-32.svg", "trayTemplate.svg"]) {
    it(`${name} is paths only, in the spec's colours`, () => {
      const svg = fs.readFileSync(path.join(build, name), "utf8");
      expect(svg).not.toMatch(/<text|font-family/);
      const colours = [...svg.matchAll(/(?:fill|stroke)="([^"]+)"/g)].map((match) => match[1].toLowerCase());
      expect(colours.length).toBeGreaterThan(0);
      for (const colour of colours) expect(ALLOWED.has(colour), `${name}: ${colour}`).toBe(true);
    });
  }

  it("icon.png is 1024 square and icon.icns exists", () => {
    const png = fs.readFileSync(path.join(build, "icon.png"));
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(1024);
    expect(png.readUInt32BE(20)).toBe(1024);
    expect(fs.statSync(path.join(build, "icon.icns")).size).toBeGreaterThan(10_000);
  });
});
