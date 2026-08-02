// The README's hero animation: a landscape diagram, a dive into a system and
// back out, then the same into a second one — two round trips, because one
// dive shows a zoom and two show that the altitude belongs to the model rather
// than to a particular diagram.
//
// Generated, never screen-recorded — the frames are the real renderer's output,
// so the GIF cannot drift from what the tool actually draws, and it can be
// regenerated after any visual change. It has already earned that twice: once
// when the wordmark moved, and once when system cards took the brand gradient.
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
import { renderProject, themes } from "../packages/core/dist/index.js";
import { svgToPng } from "../packages/cli/src/raster.js";
import { TRAVEL, scaleFor, type Box } from "../packages/core/dist/index.js";

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
/** Gap above the wordmark, and below it. */
const LOGO_GAP = 8, LOGO_BOTTOM = 16;
/** Displayed width of the wordmark; its height follows from the asset. */
const LOGO_W = 132;
/** A reserved strip along the bottom for the wordmark. Without it the diagram
 *  fills the full height and the landscape's bottom row collides with the
 *  logo — the artwork is centred, so there is no corner it reliably avoids.
 *  Sized from the logo once it is measured, so the gap below it matches the
 *  gap to its right exactly. */
let FOOT = 0;
let STAGE_H = H;
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

/** The renderer animates async edges with a CSS keyframe — 10px of dashoffset
 *  every 0.9s, `.sq-flow` in the emitted <style>. resvg rasterizes statically
 *  and would freeze every dash mid-stride, so the clip has to advance the phase
 *  itself: same period, same direction, sampled at this frame's wall time. The
 *  first cut of this GIF simply lost the stream animation to that. */
const FLOW_PERIOD = 0.9, FLOW_DASH = 10;
const flowAt = (frameIndex: number, svg: string) => {
  const off = -FLOW_DASH * (((frameIndex / FPS) / FLOW_PERIOD) % 1);
  return svg.replace(/class="sq-flow"/g, `class="sq-flow" stroke-dashoffset="${off.toFixed(3)}"`);
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

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
  return { s, x: (W - a.w * s) / 2, y: (STAGE_H - a.h * s) / 2 };
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

/** The frame's own chrome — background, breadcrumb, pointer, ripple — drawn
 *  from the theme's tokens so the animation matches the diagram it wraps and
 *  follows any future change to the palette. */
let T = themes.light;
/** The wordmark, pre-scaled and base64'd once per theme. Embedding the
 *  1440px original into all 116 frames would mean resvg downscaling it 116
 *  times and ~490 KB of base64 per frame on disk. */
let MARK = { href: "", w: 0, h: 0 };

/** Bottom-right of the *visible* crop, not the padded canvas. */
const watermark = () =>
  MARK.href
    ? `<image href="${MARK.href}" x="${(W - PAD - MARK.w).toFixed(1)}" ` +
      `y="${(H - LOGO_BOTTOM - MARK.h).toFixed(1)}" ` +
      `width="${MARK.w}" height="${MARK.h}" opacity="0.9"/>`
    : "";

const caption = (crumbs: string[]) => {
  const trail = crumbs
    .map((c, i) =>
      `<tspan fill="${i === crumbs.length - 1 ? T.ink : T.muted}">${c}</tspan>` +
      (i < crumbs.length - 1 ? `<tspan fill="${T.border}"> › </tspan>` : ""),
    )
    .join("");
  return `<text x="28" y="42" font-family="Inter" font-size="15" font-weight="500">${trail}</text>`;
};

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

const frame = (body: string, crumbs: string[]) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${BIG.w}" height="${BIG.h}" ` +
  `viewBox="${-M.x} ${-M.y} ${BIG.w} ${BIG.h}">` +
  `<rect x="${-M.x}" y="${-M.y}" width="${BIG.w}" height="${BIG.h}" fill="${T.canvas}"/>` +
  `${body}${caption(crumbs)}${watermark()}</svg>`;

const build = async (theme: string) => {
  T = (themes as Record<string, typeof themes.light>)[theme];

  // Wipe first: both themes write f0000.png… into the same directory, and a
  // stale frame from the previous run would be swept into the encode.
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });

  // logo-dark.png is the *dark-mode* variant (light ink), which is what the
  // dark frames need — the same pairing the README's <picture> uses.
  // The logo assets have no alpha — light sits on #FDFDFD, dark on #000000 —
  // so dropped straight in, each shows as a pale or black box against the
  // canvas. Key the flat background out. Verified not to punch holes in the
  // mark: nothing inside it is pure white or pure black.
  const small = join(tmp, "logo.png");
  const key = theme === "dark" ? "0x000000" : "0xFDFDFD";
  // 2x the display size, so resvg has pixels to sample down from
  execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error",
    "-i", join(root, `docs/assets/logo-${theme}.png`),
    "-vf", `scale=${LOGO_W * 2}:-1,colorkey=${key}:0.12:0.0,format=rgba`, small]);
  const raw = readFileSync(small);
  // PNG IHDR: width and height are big-endian u32 at bytes 16 and 20
  const lw = raw.readUInt32BE(16), lh = raw.readUInt32BE(20);
  MARK = {
    href: `data:image/png;base64,${raw.toString("base64")}`,
    w: LOGO_W,
    h: Math.round((lh / lw) * LOGO_W),
  };
  // the band is only as tall as the logo needs — anything more reads as a hole
  // between the diagram and the mark
  FOOT = LOGO_GAP + MARK.h + LOGO_BOTTOM;
  STAGE_H = H - FOOT;
  const land = await view("landscape", theme);
  const V = { x: W / 2, y: STAGE_H / 2 };

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
    const A = {
      x: f.x + (+card[1] + +card[3] / 2) * f.s,
      y: f.y + (+card[2] + +card[4] / 2) * f.s,
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
      // the trail flips at the midpoint, where the arriving altitude takes over
      into === e > 0.5 ? ["landscape", g.name] : ["landscape"],
    );
  };

  const still = (a: Art, tag: string, crumbs: string[], overlay = "") =>
    frame(board(a, tag, "translate(0 0)", 1) + overlay, crumbs);

  // Where the pointer goes. Clicking the card is how you descend; clicking the
  // breadcrumb is how you come back — the same two affordances the app has, so
  // the GIF teaches the interaction rather than just showing the motion.
  const cardPoint = (g: Target) => ({ x: g.A.x + 6, y: g.A.y - 4 });
  const CRUMB = { x: 58, y: 34 };
  const START = { x: W - 150, y: STAGE_H - 70 };

  /** Pointer travelling from `a` to `b` across `n` frames, clicking at the end:
   *  the ring starts on the frame the press lands, and the arrow dips with it. */
  const approach = (
    art: Art, tag: string, crumbs: string[],
    from: { x: number; y: number }, to: { x: number; y: number },
    idle: number, travel: number, dwell: number,
  ) => {
    const out: string[] = [];
    for (let i = 0; i < idle; i++) out.push(still(art, tag, crumbs));
    for (let i = 0; i < travel; i++) {
      const e = ease((i + 1) / travel);
      out.push(still(art, tag, crumbs,
        cursor(lerp(from.x, to.x, e), lerp(from.y, to.y, e), 1, false)));
    }
    for (let i = 0; i < dwell; i++) {
      const t = i / dwell;
      out.push(still(art, tag, crumbs, ripple(to.x, to.y, t) + cursor(to.x, to.y, 1, i < 2)));
    }
    return out;
  };

  const frames: string[] = [];
  const hold = (svg: string, n: number) => { for (let i = 0; i < n; i++) frames.push(svg); };

  // Holds are long enough to read and no longer: the story is that the
  // *contents change*, and with two round trips the clip pays for every held
  // frame twice. They also cost more than they used to — while an animated
  // edge is on screen no two frames are identical, so the encoder cannot
  // collapse a dwell into one.
  // One round trip: reach for a card, dive, read the internals, climb back out
  // on the breadcrumb. The pointer starts wherever it was left, so the second
  // trip continues the first rather than teleporting.
  let from = START;
  targets.forEach((g, i) => {
    const CARD = cardPoint(g);
    // the first landscape needs reading time; by the second the viewer knows it
    frames.push(...approach(land, "a", ["landscape"], from, CARD, i === 0 ? 10 : 6, 12, 6));
    // the dive carries the pointer for a moment, then lets it go
    for (let j = 1; j <= 11; j++) {
      const t = j / 12;
      frames.push(
        dive(t, true, g).replace("</svg>", `${cursor(CARD.x, CARD.y, Math.max(0, 1 - t * 2.2), false)}</svg>`),
      );
    }
    // read the detail, then reach for the breadcrumb to come back up
    frames.push(...approach(g.art, "b", ["landscape", g.name], CARD, CRUMB, 12, 12, 6));
    for (let j = 1; j <= 11; j++) {
      const t = j / 12;
      frames.push(
        dive(t, false, g).replace("</svg>", `${cursor(CRUMB.x, CRUMB.y, Math.max(0, 1 - t * 2.2), false)}</svg>`),
      );
    }
    from = CRUMB;
  });
  hold(still(land, "a", ["landscape"]), 10);

  // Phase is stamped here rather than in the timeline: held frames push the
  // same string N times, and only the output index knows how far the clip has
  // run by the time each one is drawn.
  frames.forEach((raw, i) => {
    const svg = flowAt(i, raw);
    if (process.env.DUMP_SVG) { writeFileSync(join(tmp, `f${String(i).padStart(4,"0")}.svg`), svg); return; }
    writeFileSync(join(tmp, `f${String(i).padStart(4, "0")}.png`), svgToPng(svg));
    if (i % 20 === 0) console.log(`  frame ${i + 1}/${frames.length}`);
  });
  // DUMP_SVG=1 writes the frame SVGs instead of rasterizing — how the resvg
  // panic above was cornered, and the first thing to reach for if it returns.
  if (process.env.DUMP_SVG) { console.log("dumped SVGs to", tmp); return; }

  // Two passes: build a palette from the whole clip, then map to it. One-pass
  // GIF encoding picks a palette from frame 1 and bands everything after it.
  const OUT = out(theme);
  const pal = join(tmp, "palette.png");
  const args = (a: string[]) => execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...a]);
  const crop = `crop=${W}:${H}:${M.x}:${M.y}`;
  args(["-framerate", String(FPS), "-i", join(tmp, "f%04d.png"),
        "-vf", `${crop},palettegen=max_colors=128:stats_mode=diff`, pal]);
  mkdirSync(dirname(OUT), { recursive: true });
  args(["-framerate", String(FPS), "-i", join(tmp, "f%04d.png"), "-i", pal,
        "-lavfi", `[0:v]${crop}[c];[c][1:v]paletteuse=dither=bayer:bayer_scale=5`,
        "-loop", "0", OUT]);
  rmSync(tmp, { recursive: true, force: true });

  const kb = Math.round(statSync(OUT).size / 1024);
  console.log(`wrote ${OUT} — ${frames.length} frames, ${(frames.length / FPS).toFixed(1)}s, ${kb} KB`);
};

for (const theme of ["light", "dark"]) await build(theme);
