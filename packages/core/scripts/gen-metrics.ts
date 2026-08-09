// Reads per-character advance widths from the bundled faces with fontkit and
// writes metrics.json. Layout measures text against this committed table and
// never asks the environment (non-negotiable).
//
// Families: inter (light/dark themes), caveat (sketch themes — hand-lettered).
//
// Run: npm run gen-metrics   (regenerates metrics.json AND the TS module)
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const fontkit = require("fontkit");

// The repertoire every theme/label can draw from. Anything outside falls back
// to `fallback` (average advance) in measure() — keep this in sync with what
// the renderer actually emits (esc() keeps arbitrary text, but labels are
// overwhelmingly ASCII; ·, × and … are used by the renderer itself).
const REPERTOIRE =
  "0123456789 !\"#$%&'()*+,-./:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`" +
  "abcdefghijklmnopqrstuvwxyz{|}~·×…";

const FAMILIES: Record<string, string> = {
  inter: "@fontsource/inter/files/inter-latin-WEIGHT-normal.woff2",
};

const table: Record<string, Record<string, { advances: Record<string, number>; fallback: number }>> = {};
for (const [family, pattern] of Object.entries(FAMILIES)) {
  table[family] = {};
  for (const weight of ["400", "500"]) {
    const font = fontkit.openSync(require.resolve(pattern.replace("WEIGHT", weight)));
    const advances: Record<string, number> = {};
    let sum = 0;
    for (const ch of REPERTOIRE) {
      const glyph = font.glyphForCodePoint(ch.codePointAt(0)!);
      const em = glyph.advanceWidth / font.unitsPerEm;
      advances[ch] = Math.round(em * 1e6) / 1e6;
      sum += advances[ch];
    }
    table[family][weight] = {
      advances,
      fallback: Math.round((sum / REPERTOIRE.length) * 1e6) / 1e6,
    };
  }
}

writeFileSync("metrics.json", JSON.stringify(table, null, 1) + "\n");
console.log("wrote metrics.json:", Object.keys(table).join(", "));
