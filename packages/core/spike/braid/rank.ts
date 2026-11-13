// Ranks for one container: which row each of its boxes stands in.
//
// §5.1. The boxes are ranked for the least total wire length across ranks —
// a lone source drops to just above what it feeds, a feeder floats above a
// pinned target — by handing the simplex one arc per wire, one rank long.
//
// What the author pinned is not negotiable, so the pinned boxes are one
// node of the problem (each at its stated offset from it) and a wire only
// becomes an arc if the picture can still be drawn with it pointing down:
// wires are taken in declaration order, and one that would contradict the
// pins or close a cycle is turned round; if it cannot point up either (its
// ends share a pinned rank) it constrains nothing. That is the whole of
// cycle-breaking: the first-declared wire of a mutual pair keeps its
// direction, and a pinned band stays whole when an unpinned box sits on a
// path between two of its members.

import { feasible, solve, type Arc } from "./simplex.js";

export type Edge = readonly [from: string, to: string];

/** Each box's rank, as whole numbers from 0 with none left empty. */
export function rankBoxes(ids: readonly string[], edges: readonly Edge[], pins: ReadonlyMap<string, number> = new Map()): Map<string, number> {
  const index = new Map(ids.map((id, i) => [id, i]));
  const P = ids.length; // the node all pinned boxes hang off
  const node = (id: string) => (pins.has(id) ? P : index.get(id)!);
  const offset = (id: string) => pins.get(id) ?? 0;

  const arcs: Arc[] = [];
  const add = (tail: number, head: number, min: number): boolean => {
    const same = arcs.find((a) => a.tail === tail && a.head === head && a.min === min);
    if (same) { same.weight++; return true; }
    arcs.push({ tail, head, min, weight: 1 });
    if (feasible(P + 1, arcs)) return true;
    arcs.pop();
    return false;
  };
  for (const [from, to] of edges) {
    if (!index.has(from) || !index.has(to) || from === to) continue;
    const a = node(from), b = node(to);
    if (a === b) continue; // two pinned boxes: the author has spoken
    // rank(to) − rank(from) ≥ 1, in terms of the nodes that stand for them
    if (!add(a, b, 1 + offset(from) - offset(to))) add(b, a, 1 + offset(to) - offset(from));
  }

  const y = solve(P + 1, arcs);
  // A box with as much wire above as below costs the same anywhere between
  // its neighbours: it stands as near its sources as it may.
  for (let round = 0; round < 2; round++)
    for (let v = 0; v < P; v++) {
      let up = 0, down = 0, lo = -Infinity;
      for (const a of arcs) {
        if (a.head === v) { up += a.weight; lo = Math.max(lo, y[a.tail] + a.min); }
        if (a.tail === v) down += a.weight;
      }
      if (up && up === down && lo < y[v]) y[v] = lo;
    }

  // pinned boxes sit where they were pinned; whatever is tied to them is
  // measured from there, and anything tied to nothing starts at the top
  const comp = components(P + 1, arcs);
  const least = new Map<number, number>();
  for (let v = 0; v <= P; v++) least.set(comp[v], Math.min(least.get(comp[v]) ?? Infinity, y[v]));
  const top = pins.size ? Math.min(...pins.values()) : 0;
  const rank = new Map<string, number>();
  for (const id of ids) {
    const v = node(id);
    rank.set(id, pins.has(id) ? pins.get(id)! : comp[v] === comp[P] ? y[v] - y[P] : y[v] - least.get(comp[v])! + top);
  }
  const used = [...new Set(rank.values())].sort((a, b) => a - b);
  const dense = new Map(used.map((r, i) => [r, i]));
  for (const [id, r] of rank) rank.set(id, dense.get(r)!);
  return rank;
}

function components(n: number, arcs: readonly Arc[]): number[] {
  const of = Array.from({ length: n }, (_, i) => i);
  const find = (v: number): number => (of[v] === v ? v : (of[v] = find(of[v])));
  for (const a of arcs) of[find(a.tail)] = find(a.head);
  return of.map((_, v) => find(v));
}
