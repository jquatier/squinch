// Build-time only: extracts per-codepoint advance widths from the bundled Inter
// fonts into metrics.json. Layout code reads ONLY metrics.json — never a font, never
// the environment. Run: npx tsx scripts/gen-metrics.ts
import fontkit from "fontkit";
import { writeFileSync } from "node:fs";

const WEIGHTS = ["400", "500"] as const;
const out: Record<string, { advances: Record<string, number>; fallback: number }> = {};

for (const w of WEIGHTS) {
  const font = fontkit.openSync(
    `node_modules/@fontsource/inter/files/inter-latin-${w}-normal.woff2`,
  ) as any;
  const upem = font.unitsPerEm;
  const advances: Record<string, number> = {};
  // Printable ASCII + a few label-common extras.
  const extras = "→·×①②③…";
  const chars =
    Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join("") + extras;
  for (const ch of chars) {
    const cp = ch.codePointAt(0)!;
    if (!font.hasGlyphForCodePoint(cp)) continue;
    // 6 decimals, em-normalized: stable, platform-independent.
    advances[ch] = Number((font.glyphForCodePoint(cp).advanceWidth / upem).toFixed(6));
  }
  const vals = Object.values(advances);
  out[w] = {
    advances,
    fallback: Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(6)),
  };
}

writeFileSync("metrics.json", JSON.stringify(out, null, 1) + "\n");
console.log(
  "metrics.json written:",
  Object.entries(out).map(([w, m]) => `${w}: ${Object.keys(m.advances).length} chars`).join(", "),
);
