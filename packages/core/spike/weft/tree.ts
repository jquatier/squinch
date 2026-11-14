// The tree of containers, and each wire cut where its two ends part company.
//
// A wire between boxes anywhere in the tree is drawn in pieces: one in the
// container that holds both ends (between the two children that hold them),
// and one in every container it has to leave or enter on the way. This file
// finds those containers; it decides nothing about geometry.
import type { Box, Problem, Wire } from "./contract.js";
import type { Cell, Path, Step } from "./types.js";

export interface Tree {
  root: Cell;
  /** container id → its inside; the root is `""` */
  cells: Map<string, Cell>;
  /** box id → the container it stands in */
  home: Map<string, Cell>;
  /** every wire that can be drawn, cut at its meeting container */
  paths: Path[];
  /** wires that cannot: an end missing, or one end holding the other */
  skipped: string[];
  /** boxes a wire touches, themselves or anything inside them */
  wired: Set<string>;
}

export function grow(problem: Problem): Tree {
  const root: Cell = { id: "", group: problem.root, depth: 0 };
  const cells = new Map<string, Cell>([["", root]]);
  const home = new Map<string, Cell>();
  const walk = (cell: Cell) => {
    for (const box of cell.group.boxes) {
      home.set(box.id, cell);
      if (box.group) {
        const inner: Cell = { id: box.id, box, group: box.group, parent: cell, depth: cell.depth + 1 };
        cells.set(box.id, inner);
        walk(inner);
      }
    }
  };
  walk(root);

  /** The containers holding `id`, innermost first, each with its child on the way down to `id`. */
  const chain = (id: string): Step[] => {
    const steps: Step[] = [];
    if (cells.has(id)) steps.push({ cell: cells.get(id)!, kid: null });
    for (let kid = id, cell = home.get(id); cell; kid = cell.id, cell = home.get(cell.id)) steps.push({ cell, kid });
    return steps;
  };

  const paths: Path[] = [], skipped: string[] = [], wired = new Set<string>();
  for (const wire of problem.wires) {
    const path = home.has(wire.from) && home.has(wire.to) && wire.from !== wire.to ? cut(wire, chain(wire.from), chain(wire.to)) : undefined;
    if (!path) { skipped.push(wire.id); continue; }
    paths.push(path);
    for (const end of [wire.from, wire.to])
      for (let id: string | undefined = end; id; id = home.get(id)?.id || undefined) wired.add(id);
  }
  return { root, cells, home, paths, skipped, wired };
}

/** The deepest container on both chains is where the ends part; a wire one
 *  of whose ends holds the other has no such place and is not drawn. */
function cut(wire: Wire, from: Step[], to: Step[]): Path | undefined {
  const i = from.findIndex((s) => s.kid !== null && to.some((t) => t.cell === s.cell && t.kid !== null));
  if (i < 0) return undefined;
  const j = to.findIndex((t) => t.cell === from[i].cell);
  const a = from[i].kid!, b = to[j].kid!;
  if (a === b) return undefined;
  return { wire, lca: from[i].cell, a, b, from: from.slice(0, i).reverse(), to: to.slice(0, j).reverse() };
}

export const isContainer = (box: Box): boolean => !!box.group;
