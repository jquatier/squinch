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

// The repertoire every label can draw from — and the subset gen-fonts ships,
// which is the part that bites: `measure` falls back to an average advance for
// an unknown character, so layout stays sane, but the *glyph* is simply not in
// the embedded face and the character renders as nothing at all.
//
// A committed lookbook title read "Payments — money path" and drew "Payments
// money path" for as long as the em dash has been outside this string. So the
// list covers the punctuation people actually type into a title: dashes,
// curly quotes an editor substitutes on its own, an arrow, a bullet. The
// renderer's own ·, × and … are here too. Anything still outside it is caught
// at check time rather than dropped in silence (model/build.ts).
const REPERTOIRE =
  "0123456789 !\"#$%&'()*+,-./:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`" +
  "abcdefghijklmnopqrstuvwxyz{|}~·×…" +
  "—–‘’“”→←↔•§©®™°±≈≥≤";

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
