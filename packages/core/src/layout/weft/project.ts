// Positions along one axis: every variable as near to where it wants to be
// as the gaps between them allow.
//
// Each variable has a `want` and a `weight`; each constraint says one
// variable stands at least `gap` after another. The answer minimises
// Σ weight·(position − want)² the way stacked blocks settle: variables are
// taken left to right, and one that would overlap what stands before it is
// joined to it, the two moving as a block to their common weighted mean
// (and so on, block joining block). For one row — a chain of constraints —
// that is exact; for constraints across rows (`aligned`, `columns`) it is
// the standard approximation, always feasible.
//
// There is no iteration and no tolerance: one pass, each merge final.

export interface Gap { left: number; right: number; gap: number }

interface Block { at: number; weight: number; pull: number; vars: number[] }

export function project(want: readonly number[], weight: readonly number[], gaps: readonly Gap[]): number[] {
  const n = want.length;
  const off = new Array<number>(n).fill(0); // a variable's place within its block
  const block: Block[] = want.map((w, i) => ({ at: w, weight: weight[i], pull: weight[i] * w, vars: [i] }));
  const into: Gap[][] = Array.from({ length: n }, () => []);
  for (const g of gaps) into[g.right].push(g);
  const pos = (i: number) => block[i].at + off[i];

  for (const v of leftToRight(n, gaps)) {
    for (;;) {
      // the constraint into this block, from outside it, that is broken worst
      const b = block[v];
      let worst: Gap | undefined, by = 1e-9;
      for (const i of b.vars)
        for (const g of into[i]) {
          const miss = pos(g.left) + g.gap - pos(g.right);
          if (block[g.left] !== b && miss > by) { worst = g; by = miss; }
        }
      if (!worst) break;
      // join this block onto the one before it, with that constraint exactly met
      const a = block[worst.left], shift = off[worst.left] + worst.gap - off[worst.right];
      for (const i of b.vars) { off[i] += shift; block[i] = a; a.vars.push(i); }
      a.pull += b.pull - shift * b.weight;
      a.weight += b.weight;
      a.at = a.pull / a.weight;
    }
  }
  return want.map((_, i) => pos(i));
}

/** The variables in an order in which every constraint points forward. */
function leftToRight(n: number, gaps: readonly Gap[]): number[] {
  const waiting = new Array<number>(n).fill(0);
  const out: number[][] = Array.from({ length: n }, () => []);
  for (const g of gaps) { waiting[g.right]++; out[g.left].push(g.right); }
  const order: number[] = [];
  const ready = waiting.flatMap((w, i) => (w ? [] : [i]));
  while (ready.length) {
    const v = ready.shift()!;
    order.push(v);
    for (const r of out[v]) if (--waiting[r] === 0) ready.push(r);
  }
  // constraints that contradict each other (a cycle) leave variables out:
  // they are placed last, and such constraints hold as far as they can
  for (let i = 0; i < n; i++) if (waiting[i] > 0) order.push(i);
  return order;
}
