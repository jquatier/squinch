// Generates docs/assets/mark-stack.svg — the layered mark: the S standing on
// three exploded isometric planes.
//
//   npx tsx scripts/mark-stack.mts
//
// Maintainer-only, and generated rather than hand-drawn for the same reason
// the hero GIF is: the S itself is lifted verbatim from docs/assets/mark.svg —
// paths *and* gradient stops — so the plain mark and the layered one cannot
// drift, and the geometry is parameters rather than path data, so a change is
// a number and not a redraw.
//
// The shape was reconstructed by measuring the original artwork (the retired
// docs/assets/logo-dark.png) rather than by eye, and the measurements are worth
// keeping because three of them are counter-intuitive:
//
//   * The projection is NOT isometric. Least-squares fits to the planes'
//     straight edges give a = 220.5, b = 126 — a 1.75 ratio, not 1.73 or 2.0 —
//     and all three planes agree on it. Fit the edges, never the bounding box:
//     the rounded corners pull each rendered extreme ~10px inward, which makes
//     a naive bbox read the planes about 2.5% small.
//   * The stack is deliberately uneven. The waists sit at y 225 / 330 / 420 —
//     gaps of 105 then 90, compressed toward the bottom.
//   * Each plane's colour ramp runs from its LEFT vertex to its BOTTOM vertex,
//     not left to right. That is what puts violet at the left, cyan at the
//     bottom, and a blue midpoint at the top vertex.
//
// Two properties are what make it read as a stack rather than three loose
// outlines, and both are easy to lose: a nearer plane hides a farther one, and
// every plane fades out toward its own far vertex. See the defs below.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── geometry, in the artwork's own pixel space ─────────────────────────────
const CX = 254;
const A = 220.5; // plane half-width
const B = 126; // plane half-height
const PLANE = { top: 225, mid: 330, bot: 420 } as const; // waist y of each
const R = 24; // plane corner radius
const SW = 2.4; // solid plane stroke
const GREY_SW = 1.9; // the dashed plane is drawn lighter than the solid ones

/** Content spans x 33.5..474.5 and y 34..546; this adds 10px of padding. */
const VIEW = { x: 24, y: 24, w: 460, h: 532 };

/** The posts stand at the planes' *rendered* left/right extremes, not their
 *  geometric vertices — the rounded corner pulls the visible extreme ~10px in,
 *  and the original's posts line up with that (x≈44) rather than with x=33.5. */
const POST = A - (R * A) / (2 * Math.hypot(A, B));

/** Dashes render ~10.6 long with ~4.3 gaps on a ~15 period (17 per edge).
 *  Round caps extend every dash by a full stroke width, so the nominal numbers
 *  sit one stroke either side of what you want to see — a naive "9 6" measures
 *  back as 12.6/2.4, which reads as very nearly a solid line. */
const DASH = `${8 - SW / 2} ${7 + SW / 2}`;

// ── colour: the brand ramp, #C441FE → #15B6FF ──────────────────────────────
// The same ramp DESIGN.md documents and the renderer's `sq-accent` carries, so
// the mark and a rendered card's spine are the same gradient. #3585FF is both
// the midpoint of the brand ramp and where the original's own top vertex
// lands, so the measured midpoint and the brand agree.
const VIOLET = "#C441FE";
const BLUE = "#3585FF";
const CYAN = "#15B6FF";
/** The dashed plane is a drawn guide, not a structural edge: in the original
 *  it reads ~10% dimmer than the solid planes and its stroke is thinner. */
const GREY = "#8F949C";

// ── helpers ────────────────────────────────────────────────────────────────
const n = (v: number) => Math.round(v * 100) / 100;
type P = [number, number];
const pt = ([x, y]: P) => `${n(x)} ${n(y)}`;

/** A point in a plane's own axes: u runs toward the right vertex, v toward the
 *  bottom one, both on [-1,1]. Nodes are placed this way so they land on the
 *  plane by construction rather than by hand-checked pixel coordinates. */
const on = (cy: number, u: number, v: number): P => [
  CX + ((u + v) * A) / 2,
  cy + ((v - u) * B) / 2,
];

const rounded = (pts: P[], r: number) => {
  let d = "";
  for (let i = 0; i < pts.length; i++) {
    const c = pts[i];
    const prev = pts[(i + pts.length - 1) % pts.length];
    const next = pts[(i + 1) % pts.length];
    const t1 = Math.min(r / Math.hypot(c[0] - prev[0], c[1] - prev[1]), 0.5);
    const t2 = Math.min(r / Math.hypot(c[0] - next[0], c[1] - next[1]), 0.5);
    const from: P = [c[0] + (prev[0] - c[0]) * t1, c[1] + (prev[1] - c[1]) * t1];
    const to: P = [c[0] + (next[0] - c[0]) * t2, c[1] + (next[1] - c[1]) * t2];
    d += `${i === 0 ? "M" : "L"}${pt(from)}Q${pt(c)} ${pt(to)}`;
  }
  return `${d}Z`;
};

const plane = (cy: number) =>
  rounded([[CX - A, cy], [CX, cy - B], [CX + A, cy], [CX, cy + B]], R);

const diamond = ([x, y]: P, w: number, h: number, r: number) =>
  rounded([[x - w, y], [x, y - h], [x + w, y], [x, y + h]], r);

/** A plane's ramp, along its own +v axis: left vertex → bottom vertex. */
const ramp = (id: string, cy: number) =>
  `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" ` +
  `x1="${n(CX - A)}" y1="${cy}" x2="${CX}" y2="${cy + B}">` +
  `<stop offset="0" stop-color="${VIOLET}"/>` +
  `<stop offset="0.5" stop-color="${BLUE}"/>` +
  `<stop offset="1" stop-color="${CYAN}"/></linearGradient>`;

// ── what sits on each plane ────────────────────────────────────────────────
const DIAMONDS: P[] = [
  [-0.578, -0.506],
  [0.526, 0.581],
  [-0.078, 0.613],
  [-0.605, 0.609],
];
/** The wired nodes share a u (left↔bottom) or a v (bottom↔right), which is
 *  what makes each wire a single segment along one of the plane's own axes —
 *  a diagram routes orthogonally, so a diagonal shortcut would read wrong. */
const RING = { l: [-0.6, -0.38] as P, b: [-0.6, 0.605] as P, r: [0.38, 0.605] as P };
const RX = 19.5;
const RY = 13;

const ring = ([u, v]: P) => {
  const [x, y] = on(PLANE.bot, u, v);
  return `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${RX}" ry="${RY}"/>`;
};
/** Wires stop at the rings' edges rather than running through them: for a unit
 *  direction (ux,uy) the ellipse boundary is at 1/hypot(ux/rx, uy/ry). */
const wire = (a: P, b: P) => {
  const p = on(PLANE.bot, ...a);
  const q = on(PLANE.bot, ...b);
  const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
  const [ux, uy] = [(q[0] - p[0]) / len, (q[1] - p[1]) / len];
  const t = 1 / Math.hypot(ux / RX, uy / RY);
  return `M${pt([p[0] + ux * t, p[1] + uy * t])}L${pt([q[0] - ux * t, q[1] - uy * t])}`;
};

// ── the S, lifted verbatim from the mark ───────────────────────────────────
// Its ink does not fill its viewBox (x 0..454, y 9..445 of 455), so the
// placement maps the ink box rather than the viewBox — mapping the viewBox
// lands it a few pixels high and small.
const src = readFileSync(join(root, "docs/assets/mark.svg"), "utf8");
const paths = [...src.matchAll(/<path fill="url\(#([^)]+)\)" d="([^"]+)"\/>/g)];
if (paths.length !== 2) throw new Error(`expected 2 paths in docs/assets/mark.svg, found ${paths.length}`);
const gradients = [...src.matchAll(/<linearGradient id="([^"]+)"([^>]*)>([\s\S]*?)<\/linearGradient>/g)];
if (gradients.length !== 2) throw new Error(`expected 2 gradients in docs/assets/mark.svg`);

const VB = { x: 539.08, y: 183.32, size: 455.14 };
const INK = { y0: (9 / 455) * VB.size, w: (454 / 455) * VB.size };
/** The S's ink box, centred on the original's own S centre (254.5, 161). The
 *  original measures ~3% taller than the glyph's true aspect because its
 *  bottom cap glows downward, so match the width and trust the centre rather
 *  than stretching the glyph to hit both edges. */
const MARK = { cx: 255, top: 36.5, w: 259 };
const scale = n(MARK.w / INK.w);
const tx = n(MARK.cx - MARK.w / 2 - VB.x * scale);
const ty = n(MARK.top - (VB.y + INK.y0) * scale);

// mark.svg's ids are namespaced on the way in, so the two marks can be inlined
// on the same page without their gradients colliding
const ns = (id: string) => id.replace(/^sq-/, "sqs-");
const box = `x="${VIEW.x}" y="${VIEW.y}" width="${VIEW.w}" height="${VIEW.h}"`;

const svg = `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}">
  <defs>
${gradients.map((g) => `    <linearGradient id="${ns(g[1])}"${g[2]}>${g[3].trim()}</linearGradient>`).join("\n")}
    ${ramp("sqs-top", PLANE.top)}
    ${ramp("sqs-mid", PLANE.mid)}

    <!-- Every plane fades out toward its far (top) vertex and is full strength
         from its waist down. Without it a plane's back edges cut a bright line
         straight through the S's counters, which the original never does — it
         is the single detail that most makes the stack read as depth. Sampling
         the original's top plane gives ~0 at the top vertex, ~0.5 halfway and
         1 at the waist: a linear ramp over exactly the plane's half-height. -->
${(["top", "mid", "bot"] as const).map((k) =>
  `    <linearGradient id="sqs-fade-${k}" gradientUnits="userSpaceOnUse" x1="0" y1="${PLANE[k] - B}" x2="0" y2="${PLANE[k]}">` +
  `<stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient>`).join("\n")}

    <!-- …and a nearer plane hides a farther one outright, so you never see
         through the stack. A standalone mark cannot paint an opaque fill —
         that would have to be the page's own background colour, which it
         cannot know — so the occlusion is masking instead, which works on any
         ground. Fade and occlusion share one mask per plane: the ramp supplies
         the greys, the nearer silhouettes punch the holes. -->
    <mask id="sqs-plane-top" maskUnits="userSpaceOnUse" ${box}>
      <rect ${box} fill="url(#sqs-fade-top)"/>
    </mask>
    <mask id="sqs-plane-mid" maskUnits="userSpaceOnUse" ${box}>
      <rect ${box} fill="url(#sqs-fade-mid)"/>
      <path d="${plane(PLANE.top)}" fill="#000"/>
    </mask>
    <mask id="sqs-plane-bot" maskUnits="userSpaceOnUse" ${box}>
      <rect ${box} fill="url(#sqs-fade-bot)"/>
      <path d="${plane(PLANE.top)}" fill="#000"/>
      <path d="${plane(PLANE.mid)}" fill="#000"/>
    </mask>
  </defs>

  <g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <!-- corner posts, left and right only: the original has none front or back -->
    <g stroke="${GREY}" stroke-width="2" stroke-dasharray="5 6" opacity="0.4">
      <path d="M${n(CX - POST)} ${PLANE.top}L${n(CX - POST)} ${PLANE.bot}"/>
      <path d="M${n(CX + POST)} ${PLANE.top}L${n(CX + POST)} ${PLANE.bot}"/>
    </g>

    <!-- bottom plane: dashed, carrying the wired graph -->
    <g mask="url(#sqs-plane-bot)">
      <path d="${plane(PLANE.bot)}" stroke="${GREY}" stroke-width="${GREY_SW}" stroke-dasharray="${DASH}"/>
      <g stroke="${CYAN}" stroke-width="3">
        <path d="${wire(RING.l, RING.b)}"/>
        <path d="${wire(RING.b, RING.r)}"/>
        ${ring(RING.l)}${ring(RING.b)}${ring(RING.r)}
      </g>
    </g>

    <!-- middle plane: the components -->
    <g mask="url(#sqs-plane-mid)">
      <path d="${plane(PLANE.mid)}" stroke="url(#sqs-mid)" stroke-width="${SW}"/>
      <g stroke="url(#sqs-mid)" stroke-width="3">
        ${DIAMONDS.map((d) => `<path d="${diamond(on(PLANE.mid, ...d), 22, 15, 5)}"/>`).join("\n        ")}
      </g>
    </g>

    <!-- top plane: what the S stands on. It sits ~15% dimmer than the middle
         one in the original, which keeps it from competing with the mark. -->
    <g mask="url(#sqs-plane-top)" opacity="0.85">
      <path d="${plane(PLANE.top)}" stroke="url(#sqs-top)" stroke-width="${SW}"/>
    </g>
  </g>

  <g transform="translate(${tx} ${ty}) scale(${scale})">
    ${paths.map((m) => `<path fill="url(#${ns(m[1])})" d="${m[2]}"/>`).join("\n    ")}
  </g>
</svg>
`;

const dest = join(root, "docs/assets/mark-stack.svg");
writeFileSync(dest, svg);
console.log(`wrote ${dest} — ${svg.length} bytes`);
