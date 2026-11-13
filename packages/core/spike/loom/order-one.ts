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
 *  together (`order.ts`): its cost as it stands, and its moves. */
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

  /** Note on every slot of layer `i` its index, and roughly where it would
   *  stand: the row packed at its real sizes and centred. The second is only
   *  for telling straighter from less straight. */
  const mark = (i: number): void => {
    const row = layers[i].slots;
    let x = 0;
    for (let k = 0; k < row.length; k++) {
      const s = row[k], next = row[k + 1];
      s.at = k; s.rough = x;
      x += s.lsize + (next ? (s.kind === "box" && next.kind === "box" ? gap : s.kind === "box" || next.kind === "box" ? WIRE_BOX : WIRE_WIRE) : 0);
    }
    for (const s of row) s.rough! -= x / 2;
  };
  /** What the wires between layer `i` and the next cost: one for every two
   *  whose ends stand the other way round at one layer than at the other —
   *  and, far below one crossing's worth (`FINE`), how far from straight
   *  they are, in pixels of that rough placing. */
  const between = (i: number): number => {
    if (i < 0 || i + 1 >= layers.length) return 0;
    mark(i); mark(i + 1);
    const hs = hops[i], n = hs.length, up = new Float64Array(n), dn = new Float64Array(n);
    let stretch = 0, crossed = 0;
    for (let k = 0; k < n; k++) {
      const [u, v, w] = hs[k], fu = fixed(u, w), fv = fixed(v, w);
      up[k] = u.at! + fu; dn[k] = v.at! + fv;
      stretch += Math.abs(u.rough! + (fu || 0.5) * u.lsize - v.rough! - (fv || 0.5) * v.lsize);
    }
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) if ((up[a] - up[b]) * (dn[a] - dn[b]) < 0) crossed++;
    return crossed + FINE * stretch;
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
  const total = () => layers.reduce((n, _, i) => n + between(i) + barred(i), 0);

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
    const whole = total; // the sweeps are this container's alone; its wall is weighed against the outside in the trades
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
  // who each slot's wires lead to in the layers either side
  const partners = new Map<Slot, Slot[]>();
  for (const hs of hops) for (const [u, v] of hs) {
    (partners.get(u) ?? partners.set(u, []).get(u)!).push(v);
    (partners.get(v) ?? partners.set(v, []).get(v)!).push(u);
  }
  /** Trade `row[i]` and its neighbour if that makes the container better. */
  const tryPair = (li: number, i: number, boxesToo: boolean, walls: boolean, deep: boolean): boolean => {
    const row = layers[li]?.slots ?? [], a = row[i], b = row[i + 1];
    if (!a || !b || (a.pinned && b.pinned && !(boxesToo && a.loose && b.loose))) return false;
    const port = a.kind === "port" || b.kind === "port";
    if (!walls && port) return false;
    const inside = () => between(li - 2) + between(li - 1) + between(li) + between(li + 1) + barred(li - 1) + barred(li) + barred(li + 1);
    // The far side of the wall counts whenever wall ports move. At the top
    // level that is asked once the outside has re-sorted to suit (dear, so
    // only when the wall really changed, and remembered); for a slot merely
    // following in a trade's wake, as the outside stands.
    const counts = walls && !!outer;
    const before = inside() + (deep ? outside : counts && port ? outer!.now() : 0);
    const wall = counts && deep ? wallOrder() : "";
    const kept = deep ? [layers[li - 1]?.slots.slice(), layers[li + 1]?.slots.slice()] : [];
    row[i] = b; row[i + 1] = a;
    // what the two lead to in the rows either side may follow
    if (deep)
      for (const near of [li - 1, li + 1]) {
        const beside = layers[near]?.slots;
        if (!beside) continue;
        for (const x of new Set([...(partners.get(a) ?? []), ...(partners.get(b) ?? [])])) {
          const k = beside.indexOf(x);
          if (k < 0) continue;
          if (!tryPair(near, k - 1, false, walls, false)) tryPair(near, k, false, walls, false);
        }
      }
    const moved = counts && deep && wallOrder() !== wall;
    const beyond = deep ? (moved ? outer!.settled() : outside) : counts && port ? outer!.now() : 0;
    // two boxes leave their declared places for a crossing, never for straightness
    const after = inside() + beyond, gained = a.kind === "box" && b.kind === "box" ? Math.floor(after) < Math.floor(before) : after < before - 1e-12;
    if (gained && !splits(row, i) && !splits(row, i + 1)) { if (deep) outside = beyond; return true; }
    row[i] = a; row[i + 1] = b;
    if (deep) [li - 1, li + 1].forEach((near, k) => { if (kept[k]) layers[near].slots = kept[k]!; });
    return false;
  };
  /** One sweep of trades along a row; true if any made the container better.
   *  A trade at the top level takes what is beside it along (`deep`): what
   *  the two slots lead to in the rows either side may follow before it is
   *  judged, so two wires can change places all the way down a container in
   *  one move — a step no single swap could take, each half of it crossing
   *  something on its own. */
  const trade = (li: number, boxesToo: boolean, walls = true, deep = true): boolean => {
    let improved = false;
    for (let i = 0; i + 1 < (layers[li]?.slots.length ?? 0); i++) if (tryPair(li, i, boxesToo, walls, deep)) improved = true;
    return improved;
  };
  /** What this container's wall ports cost outside, as last asked. */
  let outside = 0;
  const wallOrder = () => layers.filter((l) => l.kind === "wall").map((l) => l.slots.map((s) => s.id).join(",")).join("|");
  const trades = (walls: boolean) => {
    outside = walls && outer ? outer.settled() : 0;
    for (let round = 0, improved = true; improved && round < 8; round++) {
      improved = false;
      for (let li = 0; li < layers.length; li++) if (trade(li, true, walls)) improved = true;
    }
  };
  return {
    settle: (o) => { outer = o; sweepAll(); trades(true); outer = undefined; },
    cost: total,
    costSettled: () => {
      const kept = layers.map((l) => [...l.slots]);
      // one pass of plain trades: enough to let the wires outside follow a port that moved
      for (let li = 0; li < layers.length; li++) while (trade(li, false, false, false));
      const cost = total();
      layers.forEach((l, i) => { l.slots = kept[i]; });
      return cost;
    },
  };
}
