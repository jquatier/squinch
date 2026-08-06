// Positioned + Theme (+ view annotations) → deterministic SVG string.
// DESIGN.md-lite; integers, LF, fixed attribute order — the string is the
// artifact under byte-identity tests. Sketch themes swap crisp strokes for
// seeded rough.js paths and hand-lettered type; light/dark output is
// byte-for-byte what it was before sketch existed.
import { fit, measure, wrapText, type FontFamily } from "../metrics.js";
import { FONTS } from "../fonts.generated.js";
import { iconMeta, packMonochrome, packFullBleed } from "../model/packs.js";
import { iconAsset, symbolId } from "../packs/registry.js";
import { makeSketcher, type Sketcher } from "./sketch.js";
import type { Theme } from "../themes/index.js";
import { pillDims } from "../layout/layout.js";
import type { Positioned, PEdge, PNode, PZone } from "../layout/layout.js";
import type { EdgeAnimate, SNote, ZoneColor, ZoneKind } from "../model/types.js";

const PLATE = 40;
const PAD = 12;
/** comet travel speed. Fast enough to read as motion on a short hop, slow
 *  enough that a long cross-diagram edge is not a bullet. */
const COMET_PX_S = 150;
/** Duration floor. Below roughly 60px the constant-speed rule would produce a
 *  twitch rather than a journey, so very short edges run slightly fast — the
 *  one place in this renderer where px/s is not constant, and a deliberate
 *  trade. The alternative was drawing nothing below a length threshold, which
 *  is worse: the author wrote `animate: comet` and silently dropping it is the
 *  failure mode this project refuses everywhere else. */
const COMET_MIN_S = 0.4;
const R_NODE = 4;
const R_EDGE = 8;
const DIM = "0.35";

export interface RenderOpts {
  highlight?: string[];
  notes?: SNote[];
  showDescriptions?: boolean;
  /** `legend auto` — a key of the styles this render actually uses. */
  legend?: boolean;
  /** drafting-style corner block (bottom-right), free-form key/values */
  titleblock?: Record<string, string>;
  /** view title — the titleblock headline */
  title?: string;
  /** Embed the subsetted faces via @font-face (default true), so the SVG
   *  renders with the exact font the metrics were measured from even in
   *  sandboxed contexts like GitHub's <img>. Off = smaller output for hosts
   *  that already serve the fonts. */
  embedFonts?: boolean;
  /** Sketch-theme jitter seed — hash(source), threaded in by the API so
   *  roughness is a pure function of the input (never randomness). */
  seed?: number;
  /** Reveal this many hops of a `show flow`, dimming everything the request has
   *  not reached yet and picking out the current one. A viewer concern — the
   *  DSL declares the flow, the presenter walks it — so it lives here and not
   *  in the model. Omitted, the whole flow shows at once, as before.
   *
   *  Counted over the hops **visible in this view**, not the flow's declared
   *  numbering: a flow that starts two systems away has its opening steps
   *  lifted out of a scoped view, and walking declared numbers there would
   *  spend the first presses on frames where nothing happens. `1` is always
   *  the first hop you can actually see. Badges still read their declared
   *  number — that's the flow's real shape. */
  flowStep?: number;
  /** Hand id-bearing definitions out instead of emitting them inline, keyed by
   *  id. The interactive HTML export puts every view in one document, where
   *  fragment references resolve document-wide — so one `<symbol id="sq-aws-
   *  lambda">` serves all of them and the bodies keep their `<use href="#…">`
   *  untouched. Measured on `examples/microservices`: 27 KB of shared defs
   *  against 126 KB if every view carried its own.
   *
   *  Setting the same id to *different* markup throws. That turns "symbols,
   *  gradients and clip paths are theme-free" from a thing we believe into a
   *  build-time assertion — it fires the day someone themes one. */
  collectDefs?: Map<string, string>;
  /** Suffix for the one def whose content does depend on the theme (`sq-hatch`
   *  bakes `t.border`), so a document carrying two palettes does not have to
   *  pick one. Applied by the emitter to both definition and reference, so
   *  nothing downstream rewrites strings. */
  defsScope?: string;
}

/** The accent bar down a live system card carries the brand ramp off the
 *  Squinch mark — magenta through to light blue, top to bottom. Brand, not
 *  theme: the same two stops in light and dark, exactly as the logo behaves,
 *  which also means an adaptive render has nothing to switch here.
 *
 *  In objectBoundingBox units, so every bar runs the full ramp over its own
 *  height rather than sampling a slice of one diagram-wide gradient — a short
 *  card and a tall one should look like the same object. */
const ACCENT_GRAD = "sq-accent";

/** DESIGN §3: "hatched surface variant for `external`" — someone else's system.
 *  A texture rather than a colour, because it has to survive every theme
 *  including `contrast` and read the same in print; and because colour is
 *  already spoken for (accent = subject, muted = scenery, zone tints =
 *  boundary). Drawn over the surface, so the fill still shows through.
 *  Emitted only when a diagram actually owns an external node, which keeps
 *  every other render byte-identical. */
const HATCH = "sq-hatch";
/** The one def whose content depends on the theme, which is why it is the one
 *  that takes a scope suffix when several palettes share a document. */
const hatchPattern = (t: Theme, id: string) =>
  `<pattern id="${id}" width="8" height="8" patternUnits="userSpaceOnUse" ` +
  `patternTransform="rotate(45)">` +
  `<line x1="0" y1="0" x2="0" y2="8" stroke="${t.border}" stroke-width="1.5" opacity="0.4"/>` +
  `</pattern>`;
const hatched = (rc: RC, x: number, y: number, w: number, h: number, rx: number) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="url(#${rc.hatch})"/>`;
const accentGradient = () =>
  `<linearGradient id="${ACCENT_GRAD}" x1="0" y1="0" x2="0" y2="1">` +
  `<stop offset="0" stop-color="#C441FE"/><stop offset="1" stop-color="#15B6FF"/>` +
  `</linearGradient>`;

/** Everything the emitters need beyond geometry: theme, type, jitter. */
interface RC {
  t: Theme;
  fam: FontFamily;
  fx: (px: number) => number; // theme-scaled font size (sketch type runs larger)
  sk: Sketcher | null;
  /** `sq-hatch`, plus the document scope when one is set */
  hatch: string;
  /** when present, id-bearing defs go here instead of into this SVG */
  collect?: Map<string, string>;
}

// Dedicated family names: guarantee the embedded face wins over any
// page-level font, so text width always matches the precomputed metrics.
/** The @font-face rules alone. Exported because the interactive HTML export
 *  hoists them into one <style> for the whole document instead of repeating
 *  33 KB of base64 in every view. One implementation of the rule either way. */
export function fontFaceCSS(t: Theme): string {
  const cssFamily = t.font.css.split(",")[0];
  const face = (w: "400" | "500") =>
    `@font-face{font-family:${cssFamily};font-style:normal;font-weight:${w};` +
    `src:url(data:font/woff2;base64,${FONTS[t.font.metrics][w]}) format("woff2")}`;
  return `${face("400")}${face("500")}`;
}
function fontDefs(t: Theme): string {
  return `<style>${fontFaceCSS(t)}</style>`;
}

/** Crisp fill + theme-appropriate stroke: one rect in light/dark, a fill rect
 *  under a seeded rough outline in sketch. `extra` lands on the stroke. */
function box(
  rc: RC,
  x: number, y: number, w: number, h: number, rx: number,
  fill: string, stroke: string, strokeW: number, extra = "",
): string {
  if (!rc.sk)
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeW}"${extra}/>`;
  return (
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="${fill}"/>` +
    `<path d="${rc.sk.rect(x, y, w, h, { roughness: w < 80 ? 0.6 : undefined, multi: w >= 80 })}" fill="none" stroke="${stroke}" stroke-width="${strokeW}" stroke-linecap="round"${extra}/>`
  );
}

/** A vendor mark on the icon plate's corner (`badge:`, SPEC §nodes) — a 22px
 *  rounded-square surface plate overlapping the plate's bottom-right, held 5px
 *  clear of the card's interior edge, with the mark at 14px inside it.
 *
 *  Deliberately NOT iconPlate: the logos pack is monochrome, and iconPlate's
 *  monochrome branch draws a brand-coloured plate with a white knockout — the
 *  inverse of this treatment. Here the plate is quiet (surface + border, plain
 *  even in sketch, same "roughness stops at the plate" rule) and the mark
 *  carries its own brand colour from the pack manifest. Colour-pack artwork
 *  falls back to the same clip treatment iconPlate uses.
 */
function badgeMarkup(
  badge: { pack: string; id: string }, plateX: number, plateY: number, rc: RC,
): string {
  const { t } = rc;
  const SIZE = 22, INSET = 4, R = 5;
  // 40px plate → badge spans its corner: plate origin + 25 keeps the badge
  // 5px inside the 64px card (PAD 12 + 25 + 22 = 59).
  const x = plateX + 25, y = plateY + 25;
  const plate = `<rect x="${x}" y="${y}" width="${SIZE}" height="${SIZE}" rx="${R}" fill="${t.surface}" stroke="${t.border}"/>`;
  const asset = iconAsset(badge.pack, badge.id);
  if (!asset) return plate; // validated at check; an unloaded pack degrades to the bare plate
  const ix = x + INSET, iy = y + INSET, isz = SIZE - INSET * 2;
  if (badge.pack === "builtin" || packMonochrome(badge.pack)) {
    const c = iconMeta(badge.pack, badge.id)?.color ?? t.muted;
    return (
      plate +
      `<g color="${c}" fill="${c}">` +
      `<use href="#${symbolId(badge.pack, badge.id)}" x="${ix}" y="${iy}" width="${isz}" height="${isz}"/>` +
      `</g>`
    );
  }
  const clip = `clip-${symbolId(badge.pack, badge.id)}-${ix}-${iy}-${isz}`;
  return (
    plate +
    def(rc, clip, `<clipPath id="${clip}"><rect x="${ix}" y="${iy}" width="${isz}" height="${isz}" rx="2"/></clipPath>`) +
    `<g clip-path="url(#${clip})"><use href="#${symbolId(badge.pack, badge.id)}" x="${ix}" y="${iy}" width="${isz}" height="${isz}"/></g>`
  );
}

function edgePath(pts: { x: number; y: number }[], lines: Positioned["lines"]): string {
  if (lines === "straight")
    return `M ${pts[0].x} ${pts[0].y} L ${pts[pts.length - 1].x} ${pts[pts.length - 1].y}`;
  return roundedPath(pts, lines === "curved" ? 24 : R_EDGE);
}

function roundedPath(pts: { x: number; y: number }[], r = R_EDGE): string {
  if (pts.length < 3)
    return `M ${pts[0].x} ${pts[0].y} L ${pts[pts.length - 1].x} ${pts[pts.length - 1].y}`;
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i - 1], c = pts[i], n = pts[i + 1];
    const rr = Math.min(
      r,
      Math.floor(Math.hypot(c.x - p.x, c.y - p.y) / 2),
      Math.floor(Math.hypot(n.x - c.x, n.y - c.y) / 2),
    );
    if (rr < 2) { d += ` L ${c.x} ${c.y}`; continue; }
    d += ` L ${c.x - Math.sign(c.x - p.x) * rr} ${c.y - Math.sign(c.y - p.y) * rr}`
      + ` Q ${c.x} ${c.y} ${c.x + Math.sign(n.x - c.x) * rr} ${c.y + Math.sign(n.y - c.y) * rr}`;
  }
  d += ` L ${pts[pts.length - 1].x} ${pts[pts.length - 1].y}`;
  return d;
}

/**
 * Crossing hops (DESIGN §4): where two unrelated wires cross, the later edge
 * takes a small gap so a crossing can never read as a junction. Deterministic:
 * declaration order decides who hops, and only perpendicular axis-aligned
 * segments count. Edges that share an endpoint are connected, not crossing.
 */
const HOP = 4; // half-gap in px — an 8px break total
function hopPoints(edges: PEdge[]): Map<string, { x: number; y: number }[]> {
  const hops = new Map<string, { x: number; y: number }[]>();
  const segsOf = (e: PEdge) => {
    const out: { a: { x: number; y: number }; b: { x: number; y: number }; horiz: boolean }[] = [];
    for (let i = 0; i < e.points.length - 1; i++) {
      const a = e.points[i], b = e.points[i + 1];
      if (a.x === b.x && a.y === b.y) continue;
      out.push({ a, b, horiz: Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) });
    }
    return out;
  };
  const between = (v: number, p: number, q: number, pad: number) =>
    v >= Math.min(p, q) + pad && v <= Math.max(p, q) - pad;
  for (let i = 0; i < edges.length; i++)
    for (let j = i + 1; j < edges.length; j++) {
      const A = edges[i], B = edges[j];
      // connected edges meet at a node — that is a junction, not a crossing
      if (A.from === B.from || A.from === B.to || A.to === B.from || A.to === B.to) continue;
      for (const sa of segsOf(A))
        for (const sb of segsOf(B)) {
          if (sa.horiz === sb.horiz) continue;
          const h = sa.horiz ? sa : sb;
          const v = sa.horiz ? sb : sa;
          // the crossing must sit clear of both segments' own bends
          if (!between(v.a.x, h.a.x, h.b.x, HOP + 2)) continue;
          if (!between(h.a.y, v.a.y, v.b.y, HOP + 2)) continue;
          const pt = { x: v.a.x, y: h.a.y };
          (hops.get(B.id) ?? hops.set(B.id, []).get(B.id)!).push(pt);
        }
    }
  return hops;
}

/** Break a polyline into sub-polylines around each hop point. */
function splitAtHops(
  pts: { x: number; y: number }[],
  hops: { x: number; y: number }[],
): { x: number; y: number }[][] {
  const out: { x: number; y: number }[][] = [];
  let cur: { x: number; y: number }[] = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
    const on = hops
      .filter((h) =>
        Math.min(a.x, b.x) - 1 <= h.x && h.x <= Math.max(a.x, b.x) + 1 &&
        Math.min(a.y, b.y) - 1 <= h.y && h.y <= Math.max(a.y, b.y) + 1)
      .map((h) => ({ h, d: Math.hypot(h.x - a.x, h.y - a.y) }))
      .filter((x) => x.d > HOP + 2 && x.d < len - HOP - 2)
      .sort((p, q) => p.d - q.d);
    for (const { h, d } of on) {
      cur.push({ x: Math.round(a.x + ux * (d - HOP)), y: Math.round(a.y + uy * (d - HOP)) });
      out.push(cur);
      cur = [{ x: Math.round(a.x + ux * (d + HOP)), y: Math.round(a.y + uy * (d + HOP)) }];
    }
    cur.push(b);
  }
  out.push(cur);
  return out.filter((seg) => seg.length >= 2);
}

/** One head, pointing from `prev` toward `tip` (DESIGN §4: filled chevron 8×6,
 *  open chevron for async — never SVG default markers). */
function head(
  tip: { x: number; y: number },
  prev: { x: number; y: number },
  col: string,
  async: boolean,
  /** the segment is not axis-aligned, so compute the direction with trig */
  exact = false,
  /** ` class="sq-pulse"` when the whole edge breathes — head included */
  cls = "",
): string {
  let bx: number, by: number, ox: number, oy: number;
  if (exact) {
    // A real direction and a real perpendicular. Only `lines: straight` produces
    // segments that are not axis-aligned, and the axis-aligned maths below
    // cannot describe them: `Math.sign` collapses any diagonal onto an axis, so
    // a head on a shallow diagonal came out pointing straight down — 69° off
    // the line it was supposed to terminate.
    const len = Math.hypot(tip.x - prev.x, tip.y - prev.y) || 1;
    const ux = (tip.x - prev.x) / len, uy = (tip.y - prev.y) / len;
    bx = Math.round(tip.x - ux * 8); by = Math.round(tip.y - uy * 8);
    ox = Math.round(-uy * 6); oy = Math.round(ux * 6);
  } else {
    // Axis-aligned, where `(dy, dx)` happens to be the perpendicular and the
    // arithmetic stays in whole pixels with no rounding at all.
    const dx = Math.sign(tip.x - prev.x), dy = Math.sign(tip.y - prev.y);
    bx = tip.x - dx * 8; by = tip.y - dy * 8;
    ox = dy * 6; oy = dx * 6;
  }
  const p1 = `${bx + ox} ${by + oy}`, p2 = `${bx - ox} ${by - oy}`;
  return async
    ? `<path${cls} d="M ${p1} L ${tip.x} ${tip.y} L ${p2}" fill="none" stroke="${col}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<path${cls} d="M ${tip.x} ${tip.y} L ${p1} L ${p2} Z" fill="${col}"/>`;
}

/**
 * The heads for an edge. `->`/`~>` point one way, `<->` points both, and `--`
 * points neither — the whole reason those two spellings exist. They used to
 * draw as a plain one-way arrow, because the view graph reduced every arrow to
 * `async: boolean` and the other two kinds fell through the gap. Both are
 * documented in SKILL.md, so a diagram could state something the picture then
 * contradicted.
 */
function arrow(e: PEdge, t: Theme, lines: Positioned["lines"], accent = false, cls = ""): string {
  if (e.heads === "none") return "";
  const n = e.points.length;
  // the head has to travel with the line, or a highlighted hop ends in a grey point
  const col = accent ? t.accent : e.async ? t.asyncEdge : t.edge;
  // `straight` draws first point to last and discards the route in between, so
  // the head has to take its direction from what is actually drawn. Reading the
  // route's final segment instead pointed the head along a leg the reader never
  // sees.
  const exact = lines === "straight";
  const before = exact ? e.points[0] : e.points[n - 2];
  const after = exact ? e.points[n - 1] : e.points[1];
  const forward = head(e.points[n - 1], before, col, e.async, exact, cls);
  return e.heads === "both"
    ? forward + head(e.points[0], after, col, e.async, exact, cls)
    : forward;
}

/** class per animate value — `sq-flow` predates the vocabulary and keeps its
 *  name so flow-only output stays byte-identical to every committed render */
/** Stroke class per animate value. Partial on purpose: `comet` animates a
 *  separate travelling element and leaves the stroke alone, so it has no entry
 *  and the lookup must be allowed to miss. */
const ANIM_CLASS: Partial<Record<EdgeAnimate, string>> = {
  flow: "sq-flow", reverse: "sq-flow-r", slow: "sq-flow-s",
  fast: "sq-flow-f", packets: "sq-pk", pulse: "sq-pulse",
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Greedy word-wrap against the metrics table; ≤maxLines, last line ellipsized. */
function wrap(rc: RC, text: string, maxPx: number, sizePx: number, maxLines: number): string[] {
  return wrapText(text, maxPx, sizePx, rc.fam, maxLines);
}

function leaf(n: PNode, rc: RC, opts: RenderOpts, dimmed: boolean, L: string[]) {
  const { t } = rc;
  const op = dimmed ? ` opacity="${DIM}"` : "";
  const ctx = n.kind === "context-leaf";
  const stroke = ctx ? ` stroke-dasharray="4 3"` : "";
  L.push(`<g data-path="${esc(n.path)}" data-kind="${n.kind}"${op}>`);
  L.push(box(rc, n.x, n.y, n.w, n.h, R_NODE, t.surface, t.border, 1.5, stroke));
  if (n.external) L.push(hatched(rc, n.x, n.y, n.w, n.h, R_NODE));
  const px = n.x + PAD, py = n.y + PAD;
  L.push(iconPlate(n.icon, px, py, PLATE, rc, ctx));
  if (n.badge) L.push(badgeMarkup(n.badge, px, py, rc));
  const maxLabel = n.w - PAD - PLATE - PAD - PAD;
  const withDesc = opts.showDescriptions && n.description;
  const labelY = withDesc ? n.y + n.h / 2 - 1 : n.y + n.h / 2 + 5;
  L.push(
    `<text x="${px + PLATE + PAD}" y="${labelY}" font-size="${rc.fx(13)}" font-weight="500" fill="${ctx ? t.muted : t.ink}">${esc(fit(n.label, maxLabel, rc.fx(13), "500", rc.fam))}</text>`,
  );
  if (withDesc)
    L.push(
      `<text x="${px + PLATE + PAD}" y="${n.y + n.h / 2 + 15}" font-size="${rc.fx(11)}" fill="${t.muted}">${esc(fit(n.description!, maxLabel, rc.fx(11), "400", rc.fam))}</text>`,
    );
  L.push(`</g>`);
}

function card(n: PNode, rc: RC, dimmed: boolean, L: string[]) {
  const { t } = rc;
  const ctx = n.kind === "context-card";
  // one opacity, never two: dim wins over the context fade
  const op = dimmed ? ` opacity="${DIM}"` : ctx ? ` opacity="0.75"` : "";
  const stroke = ctx ? ` stroke-dasharray="4 3"` : "";
  L.push(`<g data-path="${esc(n.path)}" data-kind="${n.kind}"${op}>`);
  L.push(box(rc, n.x, n.y, n.w, n.h, 6, t.surface, t.border, 1.5, stroke));
  if (n.external) L.push(hatched(rc, n.x, n.y, n.w, n.h, 6));
  // accent bar (kind silhouette, DESIGN §3). A live card carries the brand
  // ramp; a context card stays muted, because the bar is what tells the two
  // apart at a glance and colour is the cheapest way to say "this one is the
  // subject".
  L.push(
    `<rect x="${n.x}" y="${n.y}" width="4" height="${n.h}" rx="2" fill="${ctx ? t.muted : `url(#${ACCENT_GRAD})`}"/>`,
  );
  const tx = n.x + PAD + 6;
  L.push(
    `<text x="${tx}" y="${n.y + 34}" font-size="${rc.fx(15)}" font-weight="500" fill="${ctx ? t.muted : t.ink}">${esc(fit(n.label, n.w - 60, rc.fx(15), "500", rc.fam))}</text>`,
  );
  if (n.tagline)
    L.push(
      `<text x="${tx}" y="${n.y + 54}" font-size="${rc.fx(11)}" fill="${t.muted}">${esc(fit(n.tagline, n.w - 40, rc.fx(11), "400", rc.fam))}</text>`,
    );
  if (n.glyph) {
    const asset = iconAsset(n.glyph.pack, n.glyph.id);
    if (asset)
      L.push(
        `<g color="${t.muted}"><use href="#${symbolId(n.glyph.pack, n.glyph.id)}" x="${n.x + n.w - PAD - 18}" y="${n.y + 10}" width="18" height="18"/></g>`,
      );
    else {
      const g = iconMeta(n.glyph.pack, n.glyph.id);
      if (g)
        L.push(
          `<text x="${n.x + n.w - PAD}" y="${n.y + 22}" text-anchor="end" font-size="${rc.fx(10)}" font-weight="500" fill="${t.muted}">${esc(g.code)}</text>`,
        );
    }
  }
  // preview strip: up to 3 inner icons, bottom-right, 16px at 60%
  n.preview.forEach((icon, i) => {
    const ix = n.x + n.w - PAD - 16 - i * 20;
    const iy = n.y + n.h - PAD - 16;
    L.push(iconPlate(icon, ix, iy, 16, rc, true));
  });
  L.push(`</g>`);
}

/**
 * Sticky chips with a leader to their anchor (DESIGN §5). Returns the extent of
 * everything drawn, because a note placed relative to a node at the edge of the
 * diagram lands outside the canvas and is simply clipped away — `above` on the
 * top row and `below` on the bottom row always do. Three committed diagrams
 * shipped with an invisible note before anything measured this.
 */
function notes(
  p: Positioned, rc: RC, list: SNote[], L: string[],
): { minX: number; minY: number; maxX: number; maxY: number } {
  // The resolver lives in layout now (Positioned consolidation) — this draws
  // p.notes and reports the extent, exactly the numbers the placement used to
  // produce here, so the caller's canvas pad/shift is unchanged.
  const { t } = rc;
  const ext = { minX: 0, minY: 0, maxX: p.width, maxY: p.height };
  for (const n of p.notes ?? []) {
    const note = list[n.i];
    if (!note) continue;
    const { x, y, w, h, lines } = n;
    ext.minX = Math.min(ext.minX, x); ext.minY = Math.min(ext.minY, y);
    ext.maxX = Math.max(ext.maxX, x + w); ext.maxY = Math.max(ext.maxY, y + h);
    const bg = note.style === "warning" ? t.warnTint : t.surface;
    const id = note.anchor.kind === "relpos"
      ? `${note.anchor.relpos}:${note.anchor.target}`
      : note.anchor.kind === "edge"
        ? `on:${note.anchor.from}->${note.anchor.to}`
        : note.anchor.corner;
    L.push(`<g data-note="${esc(id)}">`);
    if (n.leader)
      L.push(
        `<line x1="${n.leader.x1}" y1="${n.leader.y1}" x2="${n.leader.x2}" y2="${n.leader.y2}" stroke="${t.muted}" stroke-width="1" stroke-dasharray="2 3"/>`,
      );
    L.push(box(rc, x, y, w, h, 3, bg, t.border, 1));
    lines.forEach((line, i) =>
      L.push(
        `<text x="${x + 12}" y="${y + 17 + i * 15}" font-size="${rc.fx(11)}" fill="${t.ink}">${esc(line)}</text>`,
      ),
    );
    L.push(`</g>`);
  }
  return ext;
}

// zone-kind → tint token (DESIGN §5: kind-tinted, low opacity)
const ZONE_TINT: Record<ZoneKind, (t: Theme) => string> = {
  account: (th) => th.zoneAccount,
  region: (th) => th.zoneNeutral,
  vpc: (th) => th.zoneNetwork,
  subnet: (th) => th.zoneNetwork,
  network: (th) => th.zoneNetwork,
  cloud: (th) => th.zoneCloud,
  onprem: (th) => th.zoneNeutral,
  custom: (th) => th.zoneNeutral,
};

// explicit `color:` roles a zone may choose instead of its kind default —
// still theme tokens, never hex in the DSL
const ZONE_COLOR_ROLE: Record<ZoneColor, (t: Theme) => string> = {
  account: (th) => th.zoneAccount,
  network: (th) => th.zoneNetwork,
  cloud: (th) => th.zoneCloud,
  neutral: (th) => th.zoneNeutral,
  ink: (th) => th.ink,
  muted: (th) => th.muted,
  accent: (th) => th.accent,
};

const zoneColor = (z: { kind: ZoneKind; color?: ZoneColor }, t: Theme) =>
  z.color ? ZONE_COLOR_ROLE[z.color](t) : ZONE_TINT[z.kind](t);

/** Legend of what's actually in the picture — never a fixed key (DESIGN:
 *  quiet structure; only earned entries). Returns markup + band height. */
function legend(p: Positioned, rc: RC, y: number, L: string[]): { h: number; w: number } {
  const { t } = rc;
  const items: { sample: (x: number, cy: number) => string; label: string }[] = [];
  if (p.edges.some((e) => !e.async))
    items.push({
      sample: (x, cy) => `<line x1="${x}" y1="${cy}" x2="${x + 24}" y2="${cy}" stroke="${t.edge}" stroke-width="1.5"/>`,
      label: "sync",
    });
  if (p.edges.some((e) => e.async))
    items.push({
      sample: (x, cy) => `<line x1="${x}" y1="${cy}" x2="${x + 24}" y2="${cy}" stroke="${t.asyncEdge}" stroke-width="1.5" stroke-dasharray="6 4"/>`,
      label: "async",
    });
  // Declared stroke styles on sync edges, in style-list order, deduped — the
  // async item above already explains dashes on async wires, so only sync
  // edges earn these. Same shape as the zone-kind items below.
  const stylesPresent = (["dashed", "dotted"] as const).filter((st) =>
    p.edges.some((e) => !e.async && e.style === st),
  );
  for (const st of stylesPresent)
    items.push({
      sample: (x, cy) =>
        `<line x1="${x}" y1="${cy}" x2="${x + 24}" y2="${cy}" stroke="${t.edge}" stroke-width="1.5" stroke-dasharray="${st === "dashed" ? "6 4" : "2 3"}"/>`,
      label: st,
    });
  if (p.edges.some((e) => e.count > 1))
    items.push({
      sample: (x, cy) =>
        `<line x1="${x}" y1="${cy}" x2="${x + 24}" y2="${cy}" stroke="${t.edge}" stroke-width="1.5"/>` +
        `<text x="${x + 12}" y="${cy - 4}" text-anchor="middle" font-size="${rc.fx(9)}" fill="${t.muted}">×n</text>`,
      label: "aggregated",
    });
  if (p.nodes.some((n) => n.kind.startsWith("context")))
    items.push({
      sample: (x, cy) => `<rect x="${x + 2}" y="${cy - 7}" width="20" height="14" rx="2" fill="${t.surface}" stroke="${t.border}" stroke-width="1.5" stroke-dasharray="4 3"/>`,
      label: "context",
    });
  if (p.flow && Object.keys(p.flow.byEdge).length)
    items.push({
      sample: (x, cy) =>
        `<circle cx="${x + 12}" cy="${cy}" r="8" fill="${t.accent}"/>` +
        `<text x="${x + 12}" y="${cy + 3}" text-anchor="middle" font-size="${rc.fx(9)}" font-weight="500" fill="${t.plateText}">1</text>`,
      label: `flow: ${p.flow.label}`,
    });
  // zone kinds present in this render, in kind-list order, deduped
  const kindsPresent = [...new Set((p.zones ?? []).map((z) => z.kind))];
  for (const kind of kindsPresent) {
    const col = ZONE_TINT[kind](t);
    items.push({
      sample: (x, cy) =>
        `<rect x="${x + 2}" y="${cy - 7}" width="20" height="14" rx="2" fill="${col}" fill-opacity="0.04" stroke="${col}" stroke-width="1" stroke-dasharray="4 3"/>`,
      label: kind,
    });
  }
  if (!items.length) return { h: 0, w: 0 };
  const cy = y + 12;
  let x = 16;
  for (const it of items) {
    L.push(it.sample(x, cy));
    x += 24 + 8;
    L.push(`<text x="${x}" y="${cy + 4}" font-size="${rc.fx(11)}" fill="${t.muted}">${esc(it.label)}</text>`);
    x += Math.round(measure(it.label, rc.fx(11), "400", rc.fam)) + 24;
  }
  return { h: 24, w: x - 24 };
}

function titleblockDims(rc: RC, title: string | undefined, kv: Record<string, string>, canvasW: number) {
  const rows = Object.entries(kv);
  const keyW = Math.max(0, ...rows.map(([k]) => measure(k, rc.fx(11), "400", rc.fam)));
  const wNeed = Math.max(
    title ? measure(title, rc.fx(13), "500", rc.fam) : 0,
    ...rows.map(([, v]) => keyW + 12 + measure(v, rc.fx(11), "400", rc.fam)),
  );
  return {
    rows, keyW,
    w: Math.min(280, canvasW - 32, Math.round(wNeed) + 24), // never wider than the canvas
    h: (title ? 24 : 8) + rows.length * 16 + 8,
  };
}

/** Drafting-style corner block, bottom-right: title row + key/value rows. */
function titleblock(
  p: Positioned, rc: RC, y: number, dims: ReturnType<typeof titleblockDims>,
  title: string | undefined, L: string[],
): void {
  const { t } = rc;
  const { rows, keyW, w, h } = dims;
  const x = p.width - w - 16;
  L.push(box(rc, x, y, w, h, 3, t.surface, t.border, 1));
  let ty = y + 18;
  if (title) {
    L.push(`<text x="${x + 12}" y="${ty}" font-size="${rc.fx(13)}" font-weight="500" fill="${t.ink}">${esc(fit(title, w - 24, rc.fx(13), "500", rc.fam))}</text>`);
    ty += 20;
  } else ty -= 2;
  for (const [k, v] of rows) {
    L.push(`<text x="${x + 12}" y="${ty}" font-size="${rc.fx(11)}" fill="${t.muted}">${esc(k)}</text>`);
    L.push(`<text x="${x + 12 + Math.round(keyW) + 12}" y="${ty}" font-size="${rc.fx(11)}" fill="${t.ink}">${esc(fit(v, w - 24 - keyW - 12, rc.fx(11), "400", rc.fam))}</text>`);
    ty += 16;
  }
}

interface Pill {
  x: number; y: number; w: number; h: number;
  mx: number; label: string; dimmed: boolean;
  edgeId?: string;
}

/** Anything with a box: a node, a pill, a badge, a chip, a note, a reserved
 *  band. The annotation layers all resolve collisions against each other, so
 *  they need one shared vocabulary rather than three that agree by accident. */
export interface Rect { x: number; y: number; w: number; h: number }

/** Overlap with a margin. 4 is the standing figure — `docs/notes/edge-labels.md`
 *  records relaxing it as tried and rejected ("the label then visually kisses
 *  the node border, and it loosens every tight placement everywhere"). */
const hits = (a: Rect, b: Rect, m = 4) =>
  a.x < b.x + b.w + m && a.x + a.w + m > b.x && a.y < b.y + b.h + m && a.y + a.h + m > b.y;

/**
 * Compute all edge-label pills, then resolve collisions deterministically:
 * a pill overlapping a node or an earlier pill shifts down until clear
 * (DESIGN: a label never sits on another label — enforced, not hoped).
 */
function computePills(p: Positioned, rc: RC, edgeMatches: (e: PEdge) => boolean): Pill[] {
  // Until label-space reservation (2026-08) this function was a 116-line
  // placement search: obstacle lists, a nine-fraction candidate ladder over
  // segments ranked longest-first, an overhang allowance, a relocate fallback
  // and a shared baseline for detached labels — all machinery for finding room
  // in gutters that were never sized to hold a label. The room is now made at
  // layout time (ELK inline labels cross-rank, gutter/lane reservation
  // coplanar; docs/notes/edge-labels.md), every labelled edge carries
  // `labelRect`, and a pill cannot collide with anything because the space it
  // occupies exists on purpose. The invariant sweep asserts exactly that over
  // the whole corpus.
  const pills: Pill[] = [];
  for (const e of p.edges) {
    if (!e.label) continue;
    const dims = pillDims(e.label, { metrics: rc.fam, scale: rc.t.font.scale });
    // A labelled edge without a reservation cannot happen for engine-produced
    // layouts; the midpoint fallback keeps a hand-built `Positioned` (tests,
    // future tooling) drawing its label rather than silently dropping it.
    const r = e.labelRect ?? {
      x: Math.round((e.points[0].x + e.points[e.points.length - 1].x) / 2 - dims.w / 2),
      y: Math.round((e.points[0].y + e.points[e.points.length - 1].y) / 2) - 9,
      w: dims.w, h: 18,
    };
    const py = r.y + Math.round((r.h - 18) / 2);
    pills.push({
      x: r.x, y: py, w: r.w, h: 18, mx: r.x + Math.round(r.w / 2),
      label: dims.label, dimmed: !edgeMatches(e), edgeId: e.id,
    });
  }
  return pills;
}


/**
 * Zone label chips straddle their zone's top border. ELK doesn't treat labels
 * as routing obstacles (spiked: outside compound labels get routed straight
 * through), so this is ours, same philosophy as computePills: slide the chip
 * right along the border in grid steps to the first spot clear of edges,
 * nodes and pills — falling back to the least-crossed spot. The canvas halo
 * (drawn in chipMarkup) keeps even the fallback legible.
 */
// placeZoneChips moved to layout.ts (Positioned consolidation): chip geometry
// is layout's; the colour below is the renderer's.

function chipMarkup(c: Positioned["chips"][number], p: Positioned, rc: RC, t: Theme): string {
  const zone = (p.zones ?? []).find((z) => z.id === c.zone);
  const col = zone ? zoneColor(zone, t) : t.muted;
  // halo first: a canvas knockout 3px proud of the chip, so any edge the chip
  // must sit over reads as deliberately interrupted, never collided-with
  const halo = `<rect x="${c.x - 3}" y="${c.y - 3}" width="${c.w + 6}" height="${c.h + 6}" rx="4" fill="${t.canvas}"/>`;
  const chip = rc.sk
    ? `<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" rx="2" fill="${t.canvas}"/>` +
      `<path d="${rc.sk.rect(c.x, c.y, c.w, c.h, { roughness: 0.6, multi: false })}" fill="none" stroke="${col}" stroke-width="1"/>`
    : `<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" rx="3" fill="${t.canvas}" stroke="${col}" stroke-width="1"/>`;
  // the icon is a flush, full-height tab on the chip's left edge — the AWS
  // boundary-label convention — never a padded thumbnail floating in the pill.
  // Full-bleed artwork (k8s) is the exception: drawn edge-to-edge it collides
  // with the chip border, so it gets a small inset inside the same tab slot —
  // the text position never moves.
  const inset = c.icon && packFullBleed(c.icon.pack) ? 3 : 0;
  const icon = c.icon
    ? iconPlate(c.icon, c.x + inset, c.y + inset, c.h - 2 * inset, rc)
    : "";
  const tx = c.x + 8 + (c.icon ? c.h + 4 : 0);
  return (
    `<g data-kind="zone-chip" data-zone="${esc(c.zone)}">${halo}${chip}${icon}` +
    `<text x="${tx}" y="${c.y + 14}" font-size="${rc.fx(11)}" font-weight="500" fill="${col}">${esc(c.label)}</text></g>`
  );
}

function pillMarkup(pill: Pill, rc: RC): string {
  const { t } = rc;
  const op = pill.dimmed ? ` opacity="${DIM}"` : "";
  return (
    `<g${op}>` + box(rc, pill.x, pill.y, pill.w, pill.h, 2, t.surface, t.border, 1) +
    `<text x="${pill.mx}" y="${pill.y + 13}" text-anchor="middle" font-size="${rc.fx(11)}" fill="${t.muted}">${esc(pill.label)}</text></g>`
  );
}

/** Record a def, or emit it inline when nothing is collecting. Re-recording an
 *  id with different markup is a bug in whatever made it theme-dependent, not
 *  something to paper over — the export would silently draw one view with
 *  another's definition. */
function def(rc: RC, id: string, markup: string): string {
  if (!rc.collect) return markup;
  const seen = rc.collect.get(id);
  if (seen !== undefined && seen !== markup)
    throw new Error(
      `def \`${id}\` differs between renders sharing a document — it depends on ` +
      `something (theme?) that a shared definition cannot carry. Give it a defsScope.`,
    );
  rc.collect.set(id, markup);
  return "";
}

/** One <symbol> per distinct icon used in this render, in stable order. */
function iconDefs(p: Positioned, rc: RC): string {
  const used = new Map<string, { pack: string; id: string }>();
  const note = (icon?: { pack: string; id: string }) => {
    if (icon) used.set(`${icon.pack}/${icon.id}`, icon);
  };
  for (const n of p.nodes) {
    note(n.icon);
    note(n.glyph);
    note(n.badge);
    for (const prev of n.preview) note(prev);
  }
  for (const z of p.zones ?? []) note(z.icon);
  const symbols: string[] = [];
  for (const key of [...used.keys()].sort()) {
    const { pack, id } = used.get(key)!;
    const asset = iconAsset(pack, id);
    if (!asset) continue;
    // artwork inlined verbatim inside the symbol; placement is ours, the asset is untouched
    symbols.push(
      `<symbol id="${symbolId(pack, id)}" viewBox="${asset.viewBox}">${asset.body}</symbol>`,
    );
  }
  if (rc.collect) {
    for (const sym of symbols) def(rc, /id="([^"]+)"/.exec(sym)![1], sym);
    return "";
  }
  return symbols.length ? `<defs>\n${symbols.join("\n")}\n</defs>` : "";
}

/** Icon artwork clipped to our plate radius, or a lettered fallback plate.
 *  Always crisp — the AWS art is verbatim; sketch roughness stops at its edge. */
function iconPlate(
  icon: { pack: string; id: string } | undefined,
  x: number, y: number, size: number, rc: RC, soften = false,
): string {
  const { t } = rc;
  const meta = icon ? iconMeta(icon.pack, icon.id) : undefined;
  const asset = icon ? iconAsset(icon.pack, icon.id) : undefined;
  const r = Math.max(2, Math.round(size / 10));
  if (asset && icon && (icon.pack === "builtin" || packMonochrome(icon.pack))) {
    // single-colour marks — our own glyphs and logo packs alike: a coloured
    // plate with the mark knocked out of it, so a wordless logo still reads
    const pad = Math.round(size * 0.2);
    return (
      `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${r}" fill="${meta?.color ?? t.muted}"${soften ? ` opacity="0.6"` : ""}/>` +
      // `fill` as well as `color`: our own glyphs paint with currentColor, but
      // vendored marks (Simple Icons) carry no fill at all and would default to
      // black — invisible on a dark brand plate. fill is inherited, and any
      // glyph that sets its own fill still wins.
      `<g color="${t.plateText}" fill="${t.plateText}"${soften ? ` opacity="0.9"` : ""}>` +
      `<use href="#${symbolId(icon.pack, icon.id)}" x="${x + pad}" y="${y + pad}" width="${size - pad * 2}" height="${size - pad * 2}"/>` +
      `</g>`
    );
  }
  if (asset && icon) {
    // clip-path directly on <use> stops it instantiating in some renderers —
    // wrap instead, so the artwork still gets our rounded plate corners.
    const clip = `clip-${symbolId(icon.pack, icon.id)}-${x}-${y}-${size}`;
    return (
      def(rc, clip, `<clipPath id="${clip}"><rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${r}"/></clipPath>`) +
      `<g clip-path="url(#${clip})"${soften ? ` opacity="0.6"` : ""}>` +
      `<use href="#${symbolId(icon.pack, icon.id)}" x="${x}" y="${y}" width="${size}" height="${size}"/>` +
      `</g>`
    );
  }
  const code = meta?.code ?? "?";
  return (
    `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${r}" fill="${meta?.color ?? t.muted}"${soften ? ` opacity="0.6"` : ""}/>` +
    (size >= 24
      ? `<text x="${x + size / 2}" y="${y + size / 2 + 4}" text-anchor="middle" font-size="${rc.fx(11)}" font-weight="500" fill="${t.plateText}">${esc(code)}</text>`
      : "")
  );
}

export function renderSVG(p: Positioned, t: Theme, opts: RenderOpts = {}): string {
  const rc: RC = {
    t,
    fam: t.font.metrics,
    fx: (px) => Math.round(px * t.font.scale),
    sk: t.sketch ? makeSketcher(opts.seed ?? 1, t.sketch.roughness, t.sketch.bowing) : null,
    hatch: `${HATCH}${opts.defsScope ?? ""}`,
    collect: opts.collectDefs,
  };
  const hl = opts.highlight ?? [];
  const byPath = new Map(p.nodes.map((n) => [n.path, n]));

  // Walking a flow (`flowStep`) dims by *progress* rather than by tag: an edge
  // is reached once one of its step numbers is due, and a node once an edge
  // touching it is. Both dimming rules compose — a highlighted view that also
  // steps a flow dims anything failing either test.
  const stepsOf = (e: PEdge): number[] => p.flow?.byEdge[e.id] ?? [];
  const walking = opts.flowStep !== undefined && !!p.flow;
  // the declared step numbers that render here, in order — the ordinal indexes
  // into this, so hop 1 is the first one on screen whatever it is called
  const visible = p.flow
    ? [...new Set(Object.values(p.flow.byEdge).flat())].sort((a, b) => a - b)
    : [];
  const step = walking
    ? visible[Math.min(Math.max(opts.flowStep!, 0), visible.length) - 1]
    : undefined;
  const edgeReached = (e: PEdge) =>
    !walking || (step !== undefined && stepsOf(e).some((s) => s <= step));
  const reachedNodes = new Set<string>();
  if (walking)
    for (const e of p.edges) if (edgeReached(e)) reachedNodes.add(e.from), reachedNodes.add(e.to);

  const nodeMatches = (n: PNode) =>
    (hl.length === 0 || n.tags.some((tag) => hl.includes(tag))) &&
    (!walking || reachedNodes.has(n.path));
  // An edge lights up when it carries the tag itself, or when both its endpoints
  // do. Edge-level `tags:` parse, are stored on the model, and are documented in
  // SKILL.md (`api -> create { tags: #hot-path }`) — but they never reached the
  // view graph, so `highlight #hot-path` dimmed the very edge it named. A
  // hot-path or a PCI wire is exactly the thing whose endpoints are often
  // ordinary, which is what makes tagging the edge worth doing at all.
  const edgeMatches = (e: PEdge) =>
    (hl.length === 0 ||
      e.tags.some((tag) => hl.includes(tag)) ||
      (nodeMatches(byPath.get(e.from)!) && nodeMatches(byPath.get(e.to)!))) &&
    edgeReached(e);

  const body: string[] = [];

  // zone boundaries first — the classic dashed deployment frame, behind
  // everything, outermost first (DESIGN §5). Kind picks the tint. The label
  // chips render LAST (top layer, after edges) so their canvas halo knocks
  // out anything they must sit over — see placeZoneChips below.
  const zoneMarkup = (z: PZone): string => {
    const col = zoneColor(z, t);
    const dash = ` stroke-dasharray="8 5"`;
    const boundary = rc.sk
      ? `<rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" rx="2" fill="${col}" fill-opacity="0.04"/>` +
        `<path d="${rc.sk.rect(z.x, z.y, z.w, z.h, { multi: false })}" fill="none" stroke="${col}" stroke-width="1.5"${dash} stroke-linecap="round"/>`
      : `<rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" rx="8" fill="${col}" fill-opacity="0.04" stroke="${col}" stroke-width="1.5"${dash}/>`;
    return `<g data-kind="zone" data-zone="${esc(z.id)}" data-zone-kind="${z.kind}">${boundary}</g>`;
  };
  for (const z of [...(p.zones ?? [])].sort((a, b) => a.depth - b.depth)) body.push(zoneMarkup(z));

  // container frames first — recessed surface behind everything (DESIGN §5)
  for (const f of p.frames) {
    if (rc.sk) {
      body.push(`<g data-path="${esc(f.path)}" data-kind="frame">` +
        box(rc, f.x, f.y, f.w, f.h, 8, t.surfaceAlt, t.border, 1) + `</g>`);
    } else {
      body.push(
        `<rect data-path="${esc(f.path)}" data-kind="frame" x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="8" fill="${t.surfaceAlt}" stroke="${t.border}" stroke-width="1"/>`,
      );
    }
    body.push(
      `<text x="${f.x + 14}" y="${f.y + 24}" font-size="${rc.fx(13)}" font-weight="500" fill="${t.muted}">${esc(f.label)}</text>`,
    );
  }

  const hops = hopPoints(p.edges);
  for (const e of p.edges) {
    const dimmed = !edgeMatches(e);
    // the hop being narrated right now: accent-coloured and heavier, so the
    // eye lands on it without having to hunt for the badge
    const current = step !== undefined && stepsOf(e).includes(step);
    const col = current ? t.accent : e.async ? t.asyncEdge : t.edge;
    const weight = current ? 2.5 : 1.5;
    // The pattern is a presentation attribute, never CSS: resvg ignores
    // stylesheets, so the static dashes are what a PNG export shows. `packets`
    // draws its own sparse pattern; otherwise the resolved style decides
    // (async edges resolve to `dashed` by default, so their output here is
    // byte-identical to when this line only knew about `e.async`).
    const pattern = e.animate === "packets" ? "3 15"
      : e.style === "dashed" ? "6 4"
      : e.style === "dotted" ? "2 3" : undefined;
    const dash = pattern ? ` stroke-dasharray="${pattern}"` : "";
    // Animation: dashes drift at constant px/s (shared keyframes with a fixed
    // dash period, so long edges never "flow faster"); CSS only, and
    // prefers-reduced-motion turns it all off. One class per animate value.
    // comet animates a separate element, not the stroke: the wire keeps
    // whatever `style:` says and the dot rides it.
    const cls = e.animate ? ANIM_CLASS[e.animate] : undefined;
    const anim = cls ? ` class="${cls}"` : "";
    const op = dimmed ? ` opacity="${DIM}"` : "";
    const myHops = hops.get(e.id);
    const runs = myHops?.length ? splitAtHops(e.points, myHops) : [e.points];
    body.push(`<g${op}>`);
    for (const run of runs) {
      const d = edgePath(run, p.lines);
      body.push(
        `<path${anim} d="${rc.sk ? rc.sk.path(d) : d}" fill="none" stroke="${col}" stroke-width="${weight}"${dash}${rc.sk ? ` stroke-linecap="round"` : ""}/>`,
      );
    }
    if (e.animate === "comet") {
      // The dot rides the *unsplit* route. Hop splitting exists to break the
      // stroke where two edges cross; the traveller has no such problem, and a
      // dot sailing over the gap is what a reader expects. Same reason the
      // sketch theme gets the ideal path rather than the roughened one — the
      // wobble is the drawing, not the road.
      const road = edgePath(e.points, p.lines);
      // Constant px/s, like every other animation here — but a comet cannot get
      // it from a shared keyframe, so the duration carries it: len ÷ speed.
      // Polyline sum, deliberately ignoring corner rounding (it shortens a
      // corner by under half its radius). sqrt is exact per IEEE-754, so this
      // is the same number on every platform; the round keeps it the same
      // *string* too, which is what the byte-compare actually gates on.
      let len = 0;
      for (let i = 1; i < e.points.length; i++)
        len += Math.hypot(e.points[i].x - e.points[i - 1].x, e.points[i].y - e.points[i - 1].y);
      const secs = Math.max(COMET_MIN_S, Math.round((len / COMET_PX_S) * 100) / 100);
      // opacity as a presentation attribute, not CSS: resvg reads those and
      // ignores CSS, so a PNG export gets no stray dot parked at the origin.
      body.push(
        `<circle r="3.5" fill="${col}" opacity="0"` +
          ` style="offset-path:path('${road}');animation:sq-comet ${secs}s linear infinite"/>`,
      );
    }
    // pulse breathes the whole edge, arrowhead included; travel animations
    // stay off the head — a drifting chevron reads as the head detaching
    body.push(arrow(e, t, p.lines, current, e.animate === "pulse" ? anim : ""));
    body.push(`</g>`);
  }

  for (const n of p.nodes) {
    const dimmed = !nodeMatches(n);
    if (n.kind === "card" || n.kind === "context-card") card(n, rc, dimmed, body);
    else leaf(n, rc, opts, dimmed, body);
    if (!dimmed && hl.length > 0)
      body.push(
        `<rect x="${n.x - 3}" y="${n.y - 3}" width="${n.w + 6}" height="${n.h + 6}" rx="${R_NODE + 3}" fill="none" stroke="${t.accent}" stroke-width="1.5" opacity="0.8"/>`,
      );
  }

  // labels last, collision-resolved; canvas grows if a pill was pushed below
  const pills = computePills(p, rc, edgeMatches);
  for (const pill of pills) body.push(pillMarkup(pill, rc));
  // zone label chips last: slid clear of edges where possible, haloed always
  // Kept, not discarded: notes are placed after all of these and have to avoid
  // them. The ordering *is* the obstacle registry — each layer sees what came
  // before it — and notes are the end of the chain, so everything they need is
  // in scope here.
  const chips = p.chips ?? [];
  for (const chip of chips) body.push(chipMarkup(chip, p, rc, t));
  // flow step badges: numbered circles just after each edge leaves its
  // source, sliding further along the wire past pills, nodes and each other
  // Badges were reserved by layout for the FULL flow's text; walking a flow
  // draws the due subset right-aligned inside the reservation, so per-step
  // text changes never move a badge or collide with anything.
  const placedBadges: { x: number; y: number; w: number; h: number }[] = [];
  for (const b of p.badges ?? []) {
    const nums = b.nums.filter((s2) => !walking || (step !== undefined && s2 <= step));
    if (!nums.length) continue;
    const text = nums.join("·");
    const rWide = Math.max(9, Math.round(measure(text, rc.fx(10), "500", rc.fam) / 2) + 5);
    const cx = b.x + b.w - rWide;
    const cy = b.y + 9;
    placedBadges.push({ x: cx - rWide, y: cy - 9, w: rWide * 2, h: 18 });
    const done = walking && step !== undefined && !nums.includes(step);
    const halo = walking && !done
      ? `<rect x="${cx - rWide - 3}" y="${cy - 12}" width="${rWide * 2 + 6}" height="24" rx="12" fill="none" stroke="${t.accent}" stroke-width="1.5" opacity="0.45"/>`
      : "";
    body.push(
      `<g data-kind="flow-step"${done ? ` opacity="0.55"` : ""}>` +
        halo +
        (rWide > 9
          ? `<rect x="${cx - rWide}" y="${cy - 9}" width="${rWide * 2}" height="18" rx="9" fill="${t.accent}"/>`
          : `<circle cx="${cx}" cy="${cy}" r="9" fill="${t.accent}"/>`) +
        `<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="${rc.fx(10)}" font-weight="500" fill="${t.plateText}">${esc(text)}</text></g>`,
    );
  }

  let height = Math.max(p.height, ...pills.map((pl) => pl.y + pl.h + 16));

  // A note anchored to a node on the edge of the diagram lands outside the
  // canvas: `above` on the top row and `below` on the bottom row always do, and
  // `left-of`/`right-of` do on the outer columns. It rendered, and was then
  // clipped away — three committed diagrams shipped with an invisible note.
  // Grow the canvas to fit, and shift everything right/down when a note went
  // negative, since an SVG cannot draw left of its own origin.
  let padX = 0, padY = 0, width = p.width;
  if (opts.notes?.length) {
    // Everything a note must not land on. The legend and titleblock are drawn
    // *after* notes but positioned from the final height, which is circular —
    // so reserve the strip they will occupy at the current bottom. A note that
    // still has to travel past it grows the canvas, and the footer follows the
    // new bottom, so it stays below the note either way.
    const ext = notes({ ...p, height }, rc, opts.notes, body);
    padX = Math.max(0, Math.ceil(-ext.minX) + (ext.minX < 0 ? 8 : 0));
    padY = Math.max(0, Math.ceil(-ext.minY) + (ext.minY < 0 ? 8 : 0));
    width = Math.max(width, Math.ceil(ext.maxX) + (ext.maxX > p.width ? 8 : 0)) + padX;
    height = Math.max(height, Math.ceil(ext.maxY) + (ext.maxY > height ? 8 : 0)) + padY;
  }

  // footer band: legend bottom-left, titleblock bottom-right; the titleblock
  // drops below the legend when the canvas is too narrow for both
  if (opts.legend || (opts.titleblock && Object.keys(opts.titleblock).length)) {
    const bandY = height - 8;
    const lg = opts.legend ? legend(p, rc, bandY, body) : { h: 0, w: 0 };
    // A legend wider than the canvas used to clip silently at the right edge;
    // grow the canvas instead. No existing view trips this (asserted by the
    // corpus gallery when it landed), so it is a safety net, not a reflow.
    width = Math.max(width, 16 + lg.w + 16);
    let bottom = bandY + lg.h;
    if (opts.titleblock && Object.keys(opts.titleblock).length) {
      const tb = titleblockDims(rc, opts.title, opts.titleblock, width);
      const beside = lg.w === 0 || 16 + lg.w + 24 + tb.w + 16 <= width;
      const ty = beside ? bandY : bottom + 8;
      titleblock(p, rc, ty, tb, opts.title, body);
      bottom = Math.max(bottom, ty + tb.h);
    }
    if (bottom > bandY) height = bottom + 16;
  }

  // A view that resolves to nothing laid out to 0×0, and `<svg width="0">` is
  // not a picture — resvg rejects it outright ("SVG has an invalid size"), so
  // `render` returned ok and `render -o x.png` then failed. An empty system is
  // the easy way in: `system p "P" { }` is legal, gets an auto view, and that
  // view has nothing in it. Emit a real (if blank) canvas instead, so the
  // output is always a valid image and the *diagnostic* is what tells you the
  // view is empty.
  width = Math.max(width, 64);
  height = Math.max(height, 64);

  const L: string[] = [];
  L.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${t.font.css}">`,
  );
  if (opts.embedFonts !== false) L.push(fontDefs(t));
  {
    // One rule per animate value in use, one keyframe per distinct motion, all
    // inside the single reduced-motion gate. Emission is by fixed order so the
    // string is deterministic — and when only `flow` is used, byte-identical
    // to what this block emitted before the vocabulary existed, which is what
    // keeps every already-committed render untouched.
    //
    // Dash periods and offsets must agree or the loop jumps: dashed 6+4=10 and
    // dotted 2+3=5 both divide the shared -10 offset; packets 3+15=18 gets its
    // own keyframe. Speeds reuse the flow keyframe at other durations —
    // constant px/s comes from fixed periods, never per-edge maths. `pulse`
    // animates `opacity` (not stroke-opacity) because a sync arrowhead is a
    // filled path and has to breathe with its wire.
    const used = new Set(p.edges.map((e) => e.animate).filter(Boolean));
    if (used.size) {
      const rules: string[] = [];
      const frames = new Map<string, string>();
      const flowKF = `@keyframes sq-flow{to{stroke-dashoffset:-10}}`;
      if (used.has("flow")) {
        rules.push(`.sq-flow{animation:sq-flow 0.9s linear infinite}`);
        frames.set("sq-flow", flowKF);
      }
      if (used.has("reverse")) {
        rules.push(`.sq-flow-r{animation:sq-flow-r 0.9s linear infinite}`);
        frames.set("sq-flow-r", `@keyframes sq-flow-r{to{stroke-dashoffset:10}}`);
      }
      if (used.has("slow")) {
        rules.push(`.sq-flow-s{animation:sq-flow 2.6s linear infinite}`);
        frames.set("sq-flow", flowKF);
      }
      if (used.has("fast")) {
        rules.push(`.sq-flow-f{animation:sq-flow 0.38s linear infinite}`);
        frames.set("sq-flow", flowKF);
      }
      if (used.has("packets")) {
        rules.push(`.sq-pk{animation:sq-pk 1.1s linear infinite}`);
        frames.set("sq-pk", `@keyframes sq-pk{to{stroke-dashoffset:-18}}`);
      }
      if (used.has("comet")) {
        // No rule — the per-edge inline style names this keyframe. Gating the
        // *definition* is what makes reduced-motion work: with the keyframe
        // undefined the inline animation resolves to nothing, and the dot stays
        // at opacity 0.
        frames.set("sq-comet", `@keyframes sq-comet{0%{offset-distance:0%;opacity:0}6%{opacity:1}94%{opacity:1}100%{offset-distance:100%;opacity:0}}`);
      }
      if (used.has("pulse")) {
        rules.push(`.sq-pulse{animation:sq-pulse 1.8s ease-in-out infinite}`);
        frames.set("sq-pulse", `@keyframes sq-pulse{0%,100%{opacity:1}50%{opacity:.3}}`);
      }
      L.push(
        `<style>@media (prefers-reduced-motion: no-preference){` +
          rules.join("") + [...frames.values()].join("") + `}</style>`,
      );
    }
  }
  L.push(`<rect width="${width}" height="${height}" fill="${t.canvas}"/>`);
  // only when something references it — a diagram of plain nodes should not
  // carry a gradient it never draws
  // A collected def comes back "" and lands in the caller's map instead; the
  // wrapping <defs> is only ours to emit when we are keeping them.
  const inline: string[] = [];
  if (p.nodes.some((n) => n.kind === "card")) inline.push(def(rc, ACCENT_GRAD, accentGradient()));
  if (p.nodes.some((n) => n.external)) inline.push(def(rc, rc.hatch, hatchPattern(rc.t, rc.hatch)));
  for (const d of inline) if (d) L.push(`<defs>${d}</defs>`);
  const defs = iconDefs(p, rc);
  if (defs) L.push(defs);
  if (padX || padY) L.push(`<g transform="translate(${padX}, ${padY})">`);
  L.push(...body);
  if (padX || padY) L.push(`</g>`);
  L.push(`</svg>`);
  return L.join("\n") + "\n";
}
