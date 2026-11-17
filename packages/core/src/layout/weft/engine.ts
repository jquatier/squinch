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
import type { Problem, Pt, Rect, Solution } from "./contract.js";
import { pagePt, pageRect } from "./frame.js";
import { lay } from "./lay.js";
import { order } from "./order.js";
import { giveRoom, weave } from "./sheet.js";
import { grow } from "./tree.js";
import type { Sheet } from "./types.js";

export type { Box, Dir, Group, Problem, Solution, Wire } from "./contract.js";

/** How many times the sheets may be laid out again to give stuck labels room. */
const ROOMS = 2;

export function solve(problem: Problem): Solution {
  const tree = grow(problem);
  const sheets = weave(tree);
  order(sheets);
  const draw = () => { for (const s of [...sheets].reverse()) s.geo = lay(s, s === sheets[0]); };
  draw();
  // A label is crossed by nothing but its own wire (§5.6). Each sheet moves a
  // crossed label along its wire to a clear place, which costs the picture
  // nothing. Whether there is such a place is only known once the wires are
  // drawn; a label with none — parallel wires 16 px apart, each under the
  // other's label — is then given room on its wire's own line (its
  // neighbours stand half its width off, through a container's wall too) and
  // the sheets are laid out again. Bounded: every pass gives room to at least
  // one more label, and at most `ROOMS` passes are made.
  for (let pass = 0; pass < ROOMS; pass++) {
    const stuck = sheets.flatMap((s) => s.geo!.stuck.flatMap((wire) => s.chan.flatMap((links) => links.filter((l) => l.label?.wire === wire && !l.label.room).map((l) => ({ s, l })))));
    if (!stuck.length) break;
    for (const { s, l } of stuck) giveRoom(s, l);
    draw();
  }
  // a label still under another wire takes the place it would have had, on
  // what is drawn at its wire's end (`Wire.tips`), rather than stay there
  for (const s of sheets) for (const wire of s.geo!.stuck) { const at = s.geo!.spare.get(wire); if (at) s.geo!.labels.set(wire, at); }

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
  // wires that asked for a side and could not be given it, once each
  const unhonoured = [...new Set(sheets.flatMap((s) => s.unhonoured))];
  // boxes of an aligned set that are not on its line: left out for standing in a rank it already has a member in, or pushed off it
  const unaligned = [...new Set(sheets.flatMap((s) => [...s.unaligned, ...s.geo!.unaligned]))];
  return { ...size, boxes, ranks, wires, skipped: tree.skipped, ...(unhonoured.length ? { unhonoured } : {}), ...(unaligned.length ? { unaligned } : {}) };
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
