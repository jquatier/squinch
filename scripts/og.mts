// Generates apps/spa/public/og.png — the 1200×630 card social previews show.
//
//   npx tsx scripts/og.mts
//
// Generated rather than exported from a design tool for the same reason the
// layered mark is: the artwork is lifted verbatim from docs/assets/mark-stack.svg
// (which is itself lifted from mark.svg), so the card cannot drift from the
// brand, and the type is set exactly as the landing sets it — the wordmark in
// Inter 600 at -0.045em, and under it the two lines of the site's eyebrow in
// IBM Plex Mono 600, tracked 0.12em and uppercased, the second in the accent —
// from the repo's own bundled faces, rasterised by the same resvg the CLI
// uses, with system fonts off, so the result is identical on every machine.
//
// The card is the landing's h1 (.hero-brand in apps/spa/src/site.css) at three
// times the size, and nothing else: mark beside a column of wordmark and
// category, the row's height set by the mark. The numbers below are that
// stylesheet's, scaled — change them there first.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// resvg is the CLI's dependency, not the root's; subset-font and the Plex
// Mono source face are core's (scripts/gen-fonts.ts bundles the 400 weight
// for the renderer — the eyebrow is the site's 600, so it is cut here from
// the same source package, the same way).
const cliRequire = createRequire(join(root, "packages/cli/package.json"));
const coreRequire = createRequire(join(root, "packages/core/package.json"));
const { Resvg } = cliRequire("@resvg/resvg-js");
const subsetFont = coreRequire("subset-font") as (
  font: Buffer,
  text: string,
  options: { targetFormat: "sfnt" },
) => Promise<Buffer>;
const fontkit = coreRequire("fontkit") as { create(buffer: Buffer): { familyName: string } };

// resvg matches `font-family` against the face's own family name, and a
// single-weight file names its weight: the bundled Inter 600 is "Inter
// SemiBold", the Plex Mono 600 "IBM Plex Mono SemiBold". Asking for "Inter"
// used to work only because it was the one face loaded and resvg fell back to
// it; with two faces loaded, both texts fell back to the same one and the
// eyebrow rendered in Inter. So the names are read from the files, never typed.
const familyOf = (buffer: Buffer) => fontkit.create(buffer).familyName;

const W = 1200;
const H = 630;
const SCALE = 3;
const BG = "#141416"; // --chrome, dark
const FG = "#EDEDEA"; // --fg, dark
const MUTED = "#9C9B94"; // --muted, dark
const ACCENT = "#8B88E8"; // --accent, dark

const NAME = "squinch";
const EYEBROW = ["architecture diagrams as code", "for coding agents"]; // .cat, as on the landing

// .hero-brand: mark 128px beside a column, gap 16px.
const MARK_H = 128 * SCALE;
const MARK_W = Math.round((MARK_H * 460) / 532); // the SVG's viewBox aspect
const GAP = 16 * SCALE;
// .hero-brand .name: 40px Inter 600, -0.045em, line-height 1.
const NAME_SIZE = 40 * SCALE;
const NAME_TRACKING = -0.045 * NAME_SIZE;
// .lockup-text: column gap 10px.
const COL_GAP = 10 * SCALE;
// .eyebrow: 10.5px/1.4 IBM Plex Mono 600, 0.12em, uppercase.
const EYE_SIZE = 10.5 * SCALE;
const EYE_LINE = 1.4 * EYE_SIZE;
const EYE_TRACKING = 0.12 * EYE_SIZE;

// Widths, for centring the lockup as one piece. Inter 600 "squinch" measures
// ~3.52em at -0.045em; Plex Mono is 0.6em per glyph, plus the tracking after
// each one, as CSS letter-spacing does it.
const nameW = 3.52 * NAME_SIZE;
const eyeW = Math.max(...EYEBROW.map((l) => l.length)) * (0.6 * EYE_SIZE + EYE_TRACKING);
const textW = Math.round(Math.max(nameW, eyeW));

const total = MARK_W + GAP + textW;
const left = Math.round((W - total) / 2);
const markY = Math.round((H - MARK_H) / 2);
const textX = left + MARK_W + GAP;

// The column is shorter than the mark, so it centres against it (align-items:
// center). Baselines follow CSS line boxes: half-leading above the ascender,
// with each face's own ascent/descent — Inter 0.969/0.242, Plex Mono 1.025/0.275.
const colH = NAME_SIZE + COL_GAP + EYEBROW.length * EYE_LINE;
const colTop = (H - colH) / 2;
const nameBaseline = colTop + ((1 - (0.969 + 0.242)) / 2 + 0.969) * NAME_SIZE;
const eyeTop = colTop + NAME_SIZE + COL_GAP;
const eyeBaseline = (i: number) =>
  eyeTop + i * EYE_LINE + ((1.4 - (1.025 + 0.275)) / 2 + 1.025) * EYE_SIZE;

// resvg reads sfnt, not woff2 (linebender/resvg#541), so the eyebrow's face is
// cut from core's @fontsource package to a temp file for the one render —
// exactly what gen-fonts does for the faces the renderer bundles.
const inter600Path = join(root, "packages/core/fonts/inter-600.ttf");
const inter600 = readFileSync(inter600Path);
const mono600 = await subsetFont(
  readFileSync(
    coreRequire.resolve("@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2"),
  ),
  EYEBROW.join("").toUpperCase(),
  { targetFormat: "sfnt" },
);
const NAME_FAMILY = familyOf(inter600);
const EYE_FAMILY = familyOf(mono600);

const mark = readFileSync(join(root, "docs/assets/mark-stack.svg"), "utf8")
  .replace(/^<\?xml[^>]*\?>\s*/, "")
  // position the nested svg; its own viewBox does the scaling
  .replace("<svg ", `<svg x="${left}" y="${markY}" width="${MARK_W}" height="${MARK_H}" `);

const r = (n: number) => Math.round(n * 100) / 100;
const eyebrow = EYEBROW.map(
  (line, i) =>
    `<text x="${textX}" y="${r(eyeBaseline(i))}" font-family="${EYE_FAMILY}" font-weight="600" ` +
    `font-size="${EYE_SIZE}" letter-spacing="${r(EYE_TRACKING)}" fill="${i === EYEBROW.length - 1 ? ACCENT : MUTED}">` +
    `${line.toUpperCase()}</text>`,
).join("\n  ");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${BG}"/>
  ${mark}
  <text x="${textX}" y="${r(nameBaseline)}" font-family="${NAME_FAMILY}" font-weight="600" font-size="${NAME_SIZE}" letter-spacing="${r(NAME_TRACKING)}" fill="${FG}">${NAME}</text>
  ${eyebrow}
</svg>`;

const tmp = mkdtempSync(join(tmpdir(), "squinch-og-"));
const mono600Path = join(tmp, "plex-mono-600.ttf");
writeFileSync(mono600Path, mono600);

const png = new Resvg(svg, {
  fitTo: { mode: "width", value: W },
  font: {
    loadSystemFonts: false,
    fontFiles: [inter600Path, mono600Path],
    defaultFontFamily: NAME_FAMILY,
  },
}).render().asPng();
rmSync(tmp, { recursive: true, force: true });

const dest = join(root, "apps/spa/public/og.png");
writeFileSync(dest, png);
console.log(`wrote ${dest} — ${png.length} bytes`);
