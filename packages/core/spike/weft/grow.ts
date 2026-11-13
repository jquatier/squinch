// An experiment: leaves may grow wider than their text needs, where a wider
// box makes a tidier picture. Two ways, each on its own switch:
//
//   even   the plain leaves of one container all take the widest one's width,
//          so a column of boxes has one left edge and one right edge
//   span   a leaf whose wires fan out to several boxes grows until it covers
//          them, so every wire of the fan runs straight down from it
//
// Neither touches the engine: `grown(solve)` is a solver that resizes the
// Problem's leaves and hands it on. `span` needs to know where the fan's ends
// stand, so it solves once, widens, and solves again.

import type { Box, Group, Problem, Solution } from "../contract.js";

export interface Grow { even?: boolean; span?: boolean; /** a leaf grows to at most this many times its own width */ most?: number }

const STEP = 16; // widths change by whole steps, so centres stay on the 8-px grid

/** The Problem again, each leaf as wide as `width` says. */
function resized(p: Problem, width: (b: Box) => number): Problem {
  const box = (b: Box): Box => (b.group ? { ...b, group: group(b.group) } : { ...b, w: width(b) });
  const group = (g: Group): Group => ({ ...g, boxes: g.boxes.map(box) });
  return { root: group(p.root), wires: p.wires };
}

function eachGroup(g: Group, visit: (g: Group) => void): void {
  visit(g);
  for (const b of g.boxes) if (b.group) eachGroup(b.group, visit);
}

/** Plain leaves of one container, all as wide as the widest (within `most`). */
function even(p: Problem, most: number): Problem {
  const to = new Map<string, number>();
  eachGroup(p.root, (g) => {
    const leaves = g.boxes.filter((b) => !b.group && b.face === undefined);
    const widest = Math.max(0, ...leaves.map((b) => b.w));
    for (const b of leaves) to.set(b.id, Math.min(widest, Math.floor((b.w * most) / STEP) * STEP));
  });
  return resized(p, (b) => Math.max(b.w, to.get(b.id) ?? 0));
}

/** Each fanning leaf, wide enough to stand over every end of its fan. */
function span(p: Problem, s: Solution, most: number): Problem {
  const leaves = new Map<string, { box: Box; dir: Group["dir"] }>();
  eachGroup(p.root, (g) => { for (const b of g.boxes) if (!b.group) leaves.set(b.id, { box: b, dir: g.dir }); });
  // where each leaf's wires end, along its own rank: the far point of each
  const ends = new Map<string, number[]>();
  for (const w of p.wires) {
    const drawn = s.wires.get(w.id)?.points;
    if (!drawn) continue;
    for (const [id, far] of [[w.from, drawn[drawn.length - 1]], [w.to, drawn[0]]] as const) {
      const leaf = leaves.get(id);
      if (leaf) (ends.get(id) ?? ends.set(id, []).get(id)!).push(leaf.dir === "down" ? far.x : far.y);
    }
  }
  const to = new Map<string, number>();
  for (const [id, at] of ends) {
    const { box, dir } = leaves.get(id)!;
    if (at.length < 2 || dir !== "down" || box.face !== undefined) continue; // a box grows wider, not taller
    const reach = Math.max(...at) - Math.min(...at) + 2 * STEP;
    to.set(id, Math.min(Math.ceil(reach / STEP) * STEP, Math.floor((box.w * most) / STEP) * STEP));
  }
  return resized(p, (b) => Math.max(b.w, to.get(b.id) ?? 0));
}

/** `solve`, with leaves allowed to grow. */
export function grown(solve: (p: Problem) => Solution, opts: Grow): (p: Problem) => Solution {
  const most = opts.most ?? 2.5;
  return (p) => {
    const start = opts.even ? even(p, most) : p;
    const first = solve(start);
    return opts.span ? solve(span(start, first, most)) : first;
  };
}
