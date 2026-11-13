// Ranks: which band each member of one container sits in.
//
// The author's `rows`/`place` arrive as `pins` and are *hard* — a pinned
// member is on its row, full stop. Everything else follows the edges: a
// target sits below its source, and among all the ways to do that the one
// with the least total wire is chosen (network simplex — Gansner et al.,
// the same objective ELK's layering has). Nothing here predicts what a later
// stage will do, because no later stage may move a rank.
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
  return feasible(edges.map(([a, b]) => ({ tail: a, head: b, min: 1 }))).map((c) => [c.tail, c.head] as const);
}

/** head ≥ tail + min. Pins make `min` anything; a plain edge is 1. */
interface Constraint { tail: string; head: string; min: number }

/** The constraints that can all hold at once, taken in order: one that
 *  contradicts those before it is left out. (A cycle is the simplest case; a
 *  feeder held both above and below a pinned row is the other.) */
function feasible(all: readonly Constraint[]): Constraint[] {
  const kept: Constraint[] = [];
  // longest path from `from` to `to` over what is kept so far
  const longest = (from: string, to: string): number => {
    const dist = new Map([[from, 0]]);
    for (let pass = 0; pass <= kept.length; pass++) {
      let moved = false;
      for (const c of kept) {
        const d = dist.get(c.tail);
        if (d !== undefined && d + c.min > (dist.get(c.head) ?? -Infinity)) { dist.set(c.head, d + c.min); moved = true; }
      }
      if (!moved) break;
    }
    return dist.get(to) ?? -Infinity;
  };
  for (const c of all) {
    if (c.tail === c.head ? c.min > 0 : longest(c.head, c.tail) + c.min > 0) continue;
    if (c.tail !== c.head) kept.push(c);
  }
  return kept;
}

const PINNED = "\u0000pinned"; // every pinned member, as one node at rank 0

/**
 * A rank for every id. Pinned ids keep their pin exactly; the numbers are
 * otherwise only ordered, not dense (see `dense`).
 */
export function assignRanks(
  ids: readonly string[],
  edges: readonly Edge[],
  pins: ReadonlyMap<string, number> = new Map(),
): Map<string, number> {
  // Pinned members move together or not at all, so they are one node: an
  // edge into a member pinned at row 3 says "at least 1 above row 3".
  const node = (id: string) => (pins.has(id) ? PINNED : id);
  const constraints = feasible(edges
    .filter(([a, b]) => a !== b && !(pins.has(a) && pins.has(b)))
    .map(([a, b]) => ({ tail: node(a), head: node(b), min: 1 + (pins.get(a) ?? 0) - (pins.get(b) ?? 0) })));
  const nodes = [...new Set([...(pins.size ? [PINNED] : []), ...ids.filter((id) => !pins.has(id))])];

  const rank = new Map<string, number>();
  for (const part of components(nodes, constraints)) {
    const own = constraints.filter((c) => part.has(c.tail));
    const solved = shortest([...part], own);
    // a part holding the pinned rows is measured from them; any other starts at row 0
    const shift = part.has(PINNED) ? -solved.get(PINNED)! : -Math.min(...solved.values());
    for (const [id, r] of solved) rank.set(id, r + shift);
  }
  return new Map(ids.map((id) => [id, pins.get(id) ?? rank.get(id)!]));
}

/** Ranks renumbered 0,1,2… with no gaps, order kept. */
export function dense(rank: ReadonlyMap<string, number>): Map<string, number> {
  const values = [...new Set(rank.values())].sort((a, b) => a - b);
  return new Map([...rank].map(([id, r]) => [id, values.indexOf(r)]));
}

function components(nodes: readonly string[], cs: readonly Constraint[]): Set<string>[] {
  const next = new Map<string, string[]>(nodes.map((n) => [n, []]));
  for (const c of cs) { next.get(c.tail)!.push(c.head); next.get(c.head)!.push(c.tail); }
  const seen = new Set<string>(), out: Set<string>[] = [];
  for (const n of nodes) {
    if (seen.has(n)) continue;
    const part = new Set<string>(), stack = [n];
    for (let cur = stack.pop(); cur !== undefined; cur = stack.pop()) {
      if (seen.has(cur)) continue;
      seen.add(cur); part.add(cur);
      stack.push(...next.get(cur)!);
    }
    out.push(part);
  }
  return out;
}

/**
 * Network simplex on one connected part: ranks that satisfy every constraint
 * with the least Σ (head − tail). Graphs here are a few dozen nodes, so cut
 * values are recomputed from scratch each pivot — clarity over speed.
 */
function shortest(nodes: readonly string[], cs: readonly Constraint[]): Map<string, number> {
  const rank = new Map<string, number>(nodes.map((n) => [n, 0]));
  // any feasible start: longest path
  for (let pass = 0; pass <= nodes.length; pass++)
    for (const c of cs) rank.set(c.head, Math.max(rank.get(c.head)!, rank.get(c.tail)! + c.min));
  if (nodes.length < 2) return rank;
  const slack = (c: Constraint) => rank.get(c.head)! - rank.get(c.tail)! - c.min;

  // a spanning tree of tight constraints, pulling the rest of the graph in
  const inTree = new Set<string>([nodes[0]]);
  const tree = new Set<Constraint>();
  while (inTree.size < nodes.length) {
    const grow = cs.find((c) => !tree.has(c) && slack(c) === 0 && inTree.has(c.tail) !== inTree.has(c.head));
    if (grow) { tree.add(grow); inTree.add(grow.tail); inTree.add(grow.head); continue; }
    // nothing tight reaches out: slide the tree up to the nearest outsider
    const reach = cs.filter((c) => inTree.has(c.tail) !== inTree.has(c.head)).sort((a, b) => slack(a) - slack(b))[0];
    const delta = inTree.has(reach.head) ? -slack(reach) : slack(reach);
    for (const n of inTree) rank.set(n, rank.get(n)! + delta);
  }

  /** The nodes on `c`'s tail side once `c` is cut out of the tree. */
  const tailSide = (c: Constraint): Set<string> => {
    const side = new Set([c.tail]), stack = [c.tail];
    for (let cur = stack.pop(); cur !== undefined; cur = stack.pop())
      for (const t of tree) {
        if (t === c) continue;
        const other = t.tail === cur ? t.head : t.head === cur ? t.tail : undefined;
        if (other !== undefined && !side.has(other)) { side.add(other); stack.push(other); }
      }
    return side;
  };
  for (let pivot = 0; pivot < cs.length * nodes.length; pivot++) {
    // a tree edge with more wire crossing it backwards than forwards is wrong
    let leave: Constraint | undefined, tails: Set<string> | undefined;
    for (const t of tree) {
      const side = tailSide(t);
      let cut = 0;
      for (const c of cs) {
        if (side.has(c.tail) && !side.has(c.head)) cut++;
        else if (!side.has(c.tail) && side.has(c.head)) cut--;
      }
      if (cut < 0) { leave = t; tails = side; break; }
    }
    if (!leave || !tails) break;
    // replace it with the least-slack constraint running the other way
    const enter = cs.filter((c) => !tails!.has(c.tail) && tails!.has(c.head)).sort((a, b) => slack(a) - slack(b))[0];
    if (!enter) break;
    const delta = slack(enter);
    for (const n of tails) rank.set(n, rank.get(n)! - delta);
    tree.delete(leave); tree.add(enter);
  }
  return rank;
}
