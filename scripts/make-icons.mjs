// Draws the Corpo tag icon as pure vector paths, renders it, and builds the .icns.
//   node scripts/make-icons.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const BLACK = "#07080b";
const YELLOW = "#fcee0a";
const RED = "#ff2a6d";
const CYAN = "#05d9e8";
const build = path.join(process.cwd(), "build");

// A 5×7 block font: lettering as rectangles, so the icon carries no font.
const GLYPHS = {
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "·": ["00000", "00000", "00000", "00100", "00000", "00000", "00000"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
};

/** Path data for `text` set in the block font at `(x, y)`, each pixel `size` across with a one-pixel gap between letters. */
function lettering(text, x, y, size) {
  let d = "";
  [...text].forEach((char, index) => {
    const rows = GLYPHS[char];
    if (!rows) throw new Error(`No glyph for ${char}`);
    const left = x + index * 6 * size;
    rows.forEach((row, r) => {
      [...row].forEach((bit, c) => {
        if (bit === "1") d += `M${left + c * size} ${y + r * size}h${size}v${size}h-${size}z`;
      });
    });
  });
  return d;
}

const PLATE = "96,96 800,96 928,224 928,928 224,928 96,800";
const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">${body}</svg>\n`;
const barcode = [0, 10, 22, 30, 52, 60, 76, 84, 100, 112, 120, 140, 150, 172, 180, 196]
  .map((offset, index) => `M${150 + offset * 1.4} 730h${index % 3 === 0 ? 16 : 8}v100h-${index % 3 === 0 ? 16 : 8}z`).join("");

const full = svg([
  `<defs><clipPath id="plate"><polygon points="${PLATE}"/></clipPath></defs>`,
  `<polygon points="${PLATE}" fill="${BLACK}"/>`,
  `<g clip-path="url(#plate)"><path d="M96 96h832v150h-832z" fill="${YELLOW}"/></g>`,
  `<path d="${lettering("PITLANE//", 150, 136, 10)}" fill="${BLACK}"/>`,
  `<path d="${lettering("PL", 172, 300, 52)}" fill="${RED}"/>`,
  `<path d="${lettering("PL", 196, 300, 52)}" fill="${CYAN}"/>`,
  `<path d="${lettering("PL", 184, 300, 52)}" fill="${YELLOW}"/>`,
  `<path d="${barcode}" fill="${YELLOW}"/>`,
  `<path d="${lettering("NC-2077 · 01", 480, 763, 5)}" fill="${CYAN}"/>`,
  `<polygon points="${PLATE}" fill="none" stroke="${YELLOW}" stroke-width="20"/>`,
].join(""));

// Small sizes keep only what still reads: the band and PL at 64 px, a yellow plate with a black PL below that.
const medium = svg([
  `<defs><clipPath id="plate"><polygon points="${PLATE}"/></clipPath></defs>`,
  `<polygon points="${PLATE}" fill="${BLACK}"/>`,
  `<g clip-path="url(#plate)"><path d="M96 96h832v170h-832z" fill="${YELLOW}"/></g>`,
  `<path d="${lettering("PL", 160, 360, 44)}" fill="${YELLOW}"/>`,
  `<polygon points="${PLATE}" fill="none" stroke="${YELLOW}" stroke-width="36"/>`,
].join(""));

const small = svg([
  `<polygon points="${PLATE}" fill="${YELLOW}"/>`,
  `<path d="${lettering("PL", 170, 300, 56)}" fill="${BLACK}"/>`,
].join(""));

const tray = svg(`<path d="${lettering("PL", 170, 300, 56)}" fill="#000000"/>`);

fs.mkdirSync(build, { recursive: true });
for (const [name, content] of [["icon.svg", full], ["icon-64.svg", medium], ["icon-32.svg", small], ["trayTemplate.svg", tray]]) {
  fs.writeFileSync(path.join(build, name), content);
}

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
async function render(svgText, size, file) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svgText.replace('width="1024" height="1024"', `width="${size}" height="${size}"`)}</body></html>`);
  await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

await render(full, 1024, path.join(build, "icon.png"));
await render(tray, 22, path.join(build, "trayTemplate.png"));
await render(tray, 44, path.join(build, "trayTemplate@2x.png"));

const iconset = fs.mkdtempSync(path.join(os.tmpdir(), "pitlane-iconset-")) + "/Pitlane.iconset";
fs.mkdirSync(iconset);
for (const base of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) {
    const size = base * scale;
    const art = size <= 32 ? small : size <= 64 ? medium : full;
    await render(art, size, path.join(iconset, `icon_${base}x${base}${scale === 2 ? "@2x" : ""}.png`));
  }
}
await browser.close();
execFileSync("iconutil", ["-c", "icns", iconset, "-o", path.join(build, "icon.icns")]);
fs.rmSync(path.dirname(iconset), { recursive: true, force: true });
console.log("icons written to build/");
