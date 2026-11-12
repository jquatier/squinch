// Order: which box stands where within its rank, when the author has not said.
//
// Declaration order is the default and stays the default wherever a hint
// (`rows`, `cols`, `place`) named the members — then the order *is* the hint.
// A container nobody arranged is `free`: its boxes are sorted so the wires
// between ranks cross as little as possible, by the classic sweep — order each
// rank by the average position of what it connects to in the ranks above,
// then by the ranks below, and keep the best arrangement seen.

import type { Edge } from "./rank.js";

/** How many pairs of edges between the same two ranks cross. */
export function crossings(order: readonly string[], rank: ReadonlyMap<string, number>, edges: readonly Edge[]): number {
  const at = new Map(order.map((id, i) => [id, i]));
  const key = ([a, b]: Edge) => `${rank.get(a)}>${rank.get(b)}`;
  let n = 0;
  for (let i = 0; i < edges.length; i++)
    for (let j = i + 1; j < edges.length; j++) {
      const [a, b] = edges[i], [c, d] = edges[j];
      if (key(edges[i]) !== key(edges[j]) || rank.get(a) === rank.get(b)) continue;
      if ((at.get(a)! - at.get(c)!) * (at.get(b)! - at.get(d)!) < 0) n++;
    }
  return n;
}

/**
 * `initial`, reordered within each rank to cross fewer wires. Members of
 * different ranks keep their relative order (it carries no meaning), and a
 * member with nothing on the side being followed keeps its place in its rank.
 */
export function orderBoxes(initial: readonly string[], rank: ReadonlyMap<string, number>, edges: readonly Edge[]): string[] {
  const ranks = [...new Set(initial.map((id) => rank.get(id)!))].sort((a, b) => a - b);
  let rows = ranks.map((r) => initial.filter((id) => rank.get(id) === r));
  const flat = (rs: string[][]) => rs.flat();
  let best = flat(rows), bestCost = crossings(best, rank, edges);

  for (let sweep = 0; sweep < 8 && bestCost > 0; sweep++) {
    const down = sweep % 2 === 0;
    const next = rows.map((r) => [...r]);
    for (const ri of down ? rows.keys() : [...rows.keys()].reverse()) {
      // where everything sits right now, as a fraction of its own row
      const where = new Map(next.flatMap((row) => row.map((id, i) => [id, (i + 0.5) / row.length] as const)));
      const r = ranks[ri];
      const mean = (id: string) => {
        const others = edges.flatMap(([a, b]) => (a === id ? [b] : b === id ? [a] : []))
          .filter((o) => (down ? rank.get(o)! < r : rank.get(o)! > r));
        return others.length ? others.reduce((s, o) => s + where.get(o)!, 0) / others.length : undefined;
      };
      const row = next[ri];
      const keyed = row.map((id, i) => ({ id, i, key: mean(id) }));
      const movable = keyed.filter((k) => k.key !== undefined).sort((p, q) => p.key! - q.key! || p.i - q.i);
      next[ri] = keyed.map((k) => (k.key === undefined ? k.id : movable.shift()!.id));
    }
    rows = next;
    const cost = crossings(flat(rows), rank, edges);
    if (cost < bestCost) { best = flat(rows); bestCost = cost; }
  }
  return best;
}
