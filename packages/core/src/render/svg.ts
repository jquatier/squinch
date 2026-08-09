// Positioned + Theme (+ view annotations) → deterministic SVG string.
// Integers, LF, fixed attribute order — the string is the artifact under
// byte-identity tests.
import { fit, measure, wrapText } from "../metrics.js";
import { FONTS } from "../fonts.generated.js";
import { iconMeta, iconColor, packMonochrome, packFullBleed } from "../model/packs.js";
import { iconAsset, symbolId } from "../packs/registry.js";
import type { Theme } from "../themes/index.js";
// SHELF_H is layout's: the shelf is inside the card height it sets, so the
// strip the renderer fills and the room the card reserves are one number.
import { pillDims, NOTE_GUTTER, SHELF_H } from "../layout/layout.js";
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
/** Card/actor corner radius. Leaves use R_NODE; a container is the larger,
 *  softer shape, and the sheets behind it share the radius so the stack reads
 *  as three of the same object. */
const R_CARD = 8;
/** The artwork inside a PLATE-sized tile. The ring of tile around it is the
 *  point: it separates vendor art from whatever surface the node is drawn on. */
const ICON_ART = 26;
/** The card's own inner margin for anything hung off an edge — the glyph chip
 *  at the top right, the shelf's contents at both ends. One pixel tighter than
 *  PAD, because these sit against a border rather than against text, and the
 *  reference render is built to that rhythm (docs/design). */
const CARD_INSET = 11;
/** The bordered chip holding a card's kind glyph, top-right. Its column is
 *  reserved in `sizeOf`, so the label never runs under it. */
const GLYPH_CHIP = 26;

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
/** The card surface: a 4% ramp, top lighter. Theme-dependent, like the hatch,
 *  so it takes the same scope suffix when several palettes share a document. */
const SURFACE_GRAD = "sq-surface";
const ACTOR_GRAD = "sq-actor";
const surfaceGradient = (t: Theme, id: string) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">` +
  `<stop offset="0" stop-color="${t.surfaceHi}"/><stop offset="1" stop-color="${t.surfaceLo}"/>` +
  `</linearGradient>`;
/** The actor tile is filled rather than outlined, so its ramp sits a step
 *  darker than a card's — the fill *is* the shape, and at surface tones it
 *  would disappear into the canvas. */
const actorGradient = (t: Theme, id: string) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">` +
  `<stop offset="0" stop-color="${t.plate}"/><stop offset="1" stop-color="${t.actorLo}"/>` +
  `</linearGradient>`;
/** The 1px contact shadow. The alpha rides `flood-color` rather than
 *  `flood-opacity` on purpose: the adaptive merge only rewrites colour-valued
 *  attributes, so an opacity that differed between light and dark would read
 *  as geometry and be refused (render/adaptive.ts). resvg honours
 *  feDropShadow, so PNG export keeps it. */
const SHADOW = "sq-shadow";
const shadowFilter = (t: Theme, id: string) =>
  // `color-interpolation-filters="sRGB"` is load-bearing, not boilerplate. SVG
  // filters default to linearRGB, so a filtered element is converted to linear
  // space, filtered, and converted back — at 8 bits. Near white that costs
  // almost nothing; near black the linear encoding is so coarse that the round
  // trip flattens a subtle ramp into a few wide steps. The dark card's 4% ramp
  // spans nine levels, and the trip left five uneven ones with a six-level
  // cliff about three quarters down: the surface visibly "fell" rather than
  // shading. Filtering in sRGB keeps the gradient the renderer computed.
  `<filter id="${id}" x="-10%" y="-10%" width="130%" height="130%" color-interpolation-filters="sRGB">` +
  `<feDropShadow dx="0" dy="1" stdDeviation="1" flood-color="${t.shadow}"/>` +
  `</filter>`;
const accentGradient = () =>
  `<linearGradient id="${ACCENT_GRAD}" x1="0" y1="0" x2="0" y2="1">` +
  `<stop offset="0" stop-color="#C441FE"/><stop offset="1" stop-color="#15B6FF"/>` +
  `</linearGradient>`;

/** Everything the emitters need beyond geometry: theme and type. */
interface RC {
  t: Theme;
  /** the document face — narrower than FontFamily on purpose: `mono` is
   *  reached for per element, never as the body face layout measured with */
  fam: Theme["font"]["metrics"];
  fx: (px: number) => number; // theme-scaled font size
  /** `sq-hatch`, plus the document scope when one is set */
  hatch: string;
  /** the theme-dependent surface defs, scoped the same way as `hatch` */
  grad: string;
  actorGrad: string;
  shadow: string;
  /** when present, id-bearing defs go here instead of into this SVG */
  collect?: Map<string, string>;
  /** Faces this render actually drew with, beyond the two body weights every
   *  render carries. An emitter that reaches for a display weight or the mono
   *  face registers it here (`face()`), and only then is it embedded — a
   *  two-node diagram should not carry 21 KB of base64 for a title block it
   *  does not have. */
  faces: Set<string>;
}

/** The faces every render embeds: the document face at its two body weights.
 *  Kept unconditional because nearly every diagram draws both, and making
 *  them earned would churn every committed render for no bytes saved. */
const BASE_FACES = ["inter:400", "inter:500"];
/** Mono gets its own dedicated name for the same reason `SquinchInter` has
 *  one: the embedded face must win over whatever the page has installed, or
 *  text stops matching the metrics layout was computed from. */
const MONO_CSS = "SquinchMono, 'IBM Plex Mono', ui-monospace, monospace";

// Dedicated family names: guarantee the embedded face wins over any
// page-level font, so text width always matches the precomputed metrics.
/** The @font-face rules alone. Exported because the interactive HTML export
 *  hoists them into one <style> for the whole document instead of repeating
 *  33 KB of base64 in every view. One implementation of the rule either way.
 *
 *  `used` names extra `family:weight` faces to embed. The HTML export passes
 *  every face rather than a union of what its views drew: one document holds
 *  many views, any of which may be re-rendered client-side, so a hoisted set
 *  that happened to miss mono would silently fall back mid-navigation. */
export function fontFaceCSS(t: Theme, used: Iterable<string> = []): string {
  const cssName = (family: string) =>
    (family === "mono" ? MONO_CSS : t.font.css).split(",")[0];
  const face = (key: string) => {
    const [family, w] = key.split(":");
    const data = FONTS[family as keyof typeof FONTS]?.[w as "400"];
    if (!data) throw new Error(`no embedded face for ${key} — regenerate with gen-fonts`);
    return `@font-face{font-family:${cssName(family)};font-style:normal;font-weight:${w};` +
      `src:url(data:font/woff2;base64,${data}) format("woff2")}`;
  };
  // sorted so the string is a pure function of the set, and so the two body
  // weights keep leading — which is what keeps existing renders byte-identical
  return [...new Set([...BASE_FACES, ...used])].sort().map(face).join("");
}
/** Every face the bundle carries — the HTML export's hoisted set. */
export function allFaces(): string[] {
  return Object.entries(FONTS).flatMap(([f, ws]) => Object.keys(ws).map((w) => `${f}:${w}`));
}
function fontDefs(t: Theme, used: Iterable<string>): string {
  return `<style>${fontFaceCSS(t, used)}</style>`;
}

/** Crisp fill + stroke in one rect. `extra` lands on the same element. */
function box(
  _rc: RC,
  x: number, y: number, w: number, h: number, rx: number,
  fill: string, stroke: string, strokeW: number, extra = "",
): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeW}"${extra}/>`;
}

/** A vendor mark on the icon plate's corner (`badge:`, SPEC §nodes) — a 22px
 *  rounded-square surface plate overlapping the plate's bottom-right, held 5px
 *  clear of the card's interior edge, with the mark at 14px inside it.
 *
 *  Deliberately NOT iconPlate: the logos pack is monochrome, and iconPlate's
 *  monochrome branch draws a brand-coloured plate with a white knockout — the
 *  inverse of this treatment. Here the plate is quiet (surface + border) and
 *  the mark carries its own brand colour from the pack manifest. Colour-pack
 *  artwork
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

/** The card/leaf surface: a 4% top-to-bottom ramp instead of a flat fill, over
 *  a 1px contact shadow. Both are defs so the light and dark draws merge into
 *  one adaptive file — a gradient's stops and a shadow's `flood-color` are
 *  colour-valued, which is the only kind of attribute that may differ between
 *  the two palettes (render/adaptive.ts). */
function surfaceRect(
  rc: RC, x: number, y: number, w: number, h: number, rx: number,
): string {
  return (
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" ` +
    `fill="url(#${rc.grad})" stroke="${rc.t.border}" stroke-width="1" ` +
    `filter="url(#${rc.shadow})"/>`
  );
}

function leaf(n: PNode, rc: RC, opts: RenderOpts, dimmed: boolean, L: string[]) {
  const { t } = rc;
  const op = dimmed ? ` opacity="${DIM}"` : "";
  const ctx = n.kind === "context-leaf";
  L.push(`<g data-path="${esc(n.path)}" data-kind="${n.kind}"${op}>`);
  // A context leaf keeps the flat surface and the dashed border: it is
  // scenery, and scenery is not lit or lifted off the page.
  if (ctx) L.push(box(rc, n.x, n.y, n.w, n.h, R_NODE, t.surface, t.border, 1.5, ` stroke-dasharray="4 3"`));
  else L.push(surfaceRect(rc, n.x, n.y, n.w, n.h, R_NODE));
  if (n.external) L.push(hatched(rc, n.x, n.y, n.w, n.h, R_NODE));
  const px = n.x + PAD, py = n.y + PAD;
  L.push(iconTile(n.icon, px, py, rc, ctx));
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

/** The actor tile (docs/design): filled rather than outlined, so the human who
 *  starts the story separates from the services by shape before the icon is
 *  read. No border, a round avatar, and a caption where a service carries its
 *  description. */
function person(n: PNode, rc: RC, opts: RenderOpts, dimmed: boolean, L: string[]) {
  const { t } = rc;
  const op = dimmed ? ` opacity="${DIM}"` : "";
  L.push(`<g data-path="${esc(n.path)}" data-kind="${n.kind}"${op}>`);
  L.push(
    `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="${R_CARD}" ` +
    `fill="url(#${rc.actorGrad})" filter="url(#${rc.shadow})"/>`,
  );
  if (n.external) L.push(hatched(rc, n.x, n.y, n.w, n.h, R_CARD));
  // A disc, not a plate: round is the oldest shorthand for a person, and it
  // keeps the actor legible where the icon is a generic silhouette.
  const r = 17, cx = n.x + PAD + r, cy = n.y + Math.round(n.h / 2);
  L.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${t.plate}"/>`);
  // The mark goes on the disc bare — `iconPlate` would draw the monochrome
  // branch's own rounded square inside it, and a square plate centred in a
  // circle reads as a mistake rather than as an avatar. Colour-pack artwork
  // keeps its own palette, same as everywhere else.
  const asset = n.icon && iconAsset(n.icon.pack, n.icon.id);
  if (asset && n.icon)
    L.push(
      `<g color="${t.muted}"><use href="#${symbolId(n.icon.pack, n.icon.id)}" x="${cx - 10}" y="${cy - 10}" width="20" height="20"/></g>`,
    );
  const tx = n.x + PAD + r * 2 + PAD;
  const maxLabel = n.w - (tx - n.x) - PAD;
  const withDesc = opts.showDescriptions && n.description;
  L.push(
    `<text x="${tx}" y="${withDesc ? cy - 1 : cy + 5}" font-size="${rc.fx(13)}" font-weight="500" fill="${t.ink}">${esc(fit(n.label, maxLabel, rc.fx(13), "500", rc.fam))}</text>`,
  );
  if (withDesc)
    L.push(
      `<text x="${tx}" y="${cy + 15}" font-size="${rc.fx(11)}" fill="${t.muted}">${esc(fit(n.description!, maxLabel, rc.fx(11), "400", rc.fam))}</text>`,
    );
  L.push(`</g>`);
}

/** Two outline rects behind a container, offset back and down: "there is more
 *  inside", said by the shape, before anyone clicks.
 *
 *  Emitted as siblings *outside* the node's own group on purpose. The SPA's
 *  hover rule styles the group's first rect, and the dive animation measures
 *  the group's bounding box — sheets inside it would light the back sheet on
 *  hover and throw every zoom 8px off centre. */
function sheets(n: PNode, rc: RC, dimmed: boolean): string {
  const { t } = rc;
  // back sheet first, so the nearer one overlaps it
  return [{ d: 8, o: "0.5" }, { d: 4, o: "0.8" }]
    .map(({ d, o }) =>
      `<rect x="${n.x + d}" y="${n.y + d}" width="${n.w}" height="${n.h}" rx="${R_CARD}" ` +
      `fill="${t.sheetFill}" stroke="${t.sheetBorder}" stroke-width="1" opacity="${dimmed ? DIM : o}"/>`)
    .join("");
}

function card(n: PNode, rc: RC, dimmed: boolean, L: string[]) {
  const { t } = rc;
  const ctx = n.kind === "context-card";
  // one opacity, never two: dim wins over the context fade
  const op = dimmed ? ` opacity="${DIM}"` : ctx ? ` opacity="0.75"` : "";
  // A context card gets no sheets: it stands for somewhere else, and this view
  // is not the place to advertise diving into it.
  if (!ctx) L.push(sheets(n, rc, dimmed));
  L.push(`<g data-path="${esc(n.path)}" data-kind="${n.kind}"${op}>`);
  if (ctx) L.push(box(rc, n.x, n.y, n.w, n.h, R_CARD, t.surface, t.border, 1.5, ` stroke-dasharray="4 3"`));
  else L.push(surfaceRect(rc, n.x, n.y, n.w, n.h, R_CARD));
  // The spine: the brand ramp down the left edge, clipped to the card's own
  // radius so it turns the corner instead of squaring it off. Containers only
  // — a leaf has no inside, so it gets none of the affordances that imply one.
  // A context card keeps a muted one: the spine is what separates subject from
  // scenery, and colour is the cheapest way to say which is which.
  const clipId = `sq-cardclip-${n.w}-${n.h}`;
  L.push(def(rc, clipId,
    `<clipPath id="${clipId}"><rect x="0" y="0" width="${n.w}" height="${n.h}" rx="${R_CARD}"/></clipPath>`));
  const inCard = (markup: string) =>
    `<g transform="translate(${n.x},${n.y})" clip-path="url(#${clipId})">${markup}</g>`;
  L.push(inCard(`<rect x="0" y="0" width="3" height="${n.h}" fill="${ctx ? t.muted : `url(#${ACCENT_GRAD})`}"/>`));
  // The shelf: what is inside, along the bottom. It continues the card's own
  // surface (the gradient's lower tone) under a hairline, so it reads as one
  // object with a divided base rather than a card sitting on a bar. Drawn only
  // when it has something to hold — an empty strip is just a taller card.
  const hasShelf = !!(n.preview.length || n.more || n.domain);
  if (hasShelf)
    L.push(inCard(
      `<rect x="3" y="${n.h - SHELF_H}" width="${n.w - 3}" height="${SHELF_H}" fill="${t.surfaceLo}"/>` +
      `<line x1="3" y1="${n.h - SHELF_H}" x2="${n.w}" y2="${n.h - SHELF_H}" stroke="${t.shelfLine}" stroke-width="1"/>`,
    ));
  // Hatch last of the surfaces, so "someone else's" covers the shelf too — it
  // is one card, and a texture that stopped at the shelf line read as a gap.
  if (n.external) L.push(hatched(rc, n.x, n.y, n.w, n.h, R_CARD));
  // The card's own mark, on the tile a leaf's icon sits on. The header row is
  // top-aligned in the body it shares with the shelf; with no shelf there is
  // no body to share, so it centres instead of leaving the bottom half empty.
  const bodyH = hasShelf ? n.h - SHELF_H : n.h;
  const px = n.x + PAD + 5, py = n.y + Math.round((bodyH - PLATE) / 2);
  if (n.icon) L.push(iconTile(n.icon, px, py, rc, ctx));
  const tx = n.icon ? px + PLATE + PAD : n.x + PAD + 6;
  // the glyph chip's column is reserved whether or not one is drawn, so a long
  // label never runs under it
  const maxText = n.x + n.w - CARD_INSET - GLYPH_CHIP - PAD - tx;
  // Baselines hang off the tile's centre line, so the title/tagline pair reads
  // as one block beside the icon rather than starting at an arbitrary height.
  // Alone, the title takes the centre itself.
  const mid = py + PLATE / 2;
  L.push(
    `<text x="${tx}" y="${n.tagline ? mid - 2 : mid + 5}" font-size="${rc.fx(15)}" font-weight="500" fill="${ctx ? t.muted : t.ink}">${esc(fit(n.label, maxText, rc.fx(15), "500", rc.fam))}</text>`,
  );
  if (n.tagline)
    L.push(
      `<text x="${tx}" y="${mid + 13}" font-size="${rc.fx(11)}" fill="${t.muted}">${esc(fit(n.tagline, maxText + GLYPH_CHIP, rc.fx(11), "400", rc.fam))}</text>`,
    );
  if (n.glyph) {
    // A bordered chip, not a bare mark: the glyph says what kind of thing the
    // card is, and the chip is what makes it read as a label rather than as
    // part of the card's own artwork.
    const gx = n.x + n.w - CARD_INSET - GLYPH_CHIP, gy = n.y + 10;
    const asset = iconAsset(n.glyph.pack, n.glyph.id);
    const meta = iconMeta(n.glyph.pack, n.glyph.id);
    if (asset || meta)
      L.push(
        `<rect x="${gx}" y="${gy}" width="${GLYPH_CHIP}" height="${GLYPH_CHIP}" rx="5" fill="${t.surface}" stroke="${t.border}" stroke-width="1"/>`,
      );
    if (asset)
      L.push(
        `<g color="${t.muted}"><use href="#${symbolId(n.glyph.pack, n.glyph.id)}" x="${gx + 5}" y="${gy + 5}" width="16" height="16"/></g>`,
      );
    else if (meta)
      L.push(
        `<text x="${gx + GLYPH_CHIP / 2}" y="${gy + 17}" text-anchor="middle" font-size="${rc.fx(10)}" font-weight="500" fill="${t.muted}">${esc(meta.code)}</text>`,
      );
  }
  // Shelf contents. The bed itself went down with the surface, above.
  if (hasShelf) {
    const sy = n.y + n.h - SHELF_H;
    let ix = n.x + CARD_INSET;
    for (const icon of n.preview) {
      L.push(iconPlate(icon, ix, sy + 7, 16, rc, ctx));
      ix += 22; // 16 of icon + a 6 gap, the shelf's rhythm
    }
    if (n.more) {
      const label = `+${n.more}`;
      L.push(
        `<text x="${ix}" y="${sy + 19}" font-size="${rc.fx(11)}" font-weight="500" fill="${t.muted}">${label}</text>`,
      );
      ix += Math.ceil(measure(label, rc.fx(11), "500", rc.fam));
    }
    // The chip takes the room the icons left, not a share of the card: sizing
    // it against half the width let a long domain slide left over the `+N` it
    // was supposed to sit beside. Below MIN_DOMAIN there is no room worth
    // taking — two letters and an ellipsis name nothing — so it steps aside
    // and the icons keep the shelf.
    const MIN_DOMAIN = 44;
    if (n.domain) {
      // ceil, not round: a label measuring 51.05 rounds its chip down to 51
      // and then `fit` ellipsizes the text against its own chip
      const natural = Math.ceil(measure(n.domain, rc.fx(11), "400", rc.fam)) + 12;
      const room = n.x + n.w - CARD_INSET - (ix + 8);
      const dw = Math.min(natural, room);
      if (dw >= MIN_DOMAIN) {
      const dx = n.x + n.w - CARD_INSET - dw;
      L.push(
        // a hairline, because the chip's fill is a couple of percent off the
        // shelf it sits on — quiet by design, but without an edge it read as
        // floating text rather than as a tag
        `<rect x="${dx}" y="${sy + 6}" width="${dw}" height="18" rx="2" fill="${t.plate}" stroke="${t.border}" stroke-width="1"/>` +
        `<text x="${dx + 6}" y="${sy + 19}" font-size="${rc.fx(11)}" fill="${t.muted}">${esc(fit(n.domain, dw - 12, rc.fx(11), "400", rc.fam))}</text>`,
      );
      }
    }
  }
  L.push(`</g>`);
}

/** The 11px mark a note opens with. It carries the job the amber fill used to
 *  do — "this is commentary, not a diagram object" — without spending a third
 *  hue on it. An authored `style: warning` keeps its distinction here rather
 *  than in the plate: same neutral note, a triangle instead of an i, which is
 *  the difference a reader is scanning for anyway.
 *
 *  Drawn from primitives rather than pulled from a pack: a note is chrome, and
 *  chrome that depended on an installed pack would vanish from a diagram that
 *  happens not to use one. */
function noteGlyph(x: number, y: number, warn: boolean, rc: RC): string {
  const stroke = ` fill="none" stroke="${rc.t.faint}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"`;
  return warn
    ? `<g${stroke}><path d="M${x + 5.5} ${y + 0.6} L${x + 10.8} ${y + 9.9} L${x + 0.2} ${y + 9.9} Z"/>` +
      `<path d="M${x + 5.5} ${y + 4} L${x + 5.5} ${y + 6.4}"/><path d="M${x + 5.5} ${y + 8.2} L${x + 5.5} ${y + 8.3}"/></g>`
    : `<g${stroke}><circle cx="${x + 5.5}" cy="${y + 5.5}" r="4.9"/>` +
      `<path d="M${x + 5.5} ${y + 5} L${x + 5.5} ${y + 8}"/><path d="M${x + 5.5} ${y + 3.2} L${x + 5.5} ${y + 3.3}"/></g>`;
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
    // One plate for every note. The amber `warning` fill is retired here
    // (docs/design: the only third hue in a two-hue palette, and it read as a
    // sticky note stuck onto the diagram rather than as part of it) — and the
    // distinction it carried moves to the glyph below in the same change, so
    // an authored `style: warning` is never silently dropped.
    const warn = note.style === "warning";
    const id = note.anchor.kind === "relpos"
      ? `${note.anchor.relpos}:${note.anchor.target}`
      : note.anchor.kind === "edge"
        ? `on:${note.anchor.from}->${note.anchor.to}`
        : note.anchor.corner;
    L.push(`<g data-note="${esc(id)}">`);
    if (n.leader)
      L.push(
        `<line x1="${n.leader.x1}" y1="${n.leader.y1}" x2="${n.leader.x2}" y2="${n.leader.y2}" stroke="${t.border}" stroke-width="1" stroke-dasharray="2 3"/>`,
      );
    L.push(
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${t.surface}" ` +
      `stroke="${t.border}" stroke-width="1" filter="url(#${rc.shadow})"/>`,
    );
    L.push(noteGlyph(x + 12, y + 11, warn, rc));
    lines.forEach((line, i) =>
      L.push(
        `<text x="${x + 12 + NOTE_GUTTER}" y="${y + 17 + i * 15}" font-size="${rc.fx(11)}" fill="${t.ink}">${esc(line)}</text>`,
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
      sample: (x, cy) => `<line x1="${x}" y1="${cy}" x2="${x + 24}" y2="${cy}" stroke="${t.asyncEdge}" stroke-width="1.5" stroke-dasharray="6 5"/>`,
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
        `<line x1="${x}" y1="${cy}" x2="${x + 24}" y2="${cy}" stroke="${t.edge}" stroke-width="1.5" stroke-dasharray="${st === "dashed" ? "6 5" : "2 3"}"/>`,
      label: st,
    });
  if (p.edges.some((e) => e.count > 1))
    items.push({
      sample: (x, cy) =>
        `<line x1="${x}" y1="${cy}" x2="${x + 24}" y2="${cy}" stroke="${t.edge}" stroke-width="1.5"/>` +
        `<text x="${x + 12}" y="${cy - 4}" text-anchor="middle" font-size="${rc.fx(9)}" fill="${t.muted}">×n</text>`,
      label: "aggregated",
    });
  // The two affordances the restyle added, each earned the same way as the
  // rest: a diagram with no container never explains diving, and one with no
  // actor never explains the filled tile.
  if (p.nodes.some((n) => n.kind === "card"))
    items.push({
      sample: (x, cy) =>
        `<rect x="${x + 5}" y="${cy - 5}" width="14" height="10" rx="2" fill="url(#${ACCENT_GRAD})"/>`,
      label: "dive in",
    });
  if (p.nodes.some((n) => n.kind === "person"))
    items.push({
      sample: (x, cy) =>
        `<rect x="${x + 5}" y="${cy - 5}" width="14" height="10" rx="2" fill="${t.plate}" stroke="${t.border}" stroke-width="1"/>`,
      label: "actor",
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
        `<text x="${x + 12}" y="${cy + 3}" text-anchor="middle" font-size="${rc.fx(9)}" font-weight="500" fill="${t.beadText}">1</text>`,
      label: `flow: ${p.flow.label}`,
    });
  // zone kinds present in this render, in kind-list order, deduped
  const kindsPresent = [...new Set((p.zones ?? []).map((z) => z.kind))];
  for (const kind of kindsPresent) {
    const col = ZONE_TINT[kind](t);
    items.push({
      sample: (x, cy) =>
        `<rect x="${x + 2}" y="${cy - 7}" width="20" height="14" rx="2" fill="none" stroke="${col}" stroke-width="1" stroke-dasharray="4 3"/>`,
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

/** Reserved keys the meta chip lays out in a fixed order, each in its own
 *  segment. Everything else an author writes follows in declaration order —
 *  nothing is dropped, because a titleblock is free-form by design and the
 *  corpus already carries `owner` and `status`. */
const META_ORDER = ["version", "commit", "date"];

/** The header block: name, subtitle, and a segmented meta chip. Top-left,
 *  where a drawing's identity belongs — it used to sit bottom-right, which put
 *  the two things a reader needs first (what is this, which version) in the
 *  last place they look. Returns the band's height so the body can shift. */
function headerDims(rc: RC, title: string | undefined, kv: Record<string, string>) {
  if (!title && !Object.keys(kv).length) return { h: 0, segs: [] as [string, string][], chipW: 0 };
  const known = new Set([...META_ORDER, "subtitle"]);
  const segs: [string, string][] = [
    ...META_ORDER.filter((k) => kv[k]).map((k) => [k, kv[k]] as [string, string]),
    ...Object.entries(kv).filter(([k]) => !known.has(k)),
  ];
  // A reserved key's value speaks for itself — `v4.2`, `a41f0c2`, a date. An
  // arbitrary one does not: `platform` alone says nothing, so `owner platform`
  // is what goes in the segment. Losing the key would be losing the fact.
  const segW = (k: string, v: string) =>
    Math.ceil(measure(v, rc.fx(10.5), k === "commit" ? "400" : "500", k === "commit" ? "mono" : rc.fam)) +
    (META_ORDER.includes(k) ? 0 : Math.ceil(measure(`${k} `, rc.fx(10.5), "400", rc.fam))) + 14;
  const chipW = segs.length ? segs.reduce((a, [k, v]) => a + segW(k, v), 0) : 0;
  const h = (title ? 24 : 0) + (kv.subtitle ? 16 : 0) + (segs.length ? 28 : 0);
  return { h, segs, chipW };
}

function header(
  rc: RC, x: number, y: number, title: string | undefined, kv: Record<string, string>,
  dims: ReturnType<typeof headerDims>, L: string[],
): void {
  const { t } = rc;
  let ty = y;
  if (title) {
    // -.01em: at 19px the default tracking reads loose against the 11.5px
    // subtitle under it. Negative, so the measured width is an overestimate
    // and nothing it is fitted against can overflow.
    ty += 18;
    L.push(
      `<text x="${x}" y="${ty}" font-size="${rc.fx(19)}" font-weight="600" letter-spacing="-.01em" fill="${t.ink}">${esc(title)}</text>`,
    );
    rc.faces.add("inter:600");
    ty += 6;
  }
  if (kv.subtitle) {
    ty += 12;
    L.push(
      `<text x="${x}" y="${ty}" font-size="${rc.fx(11.5)}" fill="${t.muted}">${esc(kv.subtitle)}</text>`,
    );
    ty += 4;
  }
  if (!dims.segs.length) return;
  // The meta chip: one hairline-bordered strip, segments in alternating tints
  // so version / commit / date read as separate facts rather than a sentence.
  // Clipped to the strip's radius, so a bed at either end takes the corner.
  ty += 8;
  const clip = `sq-meta-${dims.chipW}`;
  L.push(def(rc, clip, `<clipPath id="${clip}"><rect x="0" y="0" width="${dims.chipW}" height="20" rx="3"/></clipPath>`));
  const inChip: string[] = [];
  let sx = 0;
  for (const [i, [k, v]] of dims.segs.entries()) {
    const mono = k === "commit";
    const named = !META_ORDER.includes(k);
    const keyW = named ? Math.ceil(measure(`${k} `, rc.fx(10.5), "400", rc.fam)) : 0;
    const w = Math.ceil(measure(v, rc.fx(10.5), mono ? "400" : "500", mono ? "mono" : rc.fam)) + keyW + 14;
    if (i % 2) inChip.push(`<rect x="${sx}" y="0" width="${w}" height="20" fill="${t.plate}"/>`);
    if (named)
      inChip.push(
        `<text x="${sx + 7}" y="14" font-size="${rc.fx(10.5)}" fill="${t.faint}">${esc(k)}</text>`,
      );
    // the date is the least urgent of the three reserved facts, and reads so
    const ink = k === "date" ? t.faint : t.muted;
    inChip.push(
      `<text x="${sx + 7 + keyW}" y="14" font-size="${rc.fx(10.5)}"` +
      (mono ? ` font-family="${MONO_CSS}"` : ` font-weight="500"`) +
      ` fill="${ink}">${esc(v)}</text>`,
    );
    if (mono) rc.faces.add("mono:400");
    sx += w;
  }
  L.push(
    `<g transform="translate(${x},${ty})">` +
    `<rect x="0" y="0" width="${dims.chipW}" height="20" rx="3" fill="${t.surface}"/>` +
    `<g clip-path="url(#${clip})">${inChip.join("")}</g>` +
    `<rect x="0" y="0" width="${dims.chipW}" height="20" rx="3" fill="none" stroke="${t.border}" stroke-width="1"/></g>`,
  );
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

/** Tints of the zone's own colour, as 8-digit hex. The chip is built from one
 *  hue at three strengths — border, label bed, detail bed — so a boundary's
 *  identity carries across every segment without a second colour entering the
 *  palette. Alpha in the fill (not `fill-opacity`) keeps the adaptive merge
 *  treating these as colour rather than geometry. */
const CHIP_BORDER_A = "59"; // 35%
const CHIP_LABEL_A = "1F"; // 12%
const CHIP_DETAIL_A = "33"; // 20%

function chipMarkup(c: Positioned["chips"][number], p: Positioned, rc: RC, t: Theme): string {
  const zone = (p.zones ?? []).find((z) => z.id === c.zone);
  const col = zone ? zoneColor(zone, t) : t.muted;
  // halo first: a canvas knockout 3px proud of the chip, so any edge the chip
  // must sit over reads as deliberately interrupted, never collided-with
  const halo = `<rect x="${c.x - 3}" y="${c.y - 3}" width="${c.w + 6}" height="${c.h + 6}" rx="4" fill="${t.canvas}"/>`;
  // Border only, and drawn last: the segment beds are painted underneath it,
  // so a filled chip rect here would erase them. The halo above already lays
  // the canvas knockout this sits on.
  const chip = `<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" rx="3" fill="none" stroke="${col}${CHIP_BORDER_A}" stroke-width="1"/>`;
  // the icon is a flush, full-height tab on the chip's left edge — the AWS
  // boundary-label convention — never a padded thumbnail floating in the pill.
  // Full-bleed artwork (k8s) is the exception: drawn edge-to-edge it collides
  // with the chip border, so it gets a small inset inside the same tab slot —
  // the text position never moves.
  const inset = c.icon && packFullBleed(c.icon.pack) ? 3 : 0;
  // A square tab, and the label bed starts where it ends — no gap. The tab
  // used to be `c.h + 4` wide while the artwork filled only `c.h`, so 4px of
  // the canvas knockout showed between icon and bed as a white sliver.
  const iconTab = c.icon ? c.h : 0;
  const icon = c.icon
    ? iconPlate(c.icon, c.x + inset, c.y + inset, c.h - 2 * inset, rc)
    : "";
  const tx = c.x + 8 + iconTab;
  // Segments are clipped to the chip's rounded rect so a bed reaching an end
  // takes the corner with it — a square bed inside a 3px radius shows as two
  // pale wedges at that end.
  const clip = `sq-chip-${c.x}-${c.y}-${c.w}-${c.h}`;
  const clipDef = def(rc, clip,
    `<clipPath id="${clip}"><rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" rx="3"/></clipPath>`);
  // clip-path on the rects themselves, not a wrapping <g>: the beds are plain
  // rects (the "clip a wrapping g" rule is about `<use>`), and a nested group
  // here would hide the icon from anything reading the chip as one element.
  const clipped = ` clip-path="url(#${clip})"`;
  // The tab is its own quiet step (docs/design): the icon sits on surface, not
  // on the canvas the chip floats over, so a transparent mark reads against a
  // plate rather than against whatever the chip happens to cover.
  const iconBed = c.icon
    ? `<rect x="${c.x}" y="${c.y}" width="${iconTab}" height="${c.h}"${clipped} fill="${t.surface}"/>`
    : "";
  const labelBed = `<rect x="${c.x + iconTab}" y="${c.y}" width="${c.w - iconTab - (c.detailW ?? 0)}" height="${c.h}"${clipped} fill="${col}${CHIP_LABEL_A}"/>`;
  const detail = c.detail
    ? `<rect x="${c.x + c.w - c.detailW!}" y="${c.y}" width="${c.detailW!}" height="${c.h}"${clipped} fill="${col}${CHIP_DETAIL_A}"/>` +
      // mono, because this segment is where digits live and a CIDR read in a
      // proportional face is a different width in every diagram
      `<text x="${c.x + c.w - c.detailW! + 8}" y="${c.y + 15}" font-size="${rc.fx(11)}" font-family="${MONO_CSS}" fill="${col}">${esc(c.detail)}</text>`
    : "";
  if (c.detail) rc.faces.add("mono:400");
  return (
    `${clipDef}<g data-kind="zone-chip" data-zone="${esc(c.zone)}">${halo}` +
    `${iconBed}${labelBed}${detail}${chip}${icon}` +
    `<text x="${tx}" y="${c.y + 15}" font-size="${rc.fx(11)}" font-weight="500" fill="${col}">${esc(c.label)}</text></g>`
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
 *  The pack art is verbatim — nothing here recolours or restyles it. */
/** A node's main icon: the artwork at ICON_ART on a neutral tile of PLATE
 *  (docs/design). The tile is what keeps a pack mark from sitting straight on
 *  the card surface — vendor artwork is drawn on white in its own guidelines,
 *  and against a gradient it reads as pasted on. `iconPlate` still draws the
 *  mark itself, so monochrome packs keep their brand-coloured knockout. */
function iconTile(
  icon: { pack: string; id: string } | undefined,
  x: number, y: number, rc: RC, soften = false,
): string {
  const { t } = rc;
  const inset = Math.round((PLATE - ICON_ART) / 2);
  const tile = `<rect x="${x}" y="${y}" width="${PLATE}" height="${PLATE}" rx="6" fill="${t.plate}"${soften ? ` opacity="0.6"` : ""}/>`;
  const asset = icon ? iconAsset(icon.pack, icon.id) : undefined;
  const mono = icon && (icon.pack === "builtin" || packMonochrome(icon.pack));
  if (asset && icon && mono) {
    // A single-colour mark goes straight onto the tile. `iconPlate` would draw
    // its own brand-coloured plate with the mark knocked out — right when the
    // mark stands alone, wrong here, where it nests a rounded rect inside a
    // rounded rect. Same reasoning as the node badge: quiet plate, mark in its
    // own colour (`fill` as well as `color`, because vendored marks carry no
    // fill and would default to black).
    //
    // Whose colour, though, depends on whose mark it is. `iconColor` is
    // defined only for packs that publish one, so a trademark keeps its brand
    // hue while our own vocabulary (builtin, sys) follows the theme — those
    // manifests carry no colour and used to inherit a hardcoded light grey,
    // which went dim the moment the canvas did.
    const brand = iconColor(icon.pack, icon.id);
    const ink = brand ?? t.muted;
    // A brand hue is fixed, so the surface under it is what moves. GitHub's
    // near-black on the dark theme's tile is a 1.4:1 smudge, and recolouring
    // someone's trademark is not an option — so every branded mark sits on the
    // white plate its own guidelines assume. Unconditionally, not by contrast
    // test: a rule that flipped per icon would put a white tile beside a dark
    // one in the same row and read as a bug rather than as a policy.
    const bed = brand ? t.brandPlate : t.plate;
    return (
      `<rect x="${x}" y="${y}" width="${PLATE}" height="${PLATE}" rx="6" fill="${bed}"${soften ? ` opacity="0.6"` : ""}/>` +
      `<g color="${ink}" fill="${ink}"${soften ? ` opacity="0.6"` : ""}>` +
      `<use href="#${symbolId(icon.pack, icon.id)}" x="${x + inset}" y="${y + inset}" width="${ICON_ART}" height="${ICON_ART}"/>` +
      `</g>`
    );
  }
  return tile + iconPlate(icon, x + inset, y + inset, ICON_ART, rc, soften);
}

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
    faces: new Set<string>(),
    hatch: `${HATCH}${opts.defsScope ?? ""}`,
    grad: `${SURFACE_GRAD}${opts.defsScope ?? ""}`,
    actorGrad: `${ACTOR_GRAD}${opts.defsScope ?? ""}`,
    shadow: `${SHADOW}${opts.defsScope ?? ""}`,
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
  // An endpoint can be an expanded frame rather than a node (the edge attaches
  // to the compound border). A frame holds members of many tags, so it never
  // blocks its edge — the leaf end decides.
  const endpointMatches = (path: string) => {
    const n = byPath.get(path);
    return n ? nodeMatches(n) : true;
  };
  const edgeMatches = (e: PEdge) =>
    (hl.length === 0 ||
      e.tags.some((tag) => hl.includes(tag)) ||
      (endpointMatches(e.from) && endpointMatches(e.to))) &&
    edgeReached(e);

  const body: string[] = [];

  // zone boundaries first — the classic dashed deployment frame, behind
  // everything, outermost first (DESIGN §5). Kind picks the tint. The label
  // chips render LAST (top layer, after edges) so their canvas halo knocks
  // out anything they must sit over — see placeZoneChips below.
  const zoneMarkup = (z: PZone): string => {
    const col = zoneColor(z, t);
    const dash = ` stroke-dasharray="8 5"`;
    // No fill, deliberately: a tint compounds where zones nest, so a subnet
    // inside a VPC read darker than either — the boundary is the dashed line,
    // and nesting must not change its weight (docs/design).
    const boundary = `<rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" rx="8" fill="none" stroke="${col}" stroke-width="1.5"${dash}/>`;
    return `<g data-kind="zone" data-zone="${esc(z.id)}" data-zone-kind="${z.kind}">${boundary}</g>`;
  };
  for (const z of [...(p.zones ?? [])].sort((a, b) => a.depth - b.depth)) body.push(zoneMarkup(z));

  // container frames first — recessed surface behind everything (DESIGN §5)
  for (const f of p.frames) {
    body.push(
      `<rect data-path="${esc(f.path)}" data-kind="frame" x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="8" fill="${t.surfaceAlt}" stroke="${t.border}" stroke-width="1"/>`,
    );
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
      : e.style === "dashed" ? "6 5"
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
        `<path${anim} d="${d}" fill="none" stroke="${col}" stroke-width="${weight}"${dash}/>`,
      );
    }
    if (e.animate === "comet") {
      // The dot rides the *unsplit* route. Hop splitting exists to break the
      // stroke where two edges cross; the traveller has no such problem, and a
      // dot sailing over the gap is what a reader expects.
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
    else if (n.kind === "person") person(n, rc, opts, dimmed, body);
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
        // beadText, not plateText: the dark theme's bead is a pale lavender
        // disc, and white-on-lavender is unreadable at 10px (docs/design)
        `<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="${rc.fx(10)}" font-weight="500" fill="${t.beadText}">${esc(text)}</text></g>`,
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
  // The header sits above everything, so the body shifts down by its height —
  // the same padY machinery notes already use for a diagram that grew upward.
  const hd = headerDims(rc, opts.title, opts.titleblock ?? {});
  const headerH = hd.h ? hd.h + 22 : 0;
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

  // Chrome — the header above the diagram, the footer band below it — is drawn
  // in canvas coordinates, not the body's. The body is translated (a note can
  // push it right and down), and chrome that rode along would slide with it: a
  // full-width band starting 8px in, a header 8px off the corner.
  const chrome: string[] = [];
  const contentH = height;
  const wordmark = "squinch";
  if (headerH) {
    header(rc, 18, 14, opts.title, opts.titleblock ?? {}, hd, chrome);
    width = Math.max(width, hd.chipW + 36);
  }

  // The band exists to carry the legend; the wordmark rides it. Tying it to
  // the header instead would put an otherwise-empty strip under any diagram
  // that merely named itself — a signature looking for a reason to be there.
  let bandH = 0;
  if (opts.legend) {
    const bandY = headerH + contentH;
    const lg = opts.legend ? legend(p, rc, bandY + 5, chrome) : { h: 0, w: 0 };
    // +.02em over seven characters is ~1.5px the metrics table cannot see;
    // reserve it so the mark never sits closer to the edge than intended
    const markW = Math.ceil(measure(wordmark, rc.fx(10.5), "500", rc.fam)) + 2;
    // A legend wider than the canvas used to clip silently at the right edge;
    // grow the canvas instead.
    width = Math.max(width, 18 + lg.w + 24 + markW + 18);
    bandH = Math.max(lg.h, 24) + 10;
    // Unshifted so the band lands *under* the legend already drawn into
    // `chrome`, and the whole of chrome lands over the body.
    chrome.unshift(
      `<rect x="0" y="${bandY}" width="${width}" height="${bandH}" fill="${t.canvas}"/>` +
      `<line x1="0" y1="${bandY}" x2="${width}" y2="${bandY}" stroke="${t.border}" stroke-width="1"/>` +
      `<text x="${width - 18}" y="${bandY + Math.round(bandH / 2) + 4}" text-anchor="end" ` +
      `font-size="${rc.fx(10.5)}" font-weight="500" letter-spacing=".02em" fill="${t.dim}">${wordmark}</text>`,
    );
  }
  height = headerH + contentH + bandH;

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
  if (opts.embedFonts !== false) L.push(fontDefs(t, rc.faces));
  {
    // One rule per animate value in use, one keyframe per distinct motion, all
    // inside the single reduced-motion gate. Emission is by fixed order so the
    // string is deterministic — and when only `flow` is used, byte-identical
    // to what this block emitted before the vocabulary existed, which is what
    // keeps every already-committed render untouched.
    //
    // The drift offset must be a whole number of dash periods, or the pattern
    // visibly jumps each time the animation loops. One class carries every
    // pattern (a dashed edge and a dotted one can both be `animate: flow`), so
    // the offset is the least common multiple of the periods it has to serve:
    // dashed 6+5=11 and dotted 2+3=5 → 55. Shifting by five dashed periods
    // looks exactly like shifting by one, so the longer cycle is invisible;
    // what it buys is a seamless loop for both patterns from one keyframe.
    // Durations are then derived from the speed the vocabulary promises rather
    // than restated — px/s is the constant, so a long edge never appears to
    // flow faster than a short one. Adding a pattern means revisiting DRIFT.
    // `packets` keeps its own keyframe (period 18, its own sparse rhythm), and
    // `pulse` animates `opacity` (not stroke-opacity) because a sync arrowhead
    // is a filled path and has to breathe with its wire.
    const used = new Set(p.edges.map((e) => e.animate).filter(Boolean));
    if (used.size) {
      const rules: string[] = [];
      const frames = new Map<string, string>();
      const DRIFT = 55;
      /** seconds for one cycle at the given speed, rounded like every other
       *  float that reaches the string (2dp — CI byte-compares this) */
      const secs = (pxPerSec: number) => (Math.round((DRIFT / pxPerSec) * 100) / 100).toFixed(2);
      const flowKF = `@keyframes sq-flow{to{stroke-dashoffset:-${DRIFT}}}`;
      if (used.has("flow")) {
        rules.push(`.sq-flow{animation:sq-flow ${secs(11.11)}s linear infinite}`);
        frames.set("sq-flow", flowKF);
      }
      if (used.has("reverse")) {
        rules.push(`.sq-flow-r{animation:sq-flow-r ${secs(11.11)}s linear infinite}`);
        frames.set("sq-flow-r", `@keyframes sq-flow-r{to{stroke-dashoffset:${DRIFT}}}`);
      }
      if (used.has("slow")) {
        rules.push(`.sq-flow-s{animation:sq-flow ${secs(3.85)}s linear infinite}`);
        frames.set("sq-flow", flowKF);
      }
      if (used.has("fast")) {
        rules.push(`.sq-flow-f{animation:sq-flow ${secs(26.32)}s linear infinite}`);
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
  if (p.nodes.some((n) => n.kind === "card" || n.kind === "context-card"))
    inline.push(def(rc, ACCENT_GRAD, accentGradient()));
  // Every lit surface shares one gradient and one shadow; a diagram of only
  // context cards draws neither, and pays for neither.
  const lit = p.nodes.some((n) => n.kind === "card" || n.kind === "leaf");
  if (lit) inline.push(def(rc, rc.grad, surfaceGradient(rc.t, rc.grad)));
  if (p.nodes.some((n) => n.kind === "person"))
    inline.push(def(rc, rc.actorGrad, actorGradient(rc.t, rc.actorGrad)));
  if (lit || p.nodes.some((n) => n.kind === "person") || (p.notes ?? []).length)
    inline.push(def(rc, rc.shadow, shadowFilter(rc.t, rc.shadow)));
  if (p.nodes.some((n) => n.external)) inline.push(def(rc, rc.hatch, hatchPattern(rc.t, rc.hatch)));
  for (const d of inline) if (d) L.push(`<defs>${d}</defs>`);
  const defs = iconDefs(p, rc);
  if (defs) L.push(defs);
  if (padX || padY || headerH) L.push(`<g transform="translate(${padX}, ${padY + headerH})">`);
  L.push(...body);
  if (padX || padY || headerH) L.push(`</g>`);
  L.push(...chrome);
  L.push(`</svg>`);
  return L.join("\n") + "\n";
}
