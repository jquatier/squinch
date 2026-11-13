// One container's order: where its boxes, its passing wires and its wall
// ports stand in each layer, what that costs in crossings, and the moves
// that change it. `order.ts` drives these for every container together.
//
// The cost is a model, but an exact one: measured against finished pictures
// it agrees with the crossings actually drawn. It counts
//   · two wires between neighbouring layers whose ends stand the other way
//     round at one layer than at the other,
//   · a wire passing between a box and the side wall that box's own wires
//     leave by,
//   · and, forbidden outright, anything standing between two neighbours a
//     same-rank wire joins.
// A child container counts by where each wire's port stands on its wall —
// asked afresh every time, because that order is the child's to change.

import { WIRE_BOX, WIRE_WIRE, type Chain, type Layer, type Slot, type Wire } from "./types.js";

const SWEEPS = 12;
const TIDY_SWEEPS = 4;  // …when nothing crosses and only straightness is left to gain
/** One pixel of stretch against one crossing: all of a picture's stretch together stays under one. */
export const FINE = 1e-7;

/** One container's ordering, kept so the whole picture can be ordered
 *  together (`order-all.ts`): its cost as it stands, and its moves. */
export interface SlotOrder {
  /** Sweeps, then trades. `outer` is what the order of this container's
   *  wall ports costs the container outside: with it, a port goes where the
   *  two sides of the wall together cross least. `outer.now` is that cost as
   *  the outside stands; `outer.settled`, once the outside has re-sorted
   *  what is its alone to suit — dearer to ask, and what a trade is judged
   *  by, since two ports changing places is only worth it if the wires
   *  outside can follow. */
  settle(outer?: { now(): number; settled(): number }): void;
  /** `cost`, after this container has re-sorted everything but its own wall
   *  ports — without keeping the result. */
  costSettled(): number;
  /** Crossings in this container as its slots now stand — plus, far below
   *  one crossing's worth, how far from straight its wires are. */
  cost(): number;
  /** Trade neighbours while it removes a crossing — leaving the wall ports
   *  where they are, which is not this container's call alone. */
  polish(): void;
}

export function slotOrder(
  layers: Layer[], chains: readonly Chain[], neighbours: readonly (readonly [string, string])[],
  /** Where on a container's wall a wire's port is, as a fraction of the
   *  wall, read afresh each time: its inside decides, and may yet change its
   *  mind. Two wires into one container cross or not by this; two wires into
   *  a plain box never do, their ports follow. */
  fixed: (s: Slot, wire: Wire) => number = () => 0,
  /** Where along this container's wall a wire through it ends up outside,
   *  0 to 1, if a drawing has shown: only ever a tie-break between places
   *  that cross the same — for a wall port, one more neighbour to stand
   *  near; for a wire passing a rank on its way out, which side of the box
   *  it goes round. */
  headed: (s: Slot) => number | undefined = () => undefined,
  /** Among places that are otherwise as good, take the one furthest along
   *  the row: in a titled container that is the side away from the title, so
   *  a wire going round the boxes does not open a band beneath it. */
  preferFar = false,
  /** How many wires leave each box sideways, toward the low wall and the
   *  high: a wire passing on that side of the box crosses every one. */
  sideways: ReadonlyMap<string, { low: number; high: number }> = new Map(),
  /** The lane gap between two boxes of this container. */
  gap = 48,
): SlotOrder {
  // hops[i]: between layer i and i+1, each end carrying its place within its slot
  type Hop = [u: Slot, v: Slot, wire: Wire];
  const hops: Hop[][] = layers.map(() => []);
  const plain = (s: Slot) => !s.box?.group;
  chains.forEach((c) => c.path.forEach((s, i) => {
    const next = c.path[i + 1];
    // two wires between the same two plain slots are one hop: they cannot cross
    if (next && !(plain(s) && plain(next) && hops[c.first + i].some(([u, v]) => u === s && v === next)))
      hops[c.first + i].push([s, next, c.wire]);
  }));
  const beside = new Set(neighbours.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]));
  let outer: { now(): number; settled(): number } | undefined;

  const reinsert = (li: number, s: Slot, useAbove: boolean, useBelow: boolean, settled = true) => {
    const layer = layers[li].slots;
    const home = layer.indexOf(s);
    layer.splice(home, 1);
    const index = (other: Slot[]) => new Map(other.map((x, i) => [x, i]));
    const above = li > 0 ? index(layers[li - 1].slots) : new Map<Slot, number>();
    const below = li + 1 < layers.length ? index(layers[li + 1].slots) : new Map<Slot, number>();
    const here = index(layer);
    const upHop = useAbove && li > 0 ? hops[li - 1].find(([, v]) => v === s) : undefined;
    const dnHop = useBelow ? hops[li]?.find(([u]) => u === s) : undefined;
    const up = upHop?.[0], dn = dnHop?.[1];
    let best = { p: 0, key: [Infinity, Infinity, Infinity] };
    for (let p = 0; p <= layer.length; p++) {
      let cost = 0;
      // an inserted slot at p sits left of here-index ≥ p
      const side = (x: Slot) => (here.get(x)! < p ? -1 : 1);
      if (upHop) for (const [u, v, w] of hops[li - 1]) {
        const far = above.get(u)! + fixed(u, w) - above.get(up!)! - fixed(up!, upHop[2]);
        if (v !== s && far && here.has(v) && Math.sign(far) !== side(v)) cost++;
      }
      if (dnHop) for (const [u, v, w] of hops[li]) {
        const far = below.get(v)! + fixed(v, w) - below.get(dn!)! - fixed(dn!, dnHop[2]);
        if (u !== s && far && here.has(u) && Math.sign(far) !== side(u)) cost++;
      }
      // a wire passing between a box and the side wall its own wires leave by
      if (s.kind !== "box")
        for (const x of layer) {
          const out = x.kind === "box" ? sideways.get(x.id) : undefined;
          if (out) cost += side(x) > 0 ? out.low : out.high;
        }
      // what standing here costs on the far side of the wall
      if (outer && s.kind === "port") {
        layer.splice(p, 0, s);
        cost += outer.now();
        layer.splice(p, 1);
      }
      // never between two boxes a same-rank wire joins directly
      const l = layer[p - 1], r = layer[p];
      if (l?.kind === "box" && r?.kind === "box" && beside.has(`${l.id}|${r.id}`)) cost += 100;
      // nearest to where its neighbours are, as a fraction of the row
      const fr = (m: Map<Slot, number>, x: Slot | undefined) => (x && m.size ? (m.get(x)! + 0.5) / m.size : undefined);
      const place = p / Math.max(1, layer.length), goal = s.kind === "box" ? undefined : headed(s);
      const near = [fr(above, up), fr(below, dn), s.kind === "port" ? goal : undefined].filter((x): x is number => x !== undefined);
      const off = Math.abs(place - (near.length ? near.reduce((a, b) => a + b, 0) / near.length : 0.5));
      const stray = goal === undefined ? 0 : Math.abs(place - goal);
      // a settled box keeps its declared place unless leaving it removes a
      // crossing: every place but its own is as far off as can be
      const key = s.kind === "box" && settled ? [cost, p === home ? 0 : 1, 0] : [cost, off, stray];
      const order = key.reduce((d, v, i) => d || (Math.abs(v - best.key[i]) <= 1e-9 ? 0 : v - best.key[i]), 0);
      if (order < 0 || (order === 0 && preferFar && s.kind !== "box")) best = { p, key };
    }
    layer.splice(best.p, 0, s);
  };

  const crossings = (i: number): number => {
    if (i < 0 || i + 1 >= layers.length) return 0;
    const up = new Map(layers[i].slots.map((x, k) => [x, k])), dn = new Map(layers[i + 1].slots.map((x, k) => [x, k]));
    let n = 0;
    const ends = hops[i].map(([u, v, w]) => [up.get(u)! + fixed(u, w), dn.get(v)! + fixed(v, w)]);
    for (let a = 0; a < ends.length; a++)
      for (let b = a + 1; b < ends.length; b++)
        if ((ends[a][0] - ends[b][0]) * (ends[a][1] - ends[b][1]) < 0) n++;
    return n;
  };
  /** Wires in layer `i` passing between a box and the side wall its own wires leave by. */
  const barred = (i: number): number => {
    const row = layers[i]?.slots ?? [];
    let n = 0, passing = 0;
    const all = row.filter((x) => x.kind !== "box").length;
    for (const x of row) {
      if (x.kind !== "box") { passing++; continue; }
      const out = sideways.get(x.id);
      if (out) n += passing * out.low + (all - passing) * out.high;
    }
    return n;
  };
  /** Roughly where each slot of a layer would stand: the row packed at its
   *  real sizes and centred. Only for telling straighter from less straight. */
  const lanes = (i: number): Map<Slot, number> => {
    const row = layers[i].slots, at = new Map<Slot, number>();
    let x = 0;
    row.forEach((s, k) => {
      at.set(s, x);
      const next = row[k + 1];
      x += s.lsize + (next ? (s.kind === "box" && next.kind === "box" ? gap : s.kind === "box" || next.kind === "box" ? WIRE_BOX : WIRE_WIRE) : 0);
    });
    for (const [s, v] of at) at.set(s, v - x / 2);
    return at;
  };
  /** How far from straight the wires between layer `i` and the next stand,
   *  in pixels of that rough placing. Only ever weighed against itself — the
   *  least crossing outweighs any amount of it (`FINE`). */
  const stretch = (i: number): number => {
    if (i < 0 || i + 1 >= layers.length) return 0;
    const up = lanes(i), dn = lanes(i + 1);
    const at = (m: Map<Slot, number>, s: Slot, w: Wire) => m.get(s)! + (fixed(s, w) || 0.5) * s.lsize;
    return hops[i].reduce((n, [u, v, w]) => n + Math.abs(at(up, u, w) - at(dn, v, w)), 0);
  };
  const total = () => layers.reduce((n, _, i) => n + crossings(i) + barred(i) + FINE * stretch(i), 0);

  // sweep down following the layer above, up following the layer below, and
  // keep the best arrangement seen — a wire through several ranks only moves
  // as a whole when each sweep looks one way
  const free = (li: number) => layers[li].slots.filter((s) => !s.pinned || s.loose);
  // within a layer, slots are re-placed in the order of what they follow, so
  // each lands beside the neighbours it will keep
  const following = (li: number, down: boolean) => {
    const facing = new Map((down ? layers[li - 1] : layers[li + 1])?.slots.map((x, k) => [x, k]) ?? []);
    const key = (s: Slot) => {
      const hop = down ? hops[li - 1]?.find(([, v]) => v === s) : hops[li]?.find(([u]) => u === s);
      return hop ? facing.get(down ? hop[0] : hop[1])! + fixed(down ? hop[0] : hop[1], hop[2]) : Infinity;
    };
    return free(li).map((s, i) => ({ s, i, k: key(s) })).sort((a, b) => a.k - b.k || a.i - b.i).map((x) => x.s);
  };
  const sweepAll = () => {
    for (let li = 0; li < layers.length; li++) for (const s of free(li)) reinsert(li, s, true, li === 0);
    // Twice from the same start: once with every box keeping its declared
    // place unless leaving it removes a crossing, once with boxes nobody
    // placed going wherever their wires draw them, like any slot. The second
    // is taken only if it crosses less — declaration order is worth a tie.
    const whole = () => total() + (outer?.now() ?? 0);
  const start = layers.map((l) => [...l.slots]), startCost = whole();
    const sweeps = (settled: boolean) => {
      layers.forEach((l, i) => { l.slots = [...start[i]]; });
      let best = start, bestCost = startCost;
      for (let sweep = 0; sweep < (bestCost >= 1 ? SWEEPS : TIDY_SWEEPS) && bestCost > 0; sweep++) {
        const down = sweep % 2 === 1;
        for (const li of down ? layers.keys() : [...layers.keys()].reverse())
          for (const s of following(li, down)) reinsert(li, s, down || li === layers.length - 1, !down || li === 0, settled);
        const cost = total();
        if (cost < bestCost) { best = layers.map((l) => [...l.slots]); bestCost = cost; }
      }
      return { best, bestCost };
    };
    const kept = sweeps(true), freed = kept.bestCost >= 1 ? sweeps(false) : kept; // boxes leave their places for a crossing, never for straightness
    const chosen = freed.bestCost < kept.bestCost ? freed : kept;
    layers.forEach((l, i) => { l.slots = [...chosen.best[i]]; });
  };

  // then trade neighbours while it removes a crossing. Two boxes trade only
  // if both are loose: declaration order stands until a wire from outside,
  // which the box order was settled without, has to cross to keep it.
  const splits = (row: Slot[], i: number) => {
    const l = row[i - 1], r = row[i + 1];
    return row[i].kind !== "box" && l?.kind === "box" && r?.kind === "box" && beside.has(`${l.id}|${r.id}`);
  };
  /** One sweep of trades along a row; true if any made the container better.
   *  A trade at the top level takes what is beside it along: the rows either
   *  side re-sort before it is judged (`deep`), so two wires can change
   *  places all the way down a container in one move — a step no single
   *  swap could take, each half of it crossing something on its own. */
  const trade = (li: number, boxesToo: boolean, walls = true, deep = true): boolean => {
    const row = layers[li]?.slots ?? [];
    let improved = false;
    for (let i = 0; i + 1 < row.length; i++) {
      const [a, b] = [row[i], row[i + 1]];
      if (a.pinned && b.pinned && !(boxesToo && a.loose && b.loose)) continue;
      if (!walls && (a.kind === "port" || b.kind === "port")) continue;
      // wall ports may move, here or in a row beside: the far side of the wall counts
      const around = () => [li - 2, li - 1, li, li + 1].reduce((n, k) => n + crossings(k) + barred(k) + FINE * stretch(k), 0) + (walls && outer ? (deep ? outer.settled() : outer.now()) : 0);
      const before = around();
      const kept = deep ? [layers[li - 1]?.slots.slice(), layers[li + 1]?.slots.slice()] : [];
      [row[i], row[i + 1]] = [b, a];
      if (deep) for (const near of [li - 1, li + 1]) while (trade(near, false, walls, false));
      if (around() < before - 1e-12 && !splits(row, i) && !splits(row, i + 1)) { improved = true; continue; }
      [row[i], row[i + 1]] = [a, b];
      if (deep) [li - 1, li + 1].forEach((near, k) => { if (kept[k]) layers[near].slots = kept[k]!; });
    }
    return improved;
  };
  const trades = (walls: boolean) => {
    for (let round = 0, improved = true; improved && round < 8; round++) {
      improved = false;
      for (let li = 0; li < layers.length; li++) if (trade(li, true, walls)) improved = true;
    }
  };
  return {
    settle: (o) => { outer = o; sweepAll(); trades(true); outer = undefined; },
    cost: total,
    polish: () => trades(false),
    costSettled: () => {
      const kept = layers.map((l) => [...l.slots]);
      trades(false);
      const cost = total();
      layers.forEach((l, i) => { l.slots = kept[i]; });
      return cost;
    },
  };
}
