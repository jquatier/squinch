// The README's hero animation: a landscape diagram, a dive into a system and
// back out, then the same into a second one — two round trips, because one
// dive shows a zoom and two show that the altitude belongs to the model rather
// than to a particular diagram. A third act closes the argument: the full
// view (`expand *`) opens every system at once, arriving as the app's own
// lateral cut — sibling views crossfade rather than dive, there being no card
// to anchor on (docs/notes/zoom-transitions.md). The view bar rides the top as
// it does in the app, following every move, and home is how the pointer
// comes back out.
//
// Maintainer-only, macOS/Linux: needs ffmpeg on PATH. `NODE_OPTIONS=--expose-gc`
// keeps memory flatter still — see the frame loop.
//
// Generated, never screen-recorded — the frames are the real renderer's output,
// so the GIF cannot drift from what the tool actually draws, and it can be
// regenerated after any visual change. It has already earned that twice: once
// when the wordmark moved (it has since left), and once when system cards took the brand gradient.
//
//   npx tsx scripts/hero-gif.mts
//
// Requires ffmpeg (maintainer machines only; never runs in CI).
//
// The motion is the app's own, re-derived rather than re-implemented: same
// anchored dive as apps/spa/src/Stage.tsx, same constants, same easing. Both
// altitudes move about the one card they have in common, so the eye tracks it
// through the cut — see docs/notes/zoom-transitions.md.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderProject, themes, buildModel } from "../packages/core/dist/index.js";
import { svgToPng } from "../packages/cli/src/raster.js";
import { TRAVEL, scaleFor, viewBar, viewIndex, type Box, type NavView } from "../packages/core/dist/index.js";
import { measure } from "../packages/core/dist/metrics.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = (theme: string) => join(root, `docs/assets/zoom-${theme}.gif`);
const tmp = join(root, ".hero-tmp");

/** The systems the pointer opens, in order — dive in, come back up, dive into
 *  the next. Each must be a top-level system with a view of its own: the card
 *  is the anchor and the view is what the dive lands in. Two of them is the
 *  point, not decoration — one dive shows a zoom, two show that the altitude
 *  is a property of the *model* and any system has one. */
const SYSTEMS = ["catalog", "accounts"];

/** Canvas. Wide enough for a landscape to read in a README column. */
const W = 900, H = 620, PAD = 28;
/** Vertical breathing room is tighter than horizontal: the artboards are wider
 *  than they are tall, so height is the binding constraint and every pixel of
 *  vertical padding shrinks the diagram. */
const PAD_V = 14;
/** The view bar floats along the top, as it does over the playground's stage.
 *  The stage is what is left below it: the artwork is centred, so there is no
 *  corner it reliably avoids, and a bar drawn over the landscape's top row
 *  would hide the thing the clip is about. */
const BAR = { top: 14, h: 34, font: 12.5 };
const STAGE_TOP = BAR.top + BAR.h + 4;
const STAGE_H = H - STAGE_TOP - 6;
const FPS = 20;
// Imported, not copied. These used to be redeclared here with a comment saying
// they matched Stage.tsx — two untested copies of one animation model, in two
// languages, held together by an assertion nobody could check. core's dive.ts is
// now the single definition and it has tests.


/** cubic-bezier(.32,.72,0,1) — the app's dive easing, front-loaded so most of
 *  the distance is covered early and the landing is soft. */
function ease(t: number): number {
  const [x1, y1, x2, y2] = [0.32, 0.72, 0, 1];
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const fx = (u: number) => ((ax * u + bx) * u + cx) * u;
  let u = t;
  for (let i = 0; i < 8; i++) {
    const err = fx(u) - t;
    if (Math.abs(err) < 1e-6) break;
    const d = (3 * ax * u + 2 * bx) * u + cx;
    if (Math.abs(d) < 1e-6) break;
    u -= err / d;
  }
  return ((ay * u + by) * u + cy) * u;
}

/** The renderer animates async edges with a CSS keyframe — `.sq-flow` in the
 *  emitted <style>, 55px of dashoffset every 4.95s, i.e. 11.11 px/s. resvg
 *  rasterizes statically and would freeze every dash mid-stride, so the clip
 *  has to advance the phase itself: same speed, same direction, sampled at
 *  this frame's wall time. The loop here is one dash period (4 on + 7 off =
 *  11px) at that speed, so the wrap lands exactly one period on and is
 *  invisible; the 10px/0.9s this used to carry jumped a pixel every wrap. The
 *  first cut of this GIF simply lost the stream animation to all of this. */
const FLOW_DASH = 11, FLOW_PERIOD = FLOW_DASH / 11.11;
const flowAt = (frameIndex: number, svg: string) => {
  const off = -FLOW_DASH * (((frameIndex / FPS) / FLOW_PERIOD) % 1);
  return svg.replace(/class="sq-flow"/g, `class="sq-flow" stroke-dashoffset="${off.toFixed(3)}"`);
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** The renderer wraps the diagram body in a translate when anything sits
 *  outside it — a note that grew the canvas leftward, and now the header band
 *  above every titled view. Node coordinates in the markup are *pre*-transform,
 *  so anything reading them back (the dive anchors below) has to add this or it
 *  aims at where the card used to be. The header made that a visible bug: the
 *  pointer pressed a card's width above the card.
 *
 *  Deliberately a parse of the emitted string rather than a second copy of the
 *  layout maths — one source, and it cannot drift. */
function bodyShift(svg: string): { x: number; y: number } {
  const m = svg.match(/<g transform="translate\((-?[\d.]+), (-?[\d.]+)\)">/);
  return m ? { x: +m[1], y: +m[2] } : { x: 0, y: 0 };
}

interface Art { svg: string; w: number; h: number }

async function view(name: string, theme: string): Promise<Art> {
  const r = await renderProject(
    [{ name: "shop.squinch", src: readSource() }],
    { view: name, theme },
  );
  if (!r.ok) throw new Error(`render failed for ${name}`);
  const m = r.svg!.match(/<svg[^>]*width="(\d+)" height="(\d+)"/)!;
  return { svg: r.svg!, w: +m[1], h: +m[2] };
}

function readSource(): string {
  return readFileSync(join(root, "examples/microservices/shop.squinch"), "utf8");
}

/** Where an art board sits on the canvas: contained, centred, never upscaled
 *  past 1:1 so the diagram keeps its designed weight. */
function fitOf(a: Art) {
  const s = Math.min((W - PAD * 2) / a.w, (STAGE_H - PAD_V * 2) / a.h, 1);
  return { s, x: (W - a.w * s) / 2, y: STAGE_TOP + (STAGE_H - a.h * s) / 2 };
}

/** SVG has no transform-origin, so a scale about a point becomes an explicit
 *  translate. p → O + d + k(p − O). */
const about = (o: { x: number; y: number }, d: { x: number; y: number }, k: number) =>
  `translate(${(o.x + d.x - k * o.x).toFixed(3)} ${(o.y + d.y - k * o.y).toFixed(3)}) scale(${k.toFixed(5)})`;

/** Two whole SVGs share one document here, and ids are document-global: the
 *  second board's `<use href="#i-lambda">` would resolve against the first
 *  board's `<symbol>`. Namespace one of them. */
const isolate = (svg: string, tag: string) =>
  svg
    .replace(/\bid="([^"]+)"/g, `id="${tag}-$1"`)
    .replace(/href="#([^"]+)"/g, `href="#${tag}-$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${tag}-$1)`);

/** One board, placed and transformed.
 *
 *  The `<svg>` wrapper is stripped and its children inlined into a `<g>`: a
 *  nested viewport inside a heavily scaled group makes resvg's bbox maths
 *  degenerate and panic outright (an unwrap on a None rect, killing the
 *  process). Each board's viewBox is `0 0 w h` with matching width/height, so
 *  the wrapper implies no transform of its own and dropping it is lossless. */
function board(a: Art, tag: string, extra: string, opacity: number): string {
  const f = fitOf(a);
  const guts = isolate(a.svg, tag).replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  const inner = `<g>${guts}</g>`;
  return (
    `<g opacity="${opacity.toFixed(3)}">` +
    `<g transform="${extra}">` +
    `<g transform="translate(${f.x.toFixed(3)} ${f.y.toFixed(3)}) scale(${f.s.toFixed(5)})">` +
    inner +
    `</g></g></g>`
  );
}

/** Frames are drawn on a canvas three times the target and cropped back down.
 *  resvg panics outright — an unwrap on a None rect, taking the process with
 *  it — when a scaled group lands wholly outside the viewport, which is every
 *  frame of a dive past ~2.2×. Margin means nothing is ever fully outside. */
const M = { x: W, y: H };
const BIG = { w: W * 3, h: H * 3 };
/** Supersampling. resvg rasterizes glyphs with grayscale AA and no hinting, so
 *  15px and 11px type at 1:1 comes out ragged — the diagram's own SVGs never
 *  show this because a reader zooms them, but a GIF is pixels forever. Drawing
 *  at 2× and letting lanczos resolve it down costs ~330ms a frame against ~85ms.
 *
 *  Only the raster step scales: every coordinate in this file stays in CSS
 *  pixels, so nothing else has to know. */
const SS = 2;

/** The frame's own chrome — background, view bar, pointer, ripple — drawn
 *  from the theme's tokens so the animation matches the diagram it wraps and
 *  follows any future change to the palette. */
let T = themes.light;

/** Every view the playground would list, auto views included — the bar is
 *  core's `viewBar` over them, the same description the app draws, so the clip
 *  cannot show a bar the app would not. */
let NAV: NavView[] = [];

/** Which view the bar stands on, and which hop's menu is open (a segment key;
 *  the top level's is ""). */
interface BarState { view: string; open?: string }
type Pt = { x: number; y: number };

const HOUSE = '<path d="M2.5 7.25 8 2.75l5.5 4.5"/><path d="M4 6.25v6.25a1 1 0 0 0 1 1h2V10h2v3.5h2a1 1 0 0 0 1-1V6.25"/>';
const CARET = '<path d="m4.5 6.5 3.5 3.5 3.5-3.5"/>';
const FLOW = '<circle cx="4" cy="4" r="1.5"/><circle cx="12" cy="12" r="1.5"/><path d="M5.5 4H10a2 2 0 0 1 0 4H6a2 2 0 0 0 0 4h4.5"/>';
/** A 16-unit stroke icon, centred on (cx, cy) at `size` px. */
const icon = (paths: string, cx: number, cy: number, size: number, color: string) =>
  `<g transform="translate(${(cx - size / 2).toFixed(2)} ${(cy - size / 2).toFixed(2)}) scale(${(size / 16).toFixed(4)})" ` +
  `fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${paths}</g>`;
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const text = (x: number, y: number, t: string, size: number, weight: string, fill: string, anchor = "start") =>
  `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="Inter" font-size="${size}" font-weight="${weight}" ` +
  `fill="${fill}" text-anchor="${anchor}">${esc(t)}</text>`;

/** The view bar for one state: its SVG, and where the pointer can aim —
 *  home, each hop, and the rows of an open menu. The playground's geometry
 *  (ViewBar.tsx), laid out from real text metrics and centred on the canvas. */
function bar(st: BarState): { svg: string; home: Pt; hops: Map<string, Pt>; rows: Map<string, Pt> } {
  const b = viewBar(NAV, st.view);
  const mid = BAR.top + BAR.h / 2;
  const base = mid + BAR.font * 0.36;
  const weight = (state: string) => (state === "current" ? "600" : "400");
  const hopW = (s: { label: string; state: string; items: unknown[] }) =>
    10 + measure(s.label, BAR.font, weight(s.state)) + (s.items.length > 1 ? 4 + 13 + 8 : 10);
  const segW = b.segments.map(hopW);
  const pathW = 3 + 28 + (b.segments.length ? 9 + segW.reduce((x, y) => x + y, 0) + 10 * (b.segments.length - 1) : 0) + 3;
  const f = b.activeFlow ?? (b.flows.length === 1 ? b.flows[0] : undefined);
  const flowLabel = f ? f.label : "Flows";
  const flowW = b.flows.length ? 11 + 14 + 7 + measure(flowLabel, BAR.font, f && b.activeFlow ? "600" : "400") + 11 : 0;
  const total = pathW + (flowW ? 8 + flowW : 0);
  let x = (W - total) / 2;
  const hops = new Map<string, Pt>(), rows = new Map<string, Pt>();
  const out: string[] = [];
  const pill = (px: number, w: number) =>
    `<rect x="${px.toFixed(1)}" y="${BAR.top}" width="${w.toFixed(1)}" height="${BAR.h}" rx="9" ` +
    `fill="${T.surface}" stroke="${T.border}" stroke-width="1"/>`;
  out.push(pill(x, pathW));
  // home
  const home = { x: x + 3 + 14, y: mid };
  if (b.atHome) out.push(`<rect x="${(x + 3).toFixed(1)}" y="${BAR.top + 3}" width="28" height="28" rx="6" fill="${T.surfaceAlt}"/>`);
  out.push(icon(HOUSE, home.x, home.y, 15, b.atHome ? T.accent : T.muted));
  x += 3 + 28;
  let menu = "";
  if (b.segments.length) {
    out.push(`<rect x="${(x + 4).toFixed(1)}" y="${mid - 8}" width="1" height="16" fill="${T.border}"/>`);
    x += 9;
    b.segments.forEach((s, i) => {
      const w = segW[i];
      const open = st.open === s.key && s.items.length > 1;
      if (open) out.push(`<rect x="${x.toFixed(1)}" y="${BAR.top + 3}" width="${w.toFixed(1)}" height="28" rx="6" fill="${T.surfaceAlt}"/>`);
      const color = s.state === "current" || open ? T.ink : T.muted;
      out.push(text(x + 10, base, s.label, BAR.font, weight(s.state), color));
      if (s.items.length > 1) out.push(icon(CARET, x + w - 8 - 6.5, mid, 13, T.muted));
      hops.set(s.key, { x: x + w / 2, y: mid });
      if (open) {
        // the hop's menu: one row per view beside it, the one you are on ticked
        const mx = x, my = BAR.top + BAR.h + 6, rowH = 32, mw = 256, mh = s.items.length * rowH + 8;
        menu +=
          `<rect x="${mx}" y="${my + 6}" width="${mw}" height="${mh}" rx="12" fill="#000" opacity="0.07"/>` +
          `<rect x="${mx}" y="${my}" width="${mw}" height="${mh}" rx="11" fill="${T.surface}" stroke="${T.border}" stroke-width="1"/>`;
        s.items.forEach((it, r) => {
          const ry = my + 4 + r * rowH;
          if (it.active) menu += `<rect x="${mx + 4}" y="${ry}" width="${mw - 8}" height="${rowH}" rx="7" fill="${T.surfaceAlt}"/>`;
          menu += text(mx + 14, ry + rowH / 2 + 13 * 0.36, it.label, 13, it.active ? "600" : "400", T.ink);
          if (it.active) menu += `<path d="M ${mx + mw - 30} ${ry + 16} l 3 3 l 6 -7" fill="none" stroke="${T.accent}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
          rows.set(it.view, { x: mx + 60, y: ry + rowH / 2 });
        });
      }
      x += w;
      if (i < b.segments.length - 1) {
        out.push(text(x + 5, base, "/", 13, "400", T.border, "middle"));
        x += 10;
      }
    });
  }
  x += 3;
  if (flowW) {
    x += 8;
    out.push(pill(x, flowW));
    out.push(icon(FLOW, x + 11 + 7, mid, 14, b.activeFlow ? T.accent : T.muted));
    out.push(text(x + 11 + 14 + 7, base, flowLabel, BAR.font, b.activeFlow ? "600" : "400", b.activeFlow ? T.ink : T.muted));
  }
  return { svg: out.join("") + menu, home, hops, rows };
}

/** A pointer, drawn dark on light with a thin light outline so it stays legible
 *  over icons and edges alike. Origin is the tip. */
const cursor = (x: number, y: number, alpha: number, pressed: boolean) => {
  if (alpha <= 0.01) return "";
  const s = pressed ? 0.88 : 1;
  return (
    `<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${s})" opacity="${alpha.toFixed(3)}">` +
    `<path d="M 0 0 L 0 18 L 4.8 13.8 L 7.6 20 L 10.4 18.7 L 7.6 12.7 L 13.3 12.7 Z" ` +
    `fill="${T.ink}" stroke="${T.canvas}" stroke-width="1.4" stroke-linejoin="round"/></g>`
  );
};

/** The click itself: a ring that expands and fades from the point of contact. */
const ripple = (x: number, y: number, t: number) => {
  if (t < 0 || t > 1) return "";
  const r = lerp(5, 30, ease(t));
  const a = (1 - t) * 0.65;
  return (
    `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${r.toFixed(2)}" fill="none" ` +
    `stroke="${T.accent}" stroke-width="${(2.4 * (1 - t) + 0.6).toFixed(2)}" opacity="${a.toFixed(3)}"/>`
  );
};

/** Canvas, then the boards, then the bar — it floats over a dive exactly as it
 *  does over the app's stage — then whatever rides on top of everything: the
 *  pointer and its ripple, which have to land ON the bar when they press it. */
const frame = (body: string, st: BarState, overlay = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${BIG.w}" height="${BIG.h}" ` +
  `viewBox="${-M.x} ${-M.y} ${BIG.w} ${BIG.h}">` +
  `<rect x="${-M.x}" y="${-M.y}" width="${BIG.w}" height="${BIG.h}" fill="${T.canvas}"/>` +
  `${body}${bar(st).svg}${overlay}</svg>`;

const build = async (theme: string) => {
  T = (themes as Record<string, typeof themes.light>)[theme];

  // Wipe first: both themes write f0000.png… into the same directory, and a
  // stale frame from the previous run would be swept into the encode.
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });

  NAV = viewIndex(readSource());
  const land = await view("landscape", theme);
  const V = { x: W / 2, y: STAGE_TOP + STAGE_H / 2 };

  /** Everything a dive into one system needs: its view, the card it is
   *  anchored on in canvas coordinates, and the scale/offset that carries one
   *  into the other. Derived per system so each dive is anchored on its own
   *  card — the whole point of the motion is that the card you pressed is the
   *  thing that opens. */
  const target = async (name: string) => {
    const art = await view(name, theme);
    const card = land.svg.match(
      new RegExp(
        `data-path="${name}" data-kind="card"[^>]*>\\s*<rect x="(\\d+)" y="(\\d+)" width="(\\d+)" height="(\\d+)"`,
      ),
    );
    if (!card) throw new Error(`could not find the \`${name}\` card to dive through`);
    const f = fitOf(land);
    const b = bodyShift(land.svg);
    const A = {
      x: f.x + (+card[1] + b.x + +card[3] / 2) * f.s,
      y: f.y + (+card[2] + b.y + +card[4] / 2) * f.s,
      w: +card[3] * f.s,
      h: +card[4] * f.s,
    };
    const k = scaleFor({ x: 0, y: 0, w: W, h: H } as Box, A as Box);
    return { name, art, A, k, kIn: 1 + (k - 1) * TRAVEL, d: { x: V.x - A.x, y: V.y - A.y } };
  };
  const targets = [];
  for (const name of SYSTEMS) targets.push(await target(name));
  type Target = (typeof targets)[number];

  /** One dive frame. `t` runs 0→1; `into` picks the direction. */
  const dive = (t: number, into: boolean, g: Target) => {
    const { art: ord, A, k, kIn, d } = g;
    const e = ease(t);
    // outgoing flies past, anchored on the card; incoming emerges from it
    const outK = into ? lerp(1, k, e) : lerp(1, 1 / k, e);
    const outD = { x: d.x * e * (into ? 1 : -1), y: d.y * e * (into ? 1 : -1) };
    const inK = into ? lerp(1 / kIn, 1, e) : lerp(kIn, 1, e);
    const inD = into
      ? { x: -d.x * (1 - e), y: -d.y * (1 - e) }
      : { x: d.x * (1 - e), y: d.y * (1 - e) };
    // the ghost clears out early and the arrival lands late, so the two are
    // never both at full strength
    const outA = clamp(1 - t / 0.55, 0, 1);
    const inA = clamp((t - 0.25) / 0.6, 0, 1);
    const [leaving, arriving] = into ? [land, ord] : [ord, land];
    const [lTag, aTag] = into ? ["a", "b"] : ["b", "a"];
    // A fully transparent board is omitted, not drawn at opacity 0: resvg
    // panics computing the bbox of an invisible transformed group.
    const vis = (a: Art, tag: string, tf: string, alpha: number) =>
      alpha > 0.005 ? board(a, tag, tf, alpha) : "";
    return frame(
      vis(leaving, lTag, about(into ? A : V, outD, outK), outA) +
        vis(arriving, aTag, about(into ? V : A, inD, inK), inA),
      // the bar flips at the midpoint, where the arriving altitude takes over
      { view: into === e > 0.5 ? g.name : "landscape" },
    );
  };

  const still = (a: Art, tag: string, st: BarState, overlay = "") =>
    frame(board(a, tag, "translate(0 0)", 1), st, overlay);

  // Where the pointer goes. Clicking the card is how you descend; the home
  // button is how you come back — it moves with the bar, which is centred and
  // changes width with every view, so it is looked up per state. The bar is
  // otherwise only watched, never pressed, except to open the full view.
  const cardPoint = (g: Target) => ({ x: g.A.x + 6, y: g.A.y - 4 });
  const homeOf = (view: string) => bar({ view }).home;
  const START = { x: W - 150, y: STAGE_TOP + STAGE_H - 70 };

  /** Pointer travelling from `a` to `b` across `n` frames, clicking at the end:
   *  the ring starts on the frame the press lands, and the arrow dips with it. */
  const approach = (
    art: Art, tag: string, st: BarState,
    from: { x: number; y: number }, to: { x: number; y: number },
    idle: number, travel: number, dwell: number,
  ) => {
    const out: string[] = [];
    for (let i = 0; i < idle; i++) out.push(still(art, tag, st));
    for (let i = 0; i < travel; i++) {
      const e = ease((i + 1) / travel);
      out.push(still(art, tag, st,
        cursor(lerp(from.x, to.x, e), lerp(from.y, to.y, e), 1, false)));
    }
    for (let i = 0; i < dwell; i++) {
      const t = i / dwell;
      out.push(still(art, tag, st, ripple(to.x, to.y, t) + cursor(to.x, to.y, 1, i < 2)));
    }
    return out;
  };

  const frames: string[] = [];
  const hold = (svg: string, n: number) => { for (let i = 0; i < n; i++) frames.push(svg); };

  /** The lateral move between sibling views — the app's anchorless CUT: a
   *  plain crossfade, both boards at rest, caption flipping at the midpoint.
   *  Deliberately not a dive; there is no card for one to anchor on. */
  const cut = (
    fromArt: Art, fromTag: string, toArt: Art, toTag: string,
    fromSt: BarState, toSt: BarState, n: number,
  ) => {
    for (let i = 1; i <= n; i++) {
      const e = ease(i / n);
      frames.push(frame(
        (1 - e > 0.005 ? board(fromArt, fromTag, "translate(0 0)", 1 - e) : "") +
          (e > 0.005 ? board(toArt, toTag, "translate(0 0)", e) : ""),
        e > 0.5 ? toSt : fromSt,
      ));
    }
  };

  // Holds are long enough to read and no longer: the story is that the
  // *contents change*, and with two round trips the clip pays for every held
  // frame twice. They also cost more than they used to — while an animated
  // edge is on screen no two frames are identical, so the encoder cannot
  // collapse a dwell into one.
  // One round trip: reach for a card, dive, read the internals, climb back out
  // on the home button. The pointer starts wherever it was left, so the second
  // trip continues the first rather than teleporting.
  let from = START;
  targets.forEach((g, i) => {
    const CARD = cardPoint(g);
    const HOME = homeOf(g.name);
    // the first landscape needs reading time; by the second the viewer knows it
    frames.push(...approach(land, "a", { view: "landscape" }, from, CARD, i === 0 ? 10 : 6, 12, 6));
    // the dive carries the pointer for a moment, then lets it go
    for (let j = 1; j <= 11; j++) {
      const t = j / 12;
      frames.push(
        dive(t, true, g).replace("</svg>", `${cursor(CARD.x, CARD.y, Math.max(0, 1 - t * 2.2), false)}</svg>`),
      );
    }
    // read the detail, then reach for home to come back up
    frames.push(...approach(g.art, "b", { view: g.name }, CARD, HOME, 12, 12, 6));
    for (let j = 1; j <= 11; j++) {
      const t = j / 12;
      frames.push(
        dive(t, false, g).replace("</svg>", `${cursor(HOME.x, HOME.y, Math.max(0, 1 - t * 2.2), false)}</svg>`),
      );
    }
    from = HOME;
  });

  // Act three: everything at once. `expand *` opens all four systems on one
  // page — the view the two dives have been trading detail for altitude to
  // avoid needing. It sits beside the landscape at the top of the model, so the
  // pointer reaches it the way the app does: the top hop's menu. A lateral cut,
  // not a dive — siblings have no card to anchor on — and home closes the loop.
  const full = await view("full", theme);
  const TOP = bar({ view: "landscape" }).hops.get("")!;
  const menuOpen: BarState = { view: "landscape", open: "" };
  const FULL_ROW = bar(menuOpen).rows.get("full")!;
  frames.push(...approach(land, "a", { view: "landscape" }, from, TOP, 4, 12, 6));
  frames.push(...approach(land, "a", menuOpen, TOP, FULL_ROW, 4, 10, 6));
  cut(land, "a", full, "c", menuOpen, { view: "full" }, 6);
  hold(still(full, "c", { view: "full" }), 30);
  const FULL_HOME = homeOf("full");
  frames.push(...approach(full, "c", { view: "full" }, FULL_ROW, FULL_HOME, 0, 10, 6));
  cut(full, "c", land, "a", { view: "full" }, { view: "landscape" }, 6);
  hold(still(land, "a", { view: "landscape" }), 10);

  // Phase is stamped here rather than in the timeline: held frames push the
  // same string N times, and only the output index knows how far the clip has
  // run by the time each one is drawn.
  for (let i = 0; i < frames.length; i++) {
    const svg = flowAt(i, frames[i]);
    if (process.env.DUMP_SVG) { writeFileSync(join(tmp, `f${String(i).padStart(4,"0")}.svg`), svg); continue; }
    writeFileSync(join(tmp, `f${String(i).padStart(4, "0")}.png`), svgToPng(svg, { width: BIG.w * SS }));
    // Each frame's pixmap (~80 MB at this size) is native memory behind a
    // small JS wrapper. It is released by a finalizer, and Node runs native
    // finalizers on the event loop — so a loop that never yields frees
    // nothing, however often the collector runs, and on a 16 GB box this was
    // killed at 12.6 GB resident around frame 160. Yielding a macrotask per
    // frame lets the finalizers run; the collection hint (a no-op without
    // `NODE_OPTIONS=--expose-gc`) makes them due sooner.
    (globalThis as { gc?: () => void }).gc?.();
    await new Promise<void>((r) => setImmediate(r));
    if (i % 20 === 0) console.log(`  frame ${i + 1}/${frames.length}`);
  }
  // DUMP_SVG=1 writes the frame SVGs instead of rasterizing — how the resvg
  // panic above was cornered, and the first thing to reach for if it returns.
  if (process.env.DUMP_SVG) { console.log("dumped SVGs to", tmp); return; }

  // Two passes: build a palette from the whole clip, then map to it. One-pass
  // GIF encoding picks a palette from frame 1 and bands everything after it.
  //
  // The full 256 with no dithering at all, which is not the usual advice — it
  // is right here because these frames are flat vector art from a deliberately
  // small palette: a few greys, a few brand hues, and card ramps that span
  // about 4%. 256 slots represent that almost exactly, so a dither has nothing
  // left to approximate and only adds texture of its own. The previous
  // ordered dither (bayer, 128 colours) did exactly that — a regular speckle
  // across every card, read as striping once the restyle put a gradient on
  // them. Measured against the same 166 frames: bayer 1085 KB with the
  // pattern, floyd_steinberg 1109 KB clean, none 1026 KB and cleanest.
  // `stats_mode=full` rather than `diff` for the same reason — the ramps sit
  // on cards that hold still, and `diff` spends the palette on what moves.
  const OUT = out(theme);
  const pal = join(tmp, "palette.png");
  const args = (a: string[]) => execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...a]);
  // crop in device pixels, then resolve back down to the target size — the
  // downscale is where the supersampling is actually cashed in
  const crop = `crop=${W * SS}:${H * SS}:${M.x * SS}:${M.y * SS},scale=${W}:${H}:flags=lanczos`;
  args(["-framerate", String(FPS), "-i", join(tmp, "f%04d.png"),
        "-vf", `${crop},palettegen=max_colors=256:stats_mode=full`, pal]);
  mkdirSync(dirname(OUT), { recursive: true });
  args(["-framerate", String(FPS), "-i", join(tmp, "f%04d.png"), "-i", pal,
        "-lavfi", `[0:v]${crop}[c];[c][1:v]paletteuse=dither=none`,
        "-loop", "0", OUT]);
  // KEEP_FRAMES=1 leaves the PNGs behind. Palette and dither settings can only
  // be judged by comparing encodes of the *same* frames, and re-rendering 166
  // of them between attempts is both slow and one more variable.
  if (!process.env.KEEP_FRAMES) rmSync(tmp, { recursive: true, force: true });

  const kb = Math.round(statSync(OUT).size / 1024);
  console.log(`wrote ${OUT} — ${frames.length} frames, ${(frames.length / FPS).toFixed(1)}s, ${kb} KB`);
};

for (const theme of ["light", "dark"]) await build(theme);
