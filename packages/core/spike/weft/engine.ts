// `solve`: boxes and wires in, rectangles and polylines out.
//
// Four stages, each run once, each for the whole picture:
//
//   grow    the tree of containers; every wire cut where its ends part  (tree.ts)
//   weave   a sheet per container: ranks, slots, which wall each wire
//           uses — outermost first, nothing waiting on a position       (sheet.ts)
//   order   the order of every row of every sheet, together             (order.ts)
//   lay     each sheet's geometry, innermost first, because a
//           container's size is its inside's                            (lay.ts)
//
// and then the sheets are set on the page and each wire's pieces joined.
// Nothing later sends anything back to an earlier stage.
import type { Problem, Pt, Rect, Solution } from "../contract.js";
import { pagePt, pageRect } from "./frame.js";
import { lay } from "./lay.js";
import { order } from "./order.js";
import { weave } from "./sheet.js";
import { grow } from "./tree.js";
import type { Sheet } from "./types.js";

export type { Box, Dir, Group, Problem, Solution, Wire } from "../contract.js";

export function solve(problem: Problem): Solution {
  const tree = grow(problem);
  const sheets = weave(tree);
  order(sheets);
  for (const s of [...sheets].reverse()) s.geo = lay(s, s === sheets[0]);

  // ── onto the page ──────────────────────────────────────────────────────────
  const root = sheets[0], geo = root.geo!;
  const boxes = new Map<string, Rect>(), ranks = new Map<string, number>();
  const origin = new Map<Sheet, Pt>();
  const set = (s: Sheet, o: Pt) => {
    origin.set(s, o);
    for (const slot of s.slots) {
      const kid = slot.kid;
      if (!kid) continue;
      const r = pageRect(s.dir, o, { x: s.geo!.u[slot.i] - kid.w / 2, y: s.geo!.top[slot.i], w: kid.w, h: kid.h });
      boxes.set(kid.id, r);
      ranks.set(kid.id, slot.row - 1);
      if (kid.sheet) set(kid.sheet, { x: r.x, y: r.y });
    }
  };
  set(root, { x: 0, y: 0 });

  const sheetOf = new Map(sheets.map((s) => [s.cell.id, s]));
  const wires = new Map<string, { points: Pt[]; label?: Rect }>();
  for (const path of tree.paths) {
    // the wire's pieces, from its source out to where the ends part and in again
    const cells = [...[...path.from].reverse().map((x) => x.cell), path.lca, ...path.to.map((x) => x.cell)];
    const points: Pt[] = [];
    let label: Rect | undefined;
    for (const cell of cells) {
      const s = sheetOf.get(cell.id)!, o = origin.get(s)!;
      for (const p of s.geo!.wires.get(path.wire.id) ?? []) points.push(pagePt(s.dir, o, p.x, p.y));
      const l = s.geo!.labels.get(path.wire.id);
      if (l) label = pageRect(s.dir, o, l);
    }
    wires.set(path.wire.id, { points: tidy(points), label });
  }
  const size = root.dir === "down" ? { width: geo.W, height: geo.H } : { width: geo.H, height: geo.W };
  return { ...size, boxes, ranks, wires, skipped: tree.skipped };
}

/** One polyline from the pieces: no repeated point, no three in a line. */
function tidy(points: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const a = out[out.length - 2], b = out[out.length - 1];
    if (b && b.x === p.x && b.y === p.y) continue;
    if (a && ((a.x === b.x && b.x === p.x) || (a.y === b.y && b.y === p.y))) out.pop();
    out.push(p);
  }
  return out;
}
