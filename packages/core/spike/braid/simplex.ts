// One solver, used twice: ranks down the page and places along a rank are
// the same question.
//
//   minimise   Σ weight · (y[head] − y[tail])
//   subject to y[head] − y[tail] ≥ min          for every arc
//
// With unit lengths and the wires as arcs that is "rank the boxes for the
// least total wire" (§5.1). With one arc per pair of neighbours in a row
// (`min` = how far apart they must stand) and, for every wire, a helper node
// tied to both its ends, it is "place the boxes for the least total sideways
// run" — an L1 objective, which is what makes a wire that *can* be straight
// exactly straight rather than nearly so.
//
// The method is network simplex (Gansner et al., "A technique for drawing
// directed graphs"): keep a spanning tree of tight arcs; an arc of the tree
// whose removal splits the nodes into two halves that would rather be
// further apart leaves, and the tightest arc that stops them enters. Answers
// are sums of the `min`s given, so integer input gives integer output, and
// input on a grid gives output on that grid.
//
// Everything is a loop over arrays in index order: the same input walks the
// same pivots on every machine.

export interface Arc { tail: number; head: number; min: number; weight: number }

/** A longest-path start: every arc satisfied, or `undefined` if no assignment can. */
export function feasible(n: number, arcs: readonly Arc[]): number[] | undefined {
  const y = new Array<number>(n).fill(0);
  for (let round = 0; round <= n; round++) {
    let moved = false;
    for (const a of arcs) if (y[a.head] < y[a.tail] + a.min) { y[a.head] = y[a.tail] + a.min; moved = true; }
    if (!moved) return y;
  }
  return undefined;
}

export function solve(n: number, arcs: readonly Arc[]): number[] {
  const y = feasible(n, arcs);
  if (!y) throw new Error("simplex: the constraints contradict each other");
  const m = arcs.length;
  if (!m) return y;
  const slack = (i: number) => y[arcs[i].head] - y[arcs[i].tail] - arcs[i].min;

  // ── a tight spanning tree for every connected piece ────────────────────────
  const inTree = new Uint8Array(m);
  const reached = new Uint8Array(n);
  const at: number[][] = Array.from({ length: n }, () => []);
  arcs.forEach((a, i) => { at[a.tail].push(i); at[a.head].push(i); });
  const roots: number[] = [];
  for (let s = 0; s < n; s++) {
    if (reached[s]) continue;
    roots.push(s);
    const mine = [s];
    reached[s] = 1;
    for (;;) {
      // take in everything a tight arc reaches
      for (let k = 0; k < mine.length; k++)
        for (const i of at[mine[k]]) {
          const a = arcs[i], other = a.tail === mine[k] ? a.head : a.tail;
          if (!reached[other] && slack(i) === 0) { reached[other] = 1; inTree[i] = 1; mine.push(other); }
        }
      // then close the smallest gap to something outside, and go round again
      let best = -1, least = Infinity;
      for (const v of mine)
        for (const i of at[v]) {
          const a = arcs[i];
          if (reached[a.tail] && reached[a.head]) continue;
          const sl = slack(i);
          if (sl < least || (sl === least && i < best)) { least = sl; best = i; }
        }
      if (best < 0) break;
      const shift = reached[arcs[best].tail] ? least : -least;
      for (const v of mine) y[v] += shift;
    }
  }

  // ── the tree, rooted, with each subtree as an interval of visit times ──────
  const parent = new Int32Array(n), via = new Int32Array(n), tin = new Int32Array(n), tout = new Int32Array(n);
  const order: number[] = [];
  const cursor = new Int32Array(n);
  const root = () => {
    let clock = 0;
    order.length = 0;
    parent.fill(-1); via.fill(-1); cursor.fill(0);
    const seen = new Uint8Array(n);
    for (const r of roots) {
      const stack = [r];
      seen[r] = 1;
      tin[r] = clock++;
      order.push(r);
      while (stack.length) {
        const v = stack[stack.length - 1];
        let pushed = false;
        while (cursor[v] < at[v].length) {
          const i = at[v][cursor[v]++];
          if (!inTree[i]) continue;
          const a = arcs[i], other = a.tail === v ? a.head : a.tail;
          if (seen[other]) continue;
          seen[other] = 1; parent[other] = v; via[other] = i; tin[other] = clock++;
          order.push(other);
          stack.push(other);
          pushed = true;
          break;
        }
        if (!pushed) { tout[v] = clock; stack.pop(); }
      }
    }
  };
  const under = (c: number, v: number) => tin[v] >= tin[c] && tin[v] < tout[c];

  // The cut value of a tree arc: split the tree there, and add the weights of
  // the arcs that cross the split its way, less those that cross it against.
  // Negative means the two halves would cost less further apart.
  //
  // Computed for every tree arc at once, in one pass up the tree: `sum[v]` is
  // the signed weight of every arc with exactly one end under v, which is the
  // sum over v's subtree of each node's own (out − in) weight — an arc with
  // both ends inside cancels itself.
  const cut = new Float64Array(n); // by child node
  const cuts = () => {
    const net = new Float64Array(n);
    for (const a of arcs) { net[a.tail] += a.weight; net[a.head] -= a.weight; }
    for (let k = order.length - 1; k >= 0; k--) {
      const v = order[k];
      if (parent[v] >= 0) net[parent[v]] += net[v];
      // net[v]: weight leaving v's subtree minus weight entering it
      cut[v] = parent[v] < 0 ? 0 : arcs[via[v]].tail === v ? net[v] : -net[v];
    }
  };

  root();
  cuts();
  let from = 0;
  for (let pivots = 0; pivots < 40 * n + 200; pivots++) {
    // the next tree arc that wants to be longer, taken round-robin so no arc is starved
    let c = -1;
    for (let k = 0; k < n; k++) {
      const v = (from + k) % n;
      if (parent[v] >= 0 && cut[v] < 0) { c = v; from = (v + 1) % n; break; }
    }
    if (c < 0) break;
    if (pivots === 40 * n + 199 && typeof process !== "undefined" && process.env.SIMPLEX_DEBUG) console.log("simplex: gave up", n, m);
    const leaving = via[c], tailUnder = arcs[leaving].tail === c;
    // the arc that enters runs from the head's half back to the tail's half
    let entering = -1, least = Infinity;
    for (let i = 0; i < m; i++) {
      if (inTree[i]) continue;
      const a = arcs[i], tu = under(c, a.tail), hu = under(c, a.head);
      if (tu === hu || hu !== tailUnder) continue;
      const sl = slack(i);
      if (sl < least) { least = sl; entering = i; }
    }
    if (entering < 0) break; // nothing holds the halves together: leave them be
    // move the head's half away by the slack, so the entering arc is tight
    if (least) {
      const d = tailUnder ? -least : least; // applied to the subtree under c
      for (let v = 0; v < n; v++) if (under(c, v)) y[v] += d;
    }
    inTree[leaving] = 0; inTree[entering] = 1;
    root();
    cuts();
  }
  return y;
}
