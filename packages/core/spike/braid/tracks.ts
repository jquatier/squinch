// Tracks: where, across a channel, each wire that changes lane makes its turn.
//
// §5.3. A wire comes into the channel from the row above or the row below,
// runs sideways on a track of its own, and leaves the same way (or through
// a side wall). Which of two wires takes the upper track decides whether
// they cross — the wire further along turns first — and whether one's stub
// would be drawn along the other's, which must never happen. Each pair is
// asked which order is cheaper; the tracks are then one order that honours
// as many of those answers as it can, packed so that wires which do not
// overlap share a track.
//
// The wires of one bundle that part here are one net: one track however
// their branches overlap (§5.6).

export interface Run {
  id: number;
  /** Runs with the same net share a track. */
  net?: string;
  /** Where it meets the row above, the row below; whether it leaves by a side wall. */
  top: number[]; bottom: number[];
  east?: boolean; west?: boolean;
  /** A label rides it: how much room it needs across the tracks. */
  thick?: number;
}

/** Two runs whose stubs no order of tracks keeps apart: `upper`'s way down at `x` is `lower`'s way in. */
export interface Clash { upper: number; lower: number; x: number }

interface Shape { ids: number[]; top: number[]; bottom: number[]; lo: number; hi: number }
const CLASH = 100000; // two wires along one line: never
const CLOSE = 50;     // two stubs side by side, nearer than a lane: only to avoid a clash

/** What it costs to give `a` a track above `b`'s: crossings, and stubs that would overlap. */
function above(a: Shape, b: Shape): number {
  let n = 0;
  // a's stubs to the row below pass b's level; b's stubs to the row above pass a's
  for (const x of a.bottom) {
    if (x > b.lo && x < b.hi) n++;
    for (const t of b.top) if (t === x) n += CLASH; else if (Math.abs(t - x) < 8) n += CLOSE;
  }
  for (const x of b.top) if (x > a.lo && x < a.hi) n++;
  return n;
}

/** A track for every run, numbered from the upper row down, and how many there are. */
export function assignTracks(runs: readonly Run[], width = Infinity): { track: Map<number, number>; count: number; clashes: Clash[] } {
  const shapes: Shape[] = [];
  const byNet = new Map<string, Shape>();
  for (const r of runs) {
    let s = r.net !== undefined ? byNet.get(r.net) : undefined;
    if (!s) {
      s = { ids: [], top: [], bottom: [], lo: Infinity, hi: -Infinity };
      shapes.push(s);
      if (r.net !== undefined) byNet.set(r.net, s);
    }
    s.ids.push(r.id);
    for (const x of r.top) if (!s.top.includes(x)) s.top.push(x);
    for (const x of r.bottom) if (!s.bottom.includes(x)) s.bottom.push(x);
    s.lo = Math.min(s.lo, r.west ? 0 : Infinity, ...r.top, ...r.bottom);
    s.hi = Math.max(s.hi, r.east ? width : -Infinity, ...r.top, ...r.bottom);
  }
  const touch = (a: Shape, b: Shape) => a.lo <= b.hi + 8 && b.lo <= a.hi + 8;

  // one order, top track first: each shape goes in where it costs least
  // against those already in, then neighbours trade places while that helps
  const order: Shape[] = [];
  const pair = (hi: Shape, lo: Shape) => (touch(hi, lo) ? above(hi, lo) : 0);
  for (const s of shapes) {
    let best = 0, least = Infinity;
    for (let at = 0; at <= order.length; at++) {
      let c = 0;
      for (let k = 0; k < order.length; k++) c += k < at ? pair(order[k], s) : pair(s, order[k]);
      if (c < least) { least = c; best = at; }
    }
    order.splice(best, 0, s);
  }
  for (let pass = 0, moved = true; moved && pass < 8; pass++) {
    moved = false;
    for (let k = 0; k + 1 < order.length; k++)
      if (pair(order[k + 1], order[k]) < pair(order[k], order[k + 1])) { [order[k], order[k + 1]] = [order[k + 1], order[k]]; moved = true; }
  }

  const track = new Map<number, number>(), level = new Map<Shape, number>();
  let count = 0;
  order.forEach((s, k) => {
    let t = 0;
    for (let j = 0; j < k; j++) if (touch(order[j], s)) t = Math.max(t, level.get(order[j])! + 1);
    level.set(s, t);
    for (const id of s.ids) track.set(id, t);
    count = Math.max(count, t + 1);
  });
  // what no order could prevent: the caller draws the upper one round (lay.ts)
  const clashes: Clash[] = [];
  for (let k = 0; k < order.length; k++)
    for (let j = k + 1; j < order.length; j++) {
      if (!touch(order[k], order[j])) continue;
      for (const x of order[k].bottom) if (order[j].top.includes(x)) clashes.push({ upper: order[k].ids[0], lower: order[j].ids[0], x });
    }
  return { track, count, clashes };
}
