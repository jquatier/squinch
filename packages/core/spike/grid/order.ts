// Order: which box stands where within its rank, when the author has not said.
//
// Declaration order is the default, and it is kept whenever it crosses no
// wires. Where it does, the boxes the author did not place (`rows`, `cols`,
// `place` hold a box to its slot) are sorted to cross as little as possible,
// by the classic sweep — order each rank by the average position of what it
// connects to in the ranks above, then by the ranks below, and keep the best
// arrangement seen.

import type { Edge } from "./rank.js";

export interface Leaving { above: number[]; below: number[] }

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
export function orderBoxes(
  initial: readonly string[], rank: ReadonlyMap<string, number>, edges: readonly Edge[],
  /** Where each member's wires to the outside leave the container, as
   *  fractions along its start wall (`above`) and its end wall (`below`).
   *  Known only once the surroundings have been laid out once. */
  outside: ReadonlyMap<string, Leaving> = new Map(),
  /** Members the author placed: each keeps its slot in its rank. */
  held: ReadonlySet<string> = new Set(),
): string[] {
  const ranks = [...new Set(initial.map((id) => rank.get(id)!))].sort((a, b) => a - b);
  let rows = ranks.map((r) => initial.filter((id) => rank.get(id) === r));
  const flat = (rs: string[][]) => rs.flat();
  // wires to the outside cross too: two row-mates standing the other way
  // round from where their wires leave is one crossing at the wall
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);
  const leaves = (id: string) => avg([...(outside.get(id)?.above ?? []), ...(outside.get(id)?.below ?? [])]);
  const cost = (rs: string[][]) => crossings(flat(rs), rank, edges) + rs.reduce((n, row) => {
    for (let i = 0; i < row.length; i++)
      for (let j = i + 1; j < row.length; j++) {
        const a = leaves(row[i]), b = leaves(row[j]);
        if (a !== undefined && b !== undefined && a > b) n++;
      }
    return n;
  }, 0);
  let best = flat(rows), bestCost = cost(rows);

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
        return avg([...others.map((o) => where.get(o)!), ...((down ? outside.get(id)?.above : outside.get(id)?.below) ?? [])]);
      };
      const row = next[ri];
      const keyed = row.map((id, i) => ({ id, i, key: held.has(id) ? undefined : mean(id) }));
      const movable = keyed.filter((k) => k.key !== undefined).sort((p, q) => p.key! - q.key! || p.i - q.i);
      next[ri] = keyed.map((k) => (k.key === undefined ? k.id : movable.shift()!.id));
    }
    rows = next;
    if (cost(rows) < bestCost) { best = flat(rows); bestCost = cost(rows); }
  }
  return best;
}
