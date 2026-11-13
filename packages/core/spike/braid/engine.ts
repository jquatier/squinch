// braid — a layout engine: boxes in ranks, wires in channels.
//
//   solve(problem)
//     plan    the tree, every container's ranks, and every wire as pieces   plan.ts
//     order   every row of every container, together                        order.ts
//     lay     each container drawn in its own frame, innermost first        lay.ts
//     emit    the frames set in the page and the wires stitched             emit.ts
//
// Each stage decides one thing, once, with what it needs in view, and none
// hands anything back to an earlier one. README.md has the design.

import type { Problem, Solution } from "../contract.js";
import { emit } from "./emit.js";
import { lay } from "./lay.js";
import { order } from "./order.js";
import { plan } from "./plan.js";

export type { Box, Dir, Group, Problem, Pt, Rect, Side, Solution, Wire } from "../contract.js";

export function solve(problem: Problem): Solution {
  const p = plan(problem);
  order(p);
  for (const cell of p.cells) lay(cell); // each before the cell that holds it
  return emit(p);
}
