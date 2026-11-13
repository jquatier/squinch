// The loom: boxes in ranks, wires in channels.
//
// It knows nothing about Squinch. A `Problem` is boxes (some holding boxes),
// wires between them, and per container a direction, a spacing and the ranks
// the author pinned. A `Solution` is a rectangle per box and a polyline per
// wire.
//
// Three things happen, each once and each for the whole picture:
//
//   grow    index the problem; rank every container             (tree.ts)
//   order   draft every container's slots and order them all
//           together, from each starting order worth trying     (order.ts)
//   draw    lay every container out, innermost first; then again
//           now that each knows where its wires arrive from     (lay.ts)
//
// Ordering is finished before anything has a position — its count of
// crossings is the picture's, so nothing learned later would change it.
// Drawing is repeated only because a container is laid out before its
// surroundings and cannot know, the first time, which lane each wire through
// its wall will arrive on.

import { layOut, ordering } from "./lay.js";
import { orderAll } from "./order.js";
import { draft, type Sheet } from "./sheet.js";
import { sketchOrder } from "./sketch.js";
import { tally } from "./tally.js";
import { grow, ROOT, routesOf, type Tree } from "./tree.js";
import type { Box, Laid, Problem, Pt, Rect, Route, Solution } from "./types.js";

export type { Box, Dir, Group, Problem, Pt, Rect, Side, Solution, Wire } from "./types.js";
export { median } from "./place.js";

const ROUNDS = 3; // drawings: one blind, two knowing where the wires arrive

export function solve(problem: Problem): Solution {
  const tree = grow(problem);
  const first = draw(tree, problem, order(tree, problem));
  if (tree.groups.size < 2) return first.solution;
  // Once more, now that a drawing has shown where each wire through a wall
  // ends up: the order is the same search over the same count, but among
  // places that cross the same a wire now takes the one nearer where it is
  // going. Whichever picture crosses less is kept, then whichever turns less.
  const second = draw(tree, problem, order(tree, problem, headings(tree, first.solution)));
  return second.crossings < first.crossings || (second.crossings === first.crossings && second.bends < first.bends) ? second.solution : first.solution;
}

/** container → wire → where along that container's lane the wire's far end is, as a fraction of its size. */
function headings(tree: Tree, sol: Solution): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const { wire, fromChain, toChain } of tree.lifted) {
    const pts = sol.wires.get(wire.id)?.points;
    if (!pts?.length) continue;
    for (const [chain, far] of [[fromChain, pts[pts.length - 1]], [toChain, pts[0]]] as const)
      for (const c of chain) {
        const r = sol.boxes.get(c)!, down = tree.groups.get(c)!.dir === "down";
        (out.get(c) ?? out.set(c, new Map()).get(c)!).set(wire.id, down ? (far.x - r.x) / r.w : (far.y - r.y) / r.h);
      }
  }
  return out;
}

// ── order ────────────────────────────────────────────────────────────────────

interface Ordered {
  sheets: Map<string, Sheet>; routes: Map<string, Route>;
  /** Each container's finished layout, as the sheets will read it: filled in by `draw`. */
  laid: Map<string, Laid>;
}

/** The starting orders worth trying, most trusted first. */
function starts(tree: Tree, problem: Problem): Map<string, Box[]>[] {
  // as declared — but a box no wire touches stands after its row-mates that
  // have one, unless the author placed it: where it stands means nothing to
  // the wires, and containers then keep their wired boxes to the same side
  const declared = new Map([...tree.groups].map(([id, g]) => {
    const held = new Set(g.held), row = tree.declared.get(id)!;
    const last = (b: Box) => tree.idle.has(b.id) && !held.has(b.id);
    const byRank = new Map<number, Box[]>();
    for (const b of row) (byRank.get(tree.ranks.get(b.id)!) ?? byRank.set(tree.ranks.get(b.id)!, []).get(tree.ranks.get(b.id)!)!).push(b);
    for (const [r, bs] of byRank) if (!bs.some((b) => held.has(b.id))) byRank.set(r, [...bs.filter((b) => !last(b)), ...bs.filter(last)]);
    const next = new Map([...byRank].map(([r, bs]) => [r, [...bs]]));
    return [id, row.map((b) => next.get(tree.ranks.get(b.id)!)!.shift()!)] as const;
  }));
  // …and as a sketch of the whole picture would have it (sketch.ts)
  for (const [id, g] of tree.groups) g.boxes = declared.get(id)!;
  const sketched = sketchOrder(problem.root, tree.ranks, problem.wires);
  const second = new Map([...tree.groups].map(([id]) => [id, sketched.get(id)!.map((b) => tree.boxes.get(b)!)]));
  const same = [...declared].every(([id, bs]) => bs.every((b, i) => b === second.get(id)![i]));
  return same ? [declared] : [declared, second];
}

/** Draft and order the whole picture from each start; keep the one that crosses least. */
function order(tree: Tree, problem: Problem, headed: ReadonlyMap<string, ReadonlyMap<string, number>> = new Map()): Ordered {
  let best: (Ordered & { cost: number }) | undefined;
  for (const start of starts(tree, problem)) {
    for (const [id, g] of tree.groups) g.boxes = [...start.get(id)!];
    const routes = routesOf(tree), laid = new Map<string, Laid>();
    const sheets = new Map(tree.inner.map((id) => [id, draft(id, tree.groups.get(id)!, problem.wires, routes, tree.ranks, laid)]));
    const orders = new Map(tree.inner.map((id) => [id, ordering(sheets.get(id)!, tree.boxes.get(id), (c) => sheets.get(c), headed.get(id))]));
    const cost = orderAll(tree.inner.map((id) => sheets.get(id)!), tree.parent, (id) => orders.get(id)!);
    if (!best || cost < best.cost) best = { sheets, routes, laid, cost };
    if (cost < 1) break; // nothing crosses: no other start could do better
  }
  return best!;
}

// ── draw ─────────────────────────────────────────────────────────────────────

function draw(tree: Tree, problem: Problem, { sheets, routes, laid }: Ordered): { solution: Solution; crossings: number; bends: number } {
  let approach = new Map<string, Map<string, number>>();
  let best: Solution | undefined, score = [Infinity, Infinity];
  for (let round = 0; round < ROUNDS; round++) {
    for (const id of tree.inner) {
      const out = layOut(sheets.get(id)!, tree.boxes.get(id), approach.get(id));
      laid.set(id, out);
      const box = tree.boxes.get(id);
      if (box) { box.w = out.w; box.h = out.h; }
    }
    // a later drawing is usually but not always the better: fewest crossings, then fewest turns, then the later
    const sol = assemble(tree, problem, routes, laid), { crossings, bends } = tally(sol);
    if (crossings < score[0] || (crossings === score[0] && bends <= score[1])) { best = sol; score = [crossings, bends]; }
    if (tree.groups.size < 2) break; // nothing to learn: there is no wall
    approach = new Map([...laid.values()].flatMap((l) => [...l.approach]));
  }
  return { solution: best!, crossings: score[0], bends: score[1] };
}

/** Absolute positions, and each wire stitched from the pieces the containers on its way drew. */
function assemble(tree: Tree, problem: Problem, routes: ReadonlyMap<string, Route>, laid: ReadonlyMap<string, Laid>): Solution {
  const origin = new Map<string, Pt>([[ROOT, { x: 0, y: 0 }]]);
  const rects = new Map<string, Rect>();
  const settle = (id: string) => {
    const o = origin.get(id)!;
    for (const [child, r] of laid.get(id)!.rects) {
      rects.set(child, { x: o.x + r.x, y: o.y + r.y, w: r.w, h: r.h });
      if (tree.groups.has(child)) { origin.set(child, { x: o.x + r.x, y: o.y + r.y }); settle(child); }
    }
  };
  settle(ROOT);

  const wires = new Map<string, { points: Pt[]; label?: Rect }>();
  for (const wire of problem.wires) {
    const r = routes.get(wire.id);
    if (!r) continue;
    const pts: Pt[] = [];
    let label: Rect | undefined;
    // innermost container on the `from` side, out to home, in to the `to` side
    for (const gid of [...[...r.fromChain].reverse(), r.home, ...r.toChain]) {
      const o = origin.get(gid)!, part = laid.get(gid)!;
      for (const p of part.pieces.get(wire.id) ?? []) pts.push({ x: o.x + p.x, y: o.y + p.y });
      const lr = part.labels.get(wire.id);
      if (lr) label = { x: o.x + lr.x, y: o.y + lr.y, w: lr.w, h: lr.h };
    }
    wires.set(wire.id, { points: simplify(pts), label });
  }
  const top = laid.get(ROOT)!;
  return { width: top.w, height: top.h, boxes: rects, ranks: new Map(tree.ranks), wires, skipped: [...tree.skipped] };
}

/** Drop repeated points and the middle of any three in a line. */
export function simplify(pts: readonly Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1], prev = out[out.length - 2];
    if (last && last.x === p.x && last.y === p.y) continue;
    if (last && prev && ((prev.x === last.x && last.x === p.x) || (prev.y === last.y && last.y === p.y))) out.pop();
    out.push(p);
  }
  return out;
}
