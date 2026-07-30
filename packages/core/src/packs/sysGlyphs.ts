// First-party glyph artwork for the `builtin` pseudo-pack: `person` and `box`,
// drawn as 24×24 monoline strokes with round caps/joins. Both paint with
// currentColor so themes tint them natively — muted on card badges, plate-text
// white on icon plates, ink in sketch.
//
// These two stay compiled into core because they are language sugar, not an icon
// choice: `person x "…"` and `= box` desugar to them, so they must resolve with
// nothing installed. The far larger `sys/*` set moved out to @squinch/pack-sys
// (Lucide, ISC) — 142 icons is more than belongs in an isomorphic bundle, and
// vendoring gives one coherent hand instead of one person's.

const S = `fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"`;
const F = `fill="currentColor" stroke="none"`;

const g = (inner: string) => `<g ${S}>${inner}</g>`;

export const SYS_GLYPH_ART: Record<string, Record<string, string>> = {
  builtin: {
    person: g(
      `<circle cx="12" cy="8" r="3.75"/><path d="M5 20c0-4.1 3.1-6.5 7-6.5s7 2.4 7 6.5"/>`,
    ),
    box: g(
      `<path d="M12 3.5 20 7.75v8.5L12 20.5 4 16.25v-8.5Z"/>` +
        `<path d="M4 7.75 12 12l8-4.25"/><path d="M12 12v8.5"/>`,
    ),
  },
};

export const SYS_GLYPH_VIEWBOX = "0 0 24 24";
