// The reel's two zoom dives, as CSS keyframes — computed, never measured by hand.
//
// docs/notes/zoom-transitions.md is the product's own dive: the outgoing
// diagram scales up about the card you clicked while that card travels to the
// middle of the screen, and the incoming diagram grows out of that card.
// The playground does it in 460 ms with an imperative transform. A video wants
// the same move slower and *tied together*: here both layers ride ONE camera, so
// the incoming picture is literally the card's interior — its scale is the
// camera's scale times k0 (the ratio that makes it match the card's footprint
// at the start) and its centre rides the card's centre. Cross-fade and a touch
// of motion blur hide the seam between two pictures that share nothing but the
// card.
//
// Easing is baked into the stops (an ease-in-out evaluated numerically, with an
// exponential scale so the zoom keeps one apparent speed), so the timing
// function between stops is linear and the dive is the same on every browser.
// A stop per 60 fps frame (60 across a 1 s dive) keeps the motion smooth at
// 30 or 60 fps: with a coarser grid (the page this was ported from used 16) the
// stops do not divide into frames evenly, velocity steps at each one, and the
// dive beats at three frames in a way a still can't show.
//
// Inputs are read off the rendered SVGs by the caller: each picture's size and
// the box of the card the camera dives through, both in that SVG's own px.
// Nothing here knows a pixel of the output — only the picture box it is drawn in.

/** One dive, seconds. 1.0 (not the 1.5 it first shipped at): the zoom is the clip's showpiece, but a reader
 *  has seen where it is going by 0.7 s and the rest is waiting. DIVE=1.5 brings the slower cut back. */
export const DIVE_S = Number(process.env.DIVE ?? 1.0);
const STOPS = Math.round(DIVE_S * 60); // keyframes per dive: one per 60 fps frame
const PANE = { w: 880, h: 616 }; // the box a picture is contained in (reel.html: inset 48px 0 0 0 of 880×664)
const C = { x: PANE.w / 2, y: PANE.h / 2 };

/** The montage's cuts, seconds each: they accelerate. */
const MONT = [0.70, 0.62, 0.55, 0.50, 0.45, 0.42, 0.38, 0.35, 0.32, 0.30, 0.30, 0.30];

/** The reel's timeline, seconds — every other time in the clip is computed from these. The holds are what a
 *  reader needs to take a picture in: GAP between the two dives, TABLES on the finished tables view, FADE
 *  out of the app scene into the montage. */
const HOLD = { gap: 1.6, tables: 2.4, fade: 1.0, install: 5.6 };
export const T = (() => {
  const appear = 9.0, dive1 = 11.6;
  const dive2 = dive1 + DIVE_S + HOLD.gap;
  const appFade = dive2 + DIVE_S + HOLD.tables; // the app scene starts leaving
  const appEnd = appFade + HOLD.fade;           // …and the montage takes over
  const montEnd = appEnd + MONT.reduce((a, b) => a + b, 0);
  const inst = montEnd + 0.31;                  // the install card starts typing
  return { appear, dive1, dive2, appFade, appEnd, montStart: appEnd, montEnd, inst, loop: inst + HOLD.install };
})();
/** seconds — every keyframe percentage is a fraction of this */
export const LOOP = Math.round(T.loop * 100) / 100;

export interface Size { w: number; h: number }
export interface Box { x: number; y: number; w: number; h: number }
export interface DiveInput {
  landscape: Size; service: Size; database: Size;
  /** the Orders card in the landscape SVG, and the Postgres card in the service SVG */
  orders: Box; pg: Box;
}

const strip = (s: string) => s.replace(/0+$/, "").replace(/\.$/, "");
const num = (v: number) => strip(v.toFixed(2));
const pct = (s: number) => strip(((s / LOOP) * 100).toFixed(3));
const tf = (tx: number, ty: number, s: number) => `translate(${num(tx)}px,${num(ty)}px) scale(${strip(s.toFixed(4))})`;
const ID = "translate(0px,0px) scale(1)";

/** cubic-bezier(.42, 0, .18, 1) solved for y at progress x = u */
function ease(u: number): number {
  const [x1, y1, x2, y2] = [0.42, 0.0, 0.18, 1.0];
  let lo = 0, hi = 1;
  for (let i = 0; i < 40; i++) {
    const t = (lo + hi) / 2;
    const x = 3 * (1 - t) ** 2 * t * x1 + 3 * (1 - t) * t * t * x2 + t ** 3;
    if (x < u) lo = t; else hi = t;
  }
  const t = (lo + hi) / 2;
  return 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t * t * y2 + t ** 3;
}

/** how an SVG of this size sits, contained, in the picture box */
function display(img: Size) {
  const s = Math.min(PANE.w / img.w, PANE.h / img.h);
  const w = img.w * s, h = img.h * s;
  return { s, ox: (PANE.w - w) / 2, oy: (PANE.h - h) / 2, w, h };
}

function cardInBox(img: Size, box: Box) {
  const d = display(img);
  return {
    cx: d.ox + (box.x + box.w / 2) * d.s, cy: d.oy + (box.y + box.h / 2) * d.s,
    cw: box.w * d.s, ch: box.h * d.s,
  };
}

type Row = [pct: string, transform: string, opacity: number, blur: number];

function dive(out: Size, box: Box, inn: Size, start: number) {
  const { cx: px, cy: py, cw, ch } = cardInBox(out, box);
  const k0 = cw / display(inn).w; // the incoming picture matches the card's width at the start
  const S = 1 / k0; // the camera scale that settles it at identity
  const outRows: Row[] = [], inRows: Row[] = [];
  for (let i = 0; i <= STOPS; i++) {
    const u = i / STOPS;
    const g = ease(u);
    const s = S ** g; // exponential zoom
    const qx = px + (C.x - px) * g; // the card's centre travels to the middle
    const qy = py + (C.y - py) * g;
    const tx = qx - C.x - s * (px - C.x);
    const ty = qy - C.y - s * (py - C.y);
    // outgoing: fades 0.55..0.85 of the dive, blur grows to 3px; incoming: fades in .15..0.5, blur 3px -> 0 by .7
    const oo = u <= 0.55 ? 1 : Math.max(0, 1 - (u - 0.55) / 0.3);
    const ob = 3 * Math.min(1, u / 0.8);
    const io = u <= 0.15 ? 0 : Math.min(1, (u - 0.15) / 0.35);
    const ib = 3 * Math.max(0, 1 - u / 0.7);
    const at = pct(start + u * DIVE_S);
    outRows.push([at, tf(tx, ty, s), oo, ob]);
    inRows.push([at, tf(qx - C.x, qy - C.y, k0 * s), io, ib]);
  }
  return { px, py, cw, ch, k0, S, outRows, inRows };
}

const stops = (rows: Row[]) => rows.map(([p, t, o, b]) => `  ${p}%{opacity:${num(o)};transform:${t};filter:blur(${num(b)}px)}`);
const block = (name: string, lines: string[]) => `@keyframes ${name}{\n${lines.join("\n")}}\n`;
const ring = (name: string, on: number, hit: number) => block(name, [
  "  0%{opacity:0}", `  ${pct(on)}%{opacity:0}`, `  ${pct(on + 0.35)}%{opacity:1}`,
  `  ${pct(hit)}%{opacity:1}`, `  ${pct(hit + 0.55 * DIVE_S)}%{opacity:0}`, "  100%{opacity:0}",
]);
const ringBox = (d: { px: number; py: number; cw: number; ch: number }, pad = 6) => {
  const r = (v: number) => Math.round(v * 10) / 10;
  return `left: ${r(d.px - d.cw / 2 - pad)}px; top: ${r(d.py - d.ch / 2 - pad)}px; width: ${r(d.cw + 2 * pad)}px; height: ${r(d.ch + 2 * pad)}px`;
};

/** The five keyframe blocks the reel's layers and rings run on, plus the ring boxes. */
export function diveCss(i: DiveInput) {
  const d1 = dive(i.landscape, i.orders, i.service, T.dive1);
  const d2 = dive(i.service, i.pg, i.database, T.dive2);
  const ap0 = pct(T.appear), ap1 = pct(T.appear + 0.8);

  // A: the landscape — arrives with the pane, leaves through dive 1
  const a = [
    `  0%{opacity:0;transform:${ID};filter:blur(0px)}`,
    `  ${ap0}%{opacity:0;transform:${ID};filter:blur(0px)}`,
    `  ${ap1}%{opacity:1;transform:${ID};filter:blur(0px)}`,
    ...stops(d1.outRows),
    `  100%{opacity:0;transform:${d1.outRows.at(-1)![1]};filter:blur(3px)}`,
  ];
  // B: the Orders view — arrives out of the card, leaves through dive 2
  const b = [
    `  0%{opacity:0;transform:${d1.inRows[0][1]};filter:blur(3px)}`,
    ...stops(d1.inRows), ...stops(d2.outRows),
    `  100%{opacity:0;transform:${d2.outRows.at(-1)![1]};filter:blur(3px)}`,
  ];
  // C: the database — arrives out of the Postgres card and stays
  const c = [
    `  0%{opacity:0;transform:${d2.inRows[0][1]};filter:blur(3px)}`,
    ...stops(d2.inRows),
    `  100%{opacity:1;transform:${ID};filter:blur(0px)}`,
  ];
  return {
    css: block("sq-A", a) + block("sq-B", b) + block("sq-C", c)
      + ring("sq-ringA", T.dive1 - 0.7, T.dive1) + ring("sq-ringB", T.dive2 - 0.7, T.dive2),
    ringA: ringBox(d1), ringB: ringBox(d2),
    info: { k0: [d1.k0, d2.k0], S: [d1.S, d2.S], p1: [d1.px, d1.py], p2: [d2.px, d2.py] },
  };
}

// ---- everything else on the timeline -----------------------------------------------------------------
const kf = (name: string, rows: [s: number, decl: string][]) =>
  `@keyframes ${name}{${rows.map(([t, d]) => `${pct(t)}%{${d}}`).join("")}}\n`;
const hide = "opacity:0", show = "opacity:1";

/** The keyframes that are not a dive: the wall, the prompt, the agent's lines, the pane, the app / montage /
 *  close scenes and the view bar. Seconds in, percentages of LOOP out — change a number in `T` or `HOLD` and
 *  everything after it moves with it. (Late starters — the typed lines — carry an animation-delay and put
 *  themselves away before the loop wraps, so the next pass never shows stale text.) */
export function timelineCss() {
  const out: string[] = [];
  const bar = (d: number) => [d + DIVE_S / 3, d + 0.6 * DIVE_S]; // the bar changes mid-dive
  const [a1, a2] = bar(T.dive1), [b1, b2] = bar(T.dive2);
  // the wall, 0–3.5 s
  out.push(kf("sq-wall", [[0, hide], [0.4, show], [2.7, show], [3.5, hide], [LOOP, hide]]));
  out.push(kf("sq-driftA", [[0, "transform:translateX(0)"], [3.5, "transform:translateX(-210px)"], [LOOP, "transform:translateX(-210px)"]]));
  out.push(kf("sq-driftB", [[0, "transform:translateX(-210px)"], [3.5, "transform:translateX(0)"], [LOOP, "transform:translateX(0)"]]));
  out.push(kf("sq-band", [[0, "transform:translateX(-110%)"], [0.3, "transform:translateX(-110%)"], [0.9, "transform:translateX(0)"],
    [2.5, "transform:translateX(0)"], [3.2, "transform:translateX(-110%)"], [LOOP, "transform:translateX(-110%)"]]));
  // the prompt card starts large and centred, then shrinks to a bar on top
  const big = "left:70px;top:300px;width:800px;height:160px;font-size:34px", small = "left:30px;top:28px;width:880px;height:56px;font-size:22px";
  out.push(kf("sq-card", [[0, big], [5.0, big], [5.6, small], [LOOP, small]]));
  out.push(kf("sq-caretwin", [[0, show], [3.79, show], [3.82, hide], [LOOP, hide]]));
  out.push(`@keyframes sq-blink{0%,49%{opacity:1}50%,100%{opacity:0}}\n`);
  // typed text and the agent's lines: reveal, hold, put away
  const clip = (r: number) => `clip-path:inset(0 ${r}% 0 0)`;
  out.push(kf("sq-type", [[0, clip(100)], [1.0, "clip-path:inset(0 -2px 0 0)"], [24.0, "clip-path:inset(0 -2px 0 0)"], [24.1, clip(100)], [LOOP, clip(100)]]));
  const up = "opacity:0;transform:translateY(8px)", on = "opacity:1;transform:translateY(0)";
  out.push(kf("sq-line", [[0, up], [0.36, on], [20.5, on], [20.6, up], [LOOP, up]]));
  out.push(kf("sq-lines", [[0, show], [T.appear - 0.3, show], [T.appear + 0.5, hide], [LOOP, hide]]));
  out.push(kf("sq-pane", [[0, "opacity:0;transform:translateY(36px)"], [T.appear, "opacity:0;transform:translateY(36px)"],
    [T.appear + 0.8, "opacity:1;transform:translateY(0)"], [LOOP, "opacity:1;transform:translateY(0)"]]));
  // the scenes
  out.push(kf("sq-app", [[0, hide], [3.0, hide], [3.6, show], [T.appFade, show], [T.appEnd, hide], [LOOP, hide]]));
  out.push(kf("sq-mont", [[0, hide], [T.montStart - 0.1, hide], [T.montStart, show], [T.montEnd + 0.1, show], [T.montEnd + 0.6, hide], [LOOP, hide]]));
  let t = T.montStart;
  MONT.forEach((dur, i) => {
    const big = "opacity:1;transform:scale(1.06)", flat = "opacity:1;transform:scale(1)";
    const b0 = t + Math.min(0.25, dur * 0.7), c0 = t + dur;
    out.push(kf(`sq-m${i}`, [[0, "opacity:0;transform:scale(1.06)"], [t, "opacity:0;transform:scale(1.06)"], [t + 0.02, big], [b0, flat],
      [c0, flat], [c0 + 0.02, "opacity:0;transform:scale(1)"], [LOOP, "opacity:0;transform:scale(1)"]]));
    t += dur;
  });
  const rise = "opacity:0;transform:translateY(14px)", rest = "opacity:1;transform:translateY(0)";
  out.push(kf("sq-inst", [[0, rise], [T.inst, rise], [T.inst + 0.6, rest], [T.inst + 5.1, rest], [T.inst + 5.5, "opacity:0;transform:translateY(0)"], [LOOP, "opacity:0;transform:translateY(0)"]]));
  out.push(kf("sq-type2", [[0, clip(100)], [0.9, "clip-path:inset(0 -2px 0 0)"], [6.5, "clip-path:inset(0 -2px 0 0)"], [6.6, clip(100)], [LOOP, clip(100)]]));
  // the view bar: home, then one hop per altitude, changing as each zoom lands
  out.push(kf("sq-bar1", [[0, show], [a1, show], [a2, hide], [LOOP, hide]]));
  out.push(kf("sq-bar2", [[0, hide], [a1, hide], [a2, show], [b1, show], [b2, hide], [LOOP, hide]]));
  out.push(kf("sq-bar3", [[0, hide], [b1, hide], [b2, show], [LOOP, show]]));
  return out.join("");
}

/** The animation-delays of the install card's two typed commands and their notes, seconds. */
export function installDelays() {
  const f = (v: number) => strip(v.toFixed(2));
  return { t1: f(T.inst), n1: f(T.inst + 1.0), t2: f(T.inst + 1.1), n2: f(T.inst + 2.1) };
}
