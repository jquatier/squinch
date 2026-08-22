// Generates apps/spa/public/og.png — the 1200×630 card social previews show.
//
//   npx tsx scripts/og.mts
//
// Generated rather than exported from a design tool for the same reason the
// layered mark is: the artwork is lifted verbatim from docs/assets/mark-stack.svg
// (which is itself lifted from mark.svg), so the card cannot drift from the
// brand, and the wordmark is set in the same Inter 600 at -0.045em the landing
// page sets it in — from the repo's own bundled face, rasterised by the same
// resvg the CLI uses, with system fonts off, so the result is identical on
// every machine. No tagline: the card is the lockup, nothing else.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// resvg is the CLI's dependency, not the root's
const { Resvg } = createRequire(join(root, "packages/cli/package.json"))("@resvg/resvg-js");

const W = 1200;
const H = 630;
const BG = "#141416"; // --chrome, dark
const FG = "#EDEDEA"; // --fg, dark

// The lockup, as on the landing: mark beside wordmark, the row's height set by
// the mark. Proportions follow site.css (.hero-brand): mark 128px to a 40px
// wordmark, gap 16px — scaled ×3 here.
const MARK_H = 384;
const MARK_W = Math.round((MARK_H * 460) / 532); // the SVG's viewBox aspect
const GAP = 48;
const FONT_SIZE = 120;
const TRACKING = -0.045 * FONT_SIZE;
// Inter 600 "squinch" measures ~3.52em at -0.045em; good enough to centre on
const TEXT_W = Math.round(3.52 * FONT_SIZE);

const total = MARK_W + GAP + TEXT_W;
const left = Math.round((W - total) / 2);
const markY = Math.round((H - MARK_H) / 2);
const textX = left + MARK_W + GAP;
// cap height of Inter is ~0.727em; put the caps' centre on the card's centre
const baseline = Math.round(H / 2 + (0.727 * FONT_SIZE) / 2);

const mark = readFileSync(join(root, "docs/assets/mark-stack.svg"), "utf8")
  .replace(/^<\?xml[^>]*\?>\s*/, "")
  // position the nested svg; its own viewBox does the scaling
  .replace("<svg ", `<svg x="${left}" y="${markY}" width="${MARK_W}" height="${MARK_H}" `);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${BG}"/>
  ${mark}
  <text x="${textX}" y="${baseline}" font-family="Inter" font-weight="600" font-size="${FONT_SIZE}" letter-spacing="${TRACKING}" fill="${FG}">squinch</text>
</svg>`;

const png = new Resvg(svg, {
  fitTo: { mode: "width", value: W },
  font: {
    loadSystemFonts: false,
    fontFiles: [join(root, "packages/core/fonts/inter-600.ttf")],
    defaultFontFamily: "Inter",
  },
}).render().asPng();

const dest = join(root, "apps/spa/public/og.png");
writeFileSync(dest, png);
console.log(`wrote ${dest} — ${png.length} bytes`);
