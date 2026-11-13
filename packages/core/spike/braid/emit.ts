// The picture: every cell's frame set in the page, every wire stitched from
// its pieces.
//
// Each cell was drawn in its own frame with ranks running down. Here each is
// given its place in the page — the root at the origin, a container at its
// box in the cell that holds it — and turned if it flows rightward: a
// `right` cell is its `down` drawing with x and y swapped, exactly (§5.8).
// A wire's pieces, cell by cell from one end to the other, already meet at
// the walls (both sides read the same `portAt`), so stitching is
// concatenation.

import type { Pt, Rect, Solution } from "../contract.js";
import type { Cell, Plan } from "./plan.js";

export function emit(plan: Plan): Solution {
  const origin = new Map<Cell, Pt>([[plan.root, { x: 0, y: 0 }]]);
  const boxes = new Map<string, Rect>(), ranks = new Map<string, number>();
  const toPage = (cell: Cell, p: Pt): Pt => {
    const o = origin.get(cell)!;
    return cell.flip ? { x: o.x + p.y, y: o.y + p.x } : { x: o.x + p.x, y: o.y + p.y };
  };
  const rectIn = (cell: Cell, x: number, y: number, w: number, h: number): Rect => {
    const p = toPage(cell, { x, y });
    return cell.flip ? { x: p.x, y: p.y, w: h, h: w } : { x: p.x, y: p.y, w, h };
  };
  // outermost first: a cell's origin is its box in the cell outside
  for (const cell of [...plan.cells].reverse())
    for (const it of cell.boxes.values()) {
      const r = rectIn(cell, it.x - it.w / 2, it.y, it.w, it.h);
      boxes.set(it.node!.id, r);
      ranks.set(it.node!.id, cell.ranks.get(it.node!.id)!);
      if (it.inner) origin.set(it.inner, { x: r.x, y: r.y });
    }

  const wires: Solution["wires"] = new Map();
  for (const [id, route] of plan.routes) {
    const pts: Pt[] = [];
    for (const { piece, fwd } of route)
      for (const p of fwd ? piece.pts : [...piece.pts].reverse()) pts.push(toPage(piece.cell, p));
    const label = plan.labels.get(id);
    let rect: Rect | undefined;
    if (label?.item) {
      const it = label.item;
      rect = rectIn(it.cell, it.x - it.w / 2, it.y, it.w, it.h);
    } else if (label?.piece?.label?.at) {
      const { at, w, h } = label.piece.label, cell = label.piece.cell;
      rect = rectIn(cell, at.x - Math.floor(w / 2), at.y - Math.floor(h / 2), w, h);
    }
    wires.set(id, { points: tidy(pts), ...(rect ? { label: rect } : {}) });
  }
  const size = rectIn(plan.root, 0, 0, plan.root.w, plan.root.h);
  return { width: size.w, height: size.h, boxes, ranks, wires, skipped: plan.tree.skipped };
}

/** No repeated points, no three in a line. */
export function tidy(pts: readonly Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const a = out[out.length - 2], b = out[out.length - 1];
    if (b && b.x === p.x && b.y === p.y) continue;
    if (a && b && ((a.x === b.x && b.x === p.x) || (a.y === b.y && b.y === p.y))) out.pop();
    out.push({ x: p.x, y: p.y });
  }
  return out;
}
