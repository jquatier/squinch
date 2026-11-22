// The one place that knows which axis is x.
//
// A rightward container is a downward one with x and y exchanged — exactly
// (REQUIREMENTS §5.8). Exchanging the axes exchanges north with west and
// south with east, and nothing else: both pairs still run low to high, so
// the order of ports along a wall reads the same from either side of it.
import type { Dir, Pt, Rect } from "./contract.js";
import type { Wall } from "./types.js";

const TURN: Record<Wall, Wall> = { n: "w", w: "n", s: "e", e: "s" };

/** A wall named in one frame, as the other frame names it. */
export const turn = (wall: Wall, from: Dir, to: Dir): Wall => (from === to ? wall : TURN[wall]);

/** A wall of a `dir` sheet, as the page names it — and back: the same exchange. */
export const real = (wall: Wall, dir: Dir): Wall => turn(wall, dir, "down");

/** A point of a `dir` sheet whose north-west corner is at `o`, on the page. */
export const pagePt = (dir: Dir, o: Pt, u: number, v: number): Pt =>
  dir === "down" ? { x: o.x + u, y: o.y + v } : { x: o.x + v, y: o.y + u };

export const pageRect = (dir: Dir, o: Pt, r: Rect): Rect =>
  dir === "down" ? { x: o.x + r.x, y: o.y + r.y, w: r.w, h: r.h } : { x: o.x + r.y, y: o.y + r.x, w: r.h, h: r.w };

/** A size on the page, as a `dir` sheet measures it: along u, along v. */
export const framed = (dir: Dir, w: number, h: number): { u: number; v: number } =>
  dir === "down" ? { u: w, v: h } : { u: h, v: w };

/** Up to the next multiple of `step`. */
export const ceilTo = (x: number, step: number): number => Math.ceil(x / step - 1e-9) * step;
export const floorTo = (x: number, step: number): number => Math.floor(x / step + 1e-9) * step;
/** The 8-pixel grid every centre line stands on (§5.5). */
export const GRID = 8;
export const snap = (x: number): number => Math.round(x / GRID) * GRID;

/** The free place nearest `want` on the stretch `lo`..`hi`: a step from
 *  every place in `used` — the first of `gaps` — or, where the stretch is
 *  too crowded for that, as far from them as it allows, each gap in turn.
 *  Searched on the grid (or finer where the gap is finer), or, `stepped`, in
 *  whole gaps out from `want`. The one rule for sharing out a wall that has
 *  more wires than steps (`gutter.ts`, `lay.ts`, `sides.ts`); undefined only
 *  when not a pixel is free. */
export function nearestFree(used: readonly number[], want: number, lo: number, hi: number, gaps: readonly number[] = [16, 8, 4, 2, 1], stepped = false): number | undefined {
  for (const gap of gaps)
    for (let d = 0; d <= hi - lo; d += stepped ? gap : Math.min(gap, GRID))
      for (const x of [want - d, want + d]) if (x >= lo && x <= hi && used.every((t) => Math.abs(t - x) >= gap)) return x;
  return undefined;
}
