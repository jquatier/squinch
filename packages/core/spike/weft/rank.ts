// Ranks for one container (REQUIREMENTS §5.1).
//
// The author's pins are exact. Everything else goes where the wires are
// shortest in sum — not merely as high as it can — so a lone source drops to
// just above what it feeds, and a feeder floats above a pinned target.
//
// Three steps, each a function:
//   constraints  which wires point down the page. Taken in declaration
//                order; a wire that cannot (it closes a cycle, or the pins
//                say otherwise) runs upward instead — the first-declared
//                wire of a mutual pair keeps its direction.
//   simplex      the least total length under those constraints.
//   dense        ranks renumbered 0, 1, 2… with nothing skipped.

export type Edge = readonly [from: string, to: string];
interface Arc { u: number; v: number; min: number; weight: number }

/** Rank of every id, dense from 0. Pinned ids keep their stated order and spacing. */
export function rankGroup(ids: readonly string[], edges: readonly Edge[], pins: ReadonlyMap<string, number> = new Map()): Map<string, number> {
  // every pinned box is one node, `PIN`, at a fixed offset from it
  const PIN = 0;
  const node = new Map<string, number>();
  let n = 1;
  for (const id of ids) node.set(id, pins.has(id) ? PIN : n++);
  const off = (id: string) => pins.get(id) ?? 0;

  const arcs = constraints(n, edges.flatMap(([a, b]) => {
    const u = node.get(a), v = node.get(b);
    // rank(b) - rank(a) >= 1, written between the nodes that stand for them
    return u === undefined || v === undefined || u === v ? [] : [{ u, v, min: 1 + off(a) - off(b), back: 1 - off(a) + off(b) }];
  }));
  const { r, piece } = simplex(n, arcs);

  // each connected piece starts at the top
  const low = new Map<number, number>();
  const at = (id: string) => r[node.get(id)!] + off(id);
  for (const id of ids) low.set(piece[node.get(id)!], Math.min(low.get(piece[node.get(id)!]) ?? Infinity, at(id)));
  return dense(new Map(ids.map((id) => [id, at(id) - low.get(piece[node.get(id)!])!])));
}

/** Wires as lower bounds on a rank difference, each kept the way it was
 *  declared if that is still possible, turned round if not. */
function constraints(n: number, wanted: { u: number; v: number; min: number; back: number }[]): Arc[] {
  const arcs: Arc[] = [];
  /** The longest chain of kept constraints from `s` to `t`, or -Infinity. */
  const reach = (s: number, t: number): number => {
    const d = new Array<number>(n).fill(-Infinity);
    d[s] = 0;
    for (let pass = 0; pass < n; pass++) {
      let moved = false;
      for (const a of arcs) if (d[a.u] + a.min > d[a.v]) { d[a.v] = d[a.u] + a.min; moved = true; }
      if (!moved) break;
    }
    return d[t];
  };
  const add = (u: number, v: number, min: number): boolean => {
    if (reach(v, u) + min > 0) return false; // it would close a cycle that cannot be satisfied
    const same = arcs.find((a) => a.u === u && a.v === v);
    if (same) { same.min = Math.max(same.min, min); same.weight++; } else arcs.push({ u, v, min, weight: 1 });
    return true;
  };
  for (const w of wanted) if (!add(w.u, w.v, w.min)) add(w.v, w.u, w.back);
  return arcs;
}

/** Network simplex: ranks minimising Σ weight·(rank(v) − rank(u)) with every
 *  arc at least its `min` long, and which connected piece each node is in. */
function simplex(n: number, arcs: Arc[]): { r: number[]; piece: number[] } {
  const r = new Array<number>(n).fill(0);
  for (let pass = 0; pass <= n; pass++) {
    let moved = false;
    for (const a of arcs) if (r[a.u] + a.min > r[a.v]) { r[a.v] = r[a.u] + a.min; moved = true; }
    if (!moved) break;
  }
  const slack = (a: Arc) => r[a.v] - r[a.u] - a.min;

  // one connected piece at a time
  const piece = new Array<number>(n).fill(-1);
  for (let s = 0, k = 0; s < n; s++) {
    if (piece[s] >= 0) continue;
    const stack = [s];
    piece[s] = k;
    while (stack.length) {
      const x = stack.pop()!;
      for (const a of arcs) for (const [p, q] of [[a.u, a.v], [a.v, a.u]]) if (p === x && piece[q] < 0) { piece[q] = k; stack.push(q); }
    }
    k++;
  }

  for (let k = 0; k <= Math.max(...piece); k++) {
    const mine = arcs.filter((a) => piece[a.u] === k);
    const nodes = piece.flatMap((p, i) => (p === k ? [i] : []));
    if (nodes.length < 2) continue;

    // a spanning tree of tight arcs
    const inTree = new Set<number>([nodes[0]]);
    const tree = new Set<Arc>();
    while (inTree.size < nodes.length) {
      let grew = false;
      for (const a of mine) if (slack(a) === 0 && inTree.has(a.u) !== inTree.has(a.v)) { inTree.add(a.u); inTree.add(a.v); tree.add(a); grew = true; }
      if (grew) continue;
      // nothing tight leaves the tree: slide the tree up to the nearest arc
      let best: Arc | undefined;
      for (const a of mine) if (inTree.has(a.u) !== inTree.has(a.v) && (!best || slack(a) < slack(best))) best = a;
      if (!best) break;
      const by = inTree.has(best.u) ? slack(best) : -slack(best);
      for (const x of inTree) r[x] += by;
    }

    /** The nodes on `a.v`'s side of the tree once `a` is taken out. */
    const headSide = (a: Arc): Set<number> => {
      const side = new Set<number>([a.v]);
      const stack = [a.v];
      while (stack.length) {
        const x = stack.pop()!;
        for (const t of tree) {
          if (t === a) continue;
          const y = t.u === x ? t.v : t.v === x ? t.u : -1;
          if (y >= 0 && !side.has(y)) { side.add(y); stack.push(y); }
        }
      }
      return side;
    };
    // exchange a tree arc the total would gain by stretching for the
    // slackest arc that crosses the same cut the other way
    for (let round = 0; round < 4 * mine.length + 16; round++) {
      let leave: Arc | undefined, head: Set<number> | undefined;
      for (const t of tree) {
        const side = headSide(t);
        let cutValue = 0;
        for (const a of mine) {
          if (!side.has(a.u) && side.has(a.v)) cutValue += a.weight;
          else if (side.has(a.u) && !side.has(a.v)) cutValue -= a.weight;
        }
        if (cutValue < 0) { leave = t; head = side; break; }
      }
      if (!leave || !head) break;
      let enter: Arc | undefined;
      for (const a of mine) if (head.has(a.u) && !head.has(a.v) && (!enter || slack(a) < slack(enter))) enter = a;
      if (!enter) break;
      const by = slack(enter);
      for (const x of head) r[x] += by;
      tree.delete(leave);
      tree.add(enter);
    }
  }
  return { r, piece };
}

/** Ranks renumbered 0, 1, 2… in the same order. */
export function dense(rank: Map<string, number>): Map<string, number> {
  const levels = [...new Set(rank.values())].sort((a, b) => a - b);
  const index = new Map(levels.map((l, i) => [l, i]));
  return new Map([...rank].map(([id, r]) => [id, index.get(r)!]));
}
