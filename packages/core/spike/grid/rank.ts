// Ranks: which band each member of one container sits in.
//
// The author's `rows`/`place` arrive as `pins` and are *hard* — a pinned
// member is on its row, full stop. Everything else follows the edges: a
// target sits below its source. Nothing here predicts what a later stage will
// do, because no later stage may move a rank.
//
// Three consequences the ELK engine could not offer, each of which is a
// diagnostic or a workaround there:
//   · two members joined by an edge may share a rank (the router draws it);
//   · an unlisted member on a path between two band-mates sits below both and
//     its second edge simply runs upward — the band stays whole;
//   · a cycle is broken once, here, in declaration order.

export type Edge = readonly [from: string, to: string];

/** `edges` minus each one that would close a cycle with those before it. */
export function acyclic(edges: readonly Edge[]): Edge[] {
  const next = new Map<string, Set<string>>();
  const reaches = (from: string, to: string): boolean => {
    const seen = new Set([from]);
    const stack = [from];
    for (let cur = stack.pop(); cur !== undefined; cur = stack.pop()) {
      if (cur === to) return true;
      for (const n of next.get(cur) ?? []) if (!seen.has(n)) { seen.add(n); stack.push(n); }
    }
    return false;
  };
  const kept: Edge[] = [];
  for (const e of edges) {
    const [a, b] = e;
    if (a === b || reaches(b, a)) continue;
    kept.push(e);
    (next.get(a) ?? next.set(a, new Set()).get(a)!).add(b);
  }
  return kept;
}

/**
 * A rank for every id. Pinned ids keep their pin exactly; the numbers are
 * otherwise only ordered, not dense (see `dense`).
 */
export function assignRanks(
  ids: readonly string[],
  edges: readonly Edge[],
  pins: ReadonlyMap<string, number> = new Map(),
): Map<string, number> {
  // an edge between two pinned members constrains nothing: the pins decide
  const dag = acyclic(edges.filter(([a, b]) => !(pins.has(a) && pins.has(b))));
  const preds = new Map<string, string[]>(ids.map((id) => [id, []]));
  const succs = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const [a, b] of dag) { succs.get(a)!.push(b); preds.get(b)!.push(a); }
  const order = topological(ids, succs);

  // 1. below every source: longest path, pins fixed
  const rank = new Map<string, number>(ids.map((id) => [id, pins.get(id) ?? 0]));
  for (const id of order)
    for (const s of succs.get(id)!)
      if (!pins.has(s)) rank.set(s, Math.max(rank.get(s)!, rank.get(id)! + 1));

  // 2. above a pinned target: an unpinned feeder floats up to sit over it,
  //    unless something pinned above already holds it down — then it stays
  //    below and that one edge runs upward
  const ceiling = new Map<string, number>();
  const floor = new Map<string, number>();
  for (const id of order) {
    const held = preds.get(id)!.map((p) => (pins.has(p) ? pins.get(p)! : floor.get(p)!) + 1);
    floor.set(id, Math.max(-Infinity, ...held));
  }
  for (const id of [...order].reverse()) {
    const caps = succs.get(id)!.map((s) => (pins.has(s) ? pins.get(s)! : ceiling.get(s)!) - 1);
    ceiling.set(id, Math.min(Infinity, ...caps));
    if (!pins.has(id) && rank.get(id)! > ceiling.get(id)! && floor.get(id)! <= ceiling.get(id)!)
      rank.set(id, ceiling.get(id)!);
  }

  // 3. shorten: a member with more edges on one side moves toward that side,
  //    as far as its other neighbours allow. Each member only ever moves one
  //    way, so this terminates.
  for (let pass = 0; pass < ids.length; pass++) {
    let moved = false;
    for (const id of ids) {
      if (pins.has(id)) continue;
      const r = rank.get(id)!;
      const above = preds.get(id)!.map((p) => rank.get(p)!).filter((x) => x < r);
      const below = succs.get(id)!.map((s) => rank.get(s)!).filter((x) => x > r);
      const lo = Math.max(-Infinity, ...above) + 1, hi = Math.min(Infinity, ...below) - 1;
      const to = below.length > above.length && hi !== Infinity ? hi
        : above.length > below.length && lo !== -Infinity ? lo : r;
      if (to !== r) { rank.set(id, to); moved = true; }
    }
    if (!moved) break;
  }
  return rank;
}

/** Ranks renumbered 0,1,2… with no gaps, order kept. */
export function dense(rank: ReadonlyMap<string, number>): Map<string, number> {
  const values = [...new Set(rank.values())].sort((a, b) => a - b);
  return new Map([...rank].map(([id, r]) => [id, values.indexOf(r)]));
}

function topological(ids: readonly string[], succs: ReadonlyMap<string, string[]>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const s of succs.get(id)!) visit(s);
    out.push(id);
  };
  for (const id of ids) visit(id);
  return out.reverse();
}
