// Order: where pass-through wires and wall ports sit among the boxes.
//
// Boxes never move here — their order was settled before any wire was routed
// (the author's, or `orderBoxes` for a container nobody arranged). Each wire
// slot is put where it crosses the fewest other wires, nearest to straight on
// a tie.

import type { Chain, Layer, Slot, Wire } from "./types.js";

const SWEEPS = 12;

/** One container's ordering, kept so the whole picture can be ordered
 *  together (`order-all.ts`): its cost as it stands, and its moves. */
export interface SlotOrder {
  /** Sweeps, then trades. `outer` is what the order of this container's
   *  wall ports costs the container outside, as that now stands: with it, a
   *  port goes where the two sides of the wall together cross least. */
  settle(outer?: () => number): void;
  /** Crossings in this container as its slots now stand. */
  cost(): number;
  /** Trade neighbours while it removes a crossing — leaving the wall ports
   *  where they are, which is not this container's call alone. */
  polish(): void;
}

export function orderSlots(...args: Parameters<typeof slotOrder>): void {
  slotOrder(...args).settle();
}

export function slotOrder(
  layers: Layer[], chains: readonly Chain[], neighbours: readonly (readonly [string, string])[],
  /** Where on a container's wall a wire's port is, as a fraction of the
   *  wall, read afresh each time: its inside decides, and may yet change its
   *  mind. Two wires into one container cross or not by this; two wires into
   *  a plain box never do, their ports follow. */
  fixed: (s: Slot, wire: Wire) => number = () => 0,
  /** Where along the wall a port's wire is headed once outside, 0 to 1, if
   *  known: the tie-break among places that cross nothing. */
  headed: (s: Slot) => number | undefined = () => undefined,
  /** Among places that are otherwise as good, take the one furthest along
   *  the row: in a titled container that is the side away from the title, so
   *  a wire going round the boxes does not open a band beneath it. */
  preferFar = false,
  /** How many wires leave each box sideways, toward the low wall and the
   *  high: a wire passing on that side of the box crosses every one. */
  sideways: ReadonlyMap<string, { low: number; high: number }> = new Map(),
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
  let outer: (() => number) | undefined;

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
      // two wall ports standing the other way round from where their wires
      // end up cross once outside, where this container cannot see it
      if (s.kind === "port" && headed(s) !== undefined)
        for (const x of layer) {
          const g = x.kind === "port" ? headed(x) : undefined;
          if (g !== undefined && Math.abs(g - headed(s)!) > 1e-9 && Math.sign(g - headed(s)!) !== side(x)) cost++;
        }
      // what standing here costs on the far side of the wall
      if (outer && s.kind === "port") {
        layer.splice(p, 0, s);
        cost += outer();
        layer.splice(p, 1);
      }
      // never between two boxes a same-rank wire joins directly
      const l = layer[p - 1], r = layer[p];
      if (l?.kind === "box" && r?.kind === "box" && beside.has(`${l.id}|${r.id}`)) cost += 100;
      // nearest to where its neighbours are, as a fraction of the row
      const fr = (m: Map<Slot, number>, x: Slot | undefined) => (x && m.size ? (m.get(x)! + 0.5) / m.size : undefined);
      // …and of those, nearest to where the wire is headed. For a wall port
      // that is one more neighbour; for a wire only passing a rank on its
      // way out it decides between places that are otherwise level — which
      // side of the box below it goes round.
      const place = p / Math.max(1, layer.length), goal = headed(s);
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
  /** Pairs of wall ports in layer `i` out of order with where they are headed. */
  const astray = (i: number): number => {
    const goals = (layers[i]?.slots ?? []).flatMap((x) => (x.kind === "port" && headed(x) !== undefined ? [headed(x)!] : []));
    let n = 0;
    for (let a = 0; a < goals.length; a++) for (let b = a + 1; b < goals.length; b++) if (goals[a] > goals[b] + 1e-9) n++;
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
  const total = () => layers.reduce((n, _, i) => n + crossings(i) + astray(i) + barred(i), 0);

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
    const whole = () => total() + (outer?.() ?? 0);
  const start = layers.map((l) => [...l.slots]), startCost = whole();
    const sweeps = (settled: boolean) => {
      layers.forEach((l, i) => { l.slots = [...start[i]]; });
      let best = start, bestCost = startCost;
      for (let sweep = 0; sweep < SWEEPS && bestCost > 0; sweep++) {
        const down = sweep % 2 === 1;
        for (const li of down ? layers.keys() : [...layers.keys()].reverse())
          for (const s of following(li, down)) reinsert(li, s, down || li === layers.length - 1, !down || li === 0, settled);
        const cost = total();
        if (cost < bestCost) { best = layers.map((l) => [...l.slots]); bestCost = cost; }
      }
      return { best, bestCost };
    };
    const kept = sweeps(true), freed = kept.bestCost > 0 ? sweeps(false) : kept;
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
  /** One sweep of trades along a row; true if any removed a crossing. */
  const trade = (li: number, boxesToo: boolean, walls = true): boolean => {
    const row = layers[li]?.slots ?? [];
    let improved = false;
    for (let i = 0; i + 1 < row.length; i++) {
      const [a, b] = [row[i], row[i + 1]];
      if (a.pinned && b.pinned && !(boxesToo && a.loose && b.loose)) continue;
      if (!walls && (a.kind === "port" || b.kind === "port")) continue;
      const ports = a.kind === "port" || b.kind === "port", boxes = a.kind === "box" && b.kind === "box";
      // two boxes trading may take wall ports along (the rows either side
      // re-sort), so the far side of the wall is counted for them too
      const around = () => crossings(li - 2) + crossings(li - 1) + crossings(li) + crossings(li + 1) + astray(li - 1) + astray(li) + astray(li + 1) + barred(li - 1) + barred(li) + barred(li + 1)
        + ((ports || boxes) && outer ? outer() : 0);
      const before = around();
      // two boxes trading take the wires beside them along: the rows either
      // side get to re-sort before the trade is judged
      const kept = boxes ? [layers[li - 1]?.slots.slice(), layers[li + 1]?.slots.slice()] : [];
      [row[i], row[i + 1]] = [b, a];
      if (boxes) for (const near of [li - 1, li + 1]) while (trade(near, false, walls));
      if (around() < before && !splits(row, i) && !splits(row, i + 1)) { improved = true; continue; }
      [row[i], row[i + 1]] = [a, b];
      if (boxes) [li - 1, li + 1].forEach((near, k) => { if (kept[k]) layers[near].slots = kept[k]!; });
    }
    return improved;
  };
  const trades = (walls: boolean) => {
    for (let round = 0, improved = true; improved && round < 8; round++) {
      improved = false;
      for (let li = 0; li < layers.length; li++) if (trade(li, true, walls)) improved = true;
    }
  };
  return { settle: (o) => { outer = o; sweepAll(); trades(true); outer = undefined; }, cost: total, polish: () => trades(false) };
}
