// Tracks: the one routing primitive (REQUIREMENTS §5.3).
//
// A channel is the strip between two rows — or, turned on its side, the
// gutter between two neighbours. Everything that turns in it is a `Net`: a
// horizontal run on one track, with stubs up to the row above (`tops`) and
// down to the row below (`bots`). A plain dog-leg has one of each; a wire
// going round under a row has two tops; a trunk has one top and many bots.
//
// Two nets whose runs overlap need different tracks, and which is above
// decides how often they cross: with A above B, A's stubs down cross B's
// run, and B's stubs up cross A's. `stack` orders the nets so that wires
// which need not cross do not — and never puts one wire's stub on top of
// another's, which is what a stub down and a stub up at the same place
// would be if the wrong net were above.

export interface Net {
  id: string;
  tops: number[]; bots: number[];
  /** extent of the run; a run to a wall reaches past every stub */
  lo: number; hi: number;
  /** room a label on the run needs across the tracks, or 0 */
  thick: number;
}

/** Runs closer than this, end to end, do not share a track. */
const CLEAR = 16;
const CLASH = 1000;
const overlap = (a: Net, b: Net) => a.lo < b.hi + CLEAR && b.lo < a.hi + CLEAR;
const inside = (x: number, n: Net) => x > n.lo && x < n.hi;

/** What it costs to put `a` on a track above `b`: the crossings it draws, and
 *  far more if a stub of `a` going down would lie along one of `b` coming up. */
export function above(a: Net, b: Net): number {
  if (!overlap(a, b)) return 0;
  let cost = 0;
  for (const x of a.bots) { if (inside(x, b)) cost++; if (b.tops.includes(x)) cost += CLASH; }
  for (const x of b.tops) if (inside(x, a)) cost++;
  return cost;
}

export interface Stack {
  /** net id → track, 0 nearest the row above */
  track: Map<string, number>;
  count: number;
  /** two nets that cannot be stacked without one stub lying on another */
  clash?: { upper: Net; lower: Net; at: number };
}

export function stack(nets: readonly Net[]): Stack {
  // insert each net where it costs least among those already placed
  const order: Net[] = [];
  for (const n of [...nets].sort((p, q) => p.lo - q.lo || p.hi - q.hi || (p.id < q.id ? -1 : 1))) {
    let best = 0, least = Infinity;
    for (let at = 0; at <= order.length; at++) {
      let cost = 0;
      for (let i = 0; i < order.length; i++) cost += i < at ? above(order[i], n) : above(n, order[i]);
      // a net with no stub down hugs the row above; one with no stub up, the row below
      if (cost < least || (cost === least && !n.tops.length)) { least = cost; best = at; }
    }
    order.splice(best, 0, n);
  }
  // …then let neighbours trade while that helps
  for (let pass = 0, moved = true; moved && pass < order.length; pass++) {
    moved = false;
    for (let i = 0; i + 1 < order.length; i++)
      if (above(order[i + 1], order[i]) < above(order[i], order[i + 1])) { [order[i], order[i + 1]] = [order[i + 1], order[i]]; moved = true; }
  }

  // tracks: as near the row above as the order allows; a net with nothing
  // above it to reach sinks to the row below instead
  const track = new Map<string, number>();
  let count = 0;
  order.forEach((n, i) => {
    let t = 0;
    for (let j = 0; j < i; j++) if (overlap(order[j], n)) t = Math.max(t, track.get(order[j].id)! + 1);
    track.set(n.id, t);
    count = Math.max(count, t + 1);
  });
  for (let i = order.length - 1; i >= 0; i--) {
    if (order[i].tops.length) continue;
    let t = count - 1;
    for (let j = i + 1; j < order.length; j++) if (overlap(order[i], order[j])) t = Math.min(t, track.get(order[j].id)! - 1);
    track.set(order[i].id, t);
  }

  let clash: Stack["clash"];
  for (let i = 0; i < order.length && !clash; i++)
    for (let j = i + 1; j < order.length && !clash; j++)
      if (above(order[i], order[j]) >= CLASH) clash = { upper: order[i], lower: order[j], at: order[i].bots.find((x) => order[j].tops.includes(x))! };
  return { track, count, clash };
}

/** Where each track stands, measured from the first: 16 apart, and further
 *  where a run carries a label. */
export function pitch(nets: readonly Net[], s: Stack): number[] {
  const thick = new Array<number>(s.count).fill(0);
  for (const n of nets) thick[s.track.get(n.id)!] = Math.max(thick[s.track.get(n.id)!], n.thick);
  const at: number[] = [];
  for (let t = 0; t < s.count; t++) at.push(t ? at[t - 1] + 16 + Math.ceil((thick[t - 1] + thick[t]) / 2) : Math.ceil(thick[0] / 2));
  return at;
}
