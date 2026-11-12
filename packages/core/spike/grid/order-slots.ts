// Order: where pass-through wires and wall ports sit among the boxes.
//
// Boxes never move here — their order was settled before any wire was routed
// (the author's, or `orderBoxes` for a container nobody arranged). Each wire
// slot is put where it crosses the fewest other wires, nearest to straight on
// a tie.

import type { Chain, Layer, Slot, Wire } from "./types.js";

export function orderSlots(
  layers: Layer[], chains: readonly Chain[], neighbours: readonly (readonly [string, string])[],
  /** Where on a container's wall a wire's port already is, as a fraction of
   *  the wall — its inside decided. Two wires into one container cross or
   *  not by this; two wires into a plain box never do, their ports follow. */
  fixed: (s: Slot, wire: Wire) => number = () => 0,
): void {
  // hops[i]: between layer i and i+1, each end carrying its place within its slot
  type Hop = [u: Slot, v: Slot, fu: number, fv: number];
  const hops: Hop[][] = layers.map(() => []);
  chains.forEach((c) => c.path.forEach((s, i) => {
    const next = c.path[i + 1];
    if (next && !hops[c.first + i].some(([u, v]) => u === s && v === next && !fixed(s, c.wire) && !fixed(next, c.wire)))
      hops[c.first + i].push([s, next, fixed(s, c.wire), fixed(next, c.wire)]);
  }));
  const beside = new Set(neighbours.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]));

  const reinsert = (li: number, s: Slot, useAbove: boolean, useBelow: boolean) => {
    const layer = layers[li].slots;
    layer.splice(layer.indexOf(s), 1);
    const index = (other: Slot[]) => new Map(other.map((x, i) => [x, i]));
    const above = li > 0 ? index(layers[li - 1].slots) : new Map<Slot, number>();
    const below = li + 1 < layers.length ? index(layers[li + 1].slots) : new Map<Slot, number>();
    const here = index(layer);
    const upHop = useAbove && li > 0 ? hops[li - 1].find(([, v]) => v === s) : undefined;
    const dnHop = useBelow ? hops[li]?.find(([u]) => u === s) : undefined;
    const up = upHop?.[0], dn = dnHop?.[1];
    let best = 0, bestCost = Infinity, bestOff = Infinity;
    for (let p = 0; p <= layer.length; p++) {
      let cost = 0;
      // an inserted slot at p sits left of here-index ≥ p
      const side = (x: Slot) => (here.get(x)! < p ? -1 : 1);
      if (upHop) for (const [u, v, fu] of hops[li - 1]) {
        const far = above.get(u)! + fu - above.get(up!)! - upHop[2];
        if (v !== s && far && here.has(v) && Math.sign(far) !== side(v)) cost++;
      }
      if (dnHop) for (const [u, v, , fv] of hops[li]) {
        const far = below.get(v)! + fv - below.get(dn!)! - dnHop[3];
        if (u !== s && far && here.has(u) && Math.sign(far) !== side(u)) cost++;
      }
      // never between two boxes a same-rank wire joins directly
      const l = layer[p - 1], r = layer[p];
      if (l?.kind === "box" && r?.kind === "box" && beside.has(`${l.id}|${r.id}`)) cost += 100;
      // nearest to where its neighbours are, as a fraction of the row
      const fr = (m: Map<Slot, number>, x: Slot | undefined) => (x && m.size ? (m.get(x)! + 0.5) / m.size : undefined);
      const targets = [fr(above, up), fr(below, dn)].filter((x): x is number => x !== undefined);
      const target = targets.length ? targets.reduce((a, b) => a + b, 0) / targets.length : 0.5;
      const off = Math.abs(p / Math.max(1, layer.length) - target);
      if (cost < bestCost || (cost === bestCost && off < bestOff - 1e-9)) { best = p; bestCost = cost; bestOff = off; }
    }
    layer.splice(best, 0, s);
  };

  const crossings = (i: number): number => {
    if (i < 0 || i + 1 >= layers.length) return 0;
    const up = new Map(layers[i].slots.map((x, k) => [x, k])), dn = new Map(layers[i + 1].slots.map((x, k) => [x, k]));
    let n = 0;
    for (let a = 0; a < hops[i].length; a++)
      for (let b = a + 1; b < hops[i].length; b++) {
        const [u1, v1, fu1, fv1] = hops[i][a], [u2, v2, fu2, fv2] = hops[i][b];
        if ((up.get(u1)! + fu1 - up.get(u2)! - fu2) * (dn.get(v1)! + fv1 - dn.get(v2)! - fv2) < 0) n++;
      }
    return n;
  };
  const total = () => layers.reduce((n, _, i) => n + crossings(i), 0);

  // sweep down following the layer above, up following the layer below, and
  // keep the best arrangement seen — a wire through several ranks only moves
  // as a whole when each sweep looks one way
  const free = (li: number) => layers[li].slots.filter((s) => s.kind !== "box");
  for (let li = 0; li < layers.length; li++) for (const s of free(li)) reinsert(li, s, true, li === 0);
  let best = layers.map((l) => [...l.slots]), bestCost = total();
  for (let sweep = 0; sweep < 6 && bestCost > 0; sweep++) {
    const down = sweep % 2 === 1;
    for (const li of down ? layers.keys() : [...layers.keys()].reverse())
      for (const s of free(li)) reinsert(li, s, down || li === layers.length - 1, !down || li === 0);
    const cost = total();
    if (cost < bestCost) { best = layers.map((l) => [...l.slots]); bestCost = cost; }
  }
  layers.forEach((l, i) => { l.slots = best[i]; });

  // then trade neighbours while it removes a crossing. Two boxes never trade.
  const splits = (row: Slot[], i: number) => {
    const l = row[i - 1], r = row[i + 1];
    return row[i].kind !== "box" && l?.kind === "box" && r?.kind === "box" && beside.has(`${l.id}|${r.id}`);
  };
  for (let round = 0, improved = true; improved && round < 8; round++) {
    improved = false;
    for (let li = 0; li < layers.length; li++) {
      const row = layers[li].slots;
      for (let i = 0; i + 1 < row.length; i++) {
        if (row[i].kind === "box" && row[i + 1].kind === "box") continue;
        const before = crossings(li - 1) + crossings(li);
        [row[i], row[i + 1]] = [row[i + 1], row[i]];
        if (crossings(li - 1) + crossings(li) < before && !splits(row, i) && !splits(row, i + 1)) improved = true;
        else [row[i], row[i + 1]] = [row[i + 1], row[i]];
      }
    }
  }
}
