// Reads per-character advance widths from the bundled faces with fontkit and
// writes metrics.json. Layout measures text against this committed table and
// never asks the environment (non-negotiable).
//
// Families and weights are declared here and everything downstream follows:
// gen-fonts subsets exactly what this table holds, and the FONTS type is
// derived from it. Adding a weight is a one-line edit plus two regenerations.
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

// 600 is the title block's display weight; mono 400 sets the chip segments that
// have to line up digit-for-digit (a commit hash, a CIDR block).
const FAMILIES: Record<string, { pattern: string; weights: string[] }> = {
  inter: {
    pattern: "@fontsource/inter/files/inter-latin-WEIGHT-normal.woff2",
    weights: ["400", "500", "600"],
  },
  mono: {
    pattern: "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-WEIGHT-normal.woff2",
    weights: ["400"],
  },
};

const table: Record<string, Record<string, { advances: Record<string, number>; fallback: number }>> = {};
for (const [family, { pattern, weights }] of Object.entries(FAMILIES)) {
  table[family] = {};
  for (const weight of weights) {
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
