// One number for "does this view look better?" — so the question can be
// asked of four hundred views at once and answered the same way each time.
//
// A view's *penalty* adds up what a reviewer would mark on it (DESIGN §9),
// each weighted by how much it costs the reader:
//
//   60  something illegal: a wire through a box, an overlap, a broken invariant
//   10  two wires crossing
//    5  a jog too short to draw cleanly; two boxes almost, but not, in line
//    4  a box off the middle of the boxes its wires fan out to
//    3  a wire that bends although its ends face each other
//    2  a wall's only wire a few pixels off the wall's middle
//    1  a bend
//    1  per 200 px of wire
//
// Canvas size is not counted: a bigger picture is not a worse one. (Wire
// length stays — a wire taken the long way round is.)
//
// "Lopsided" outweighs the two bends it costs to centre a parent over two
// children: a centred fan with both wires bent reads better than a straight
// wire to one child and the parent hanging over it. Set it to nothing and
// that preference is gone — the test prints that verdict too.
//
// The weights are a judgement, written down once and applied to both
// engines; the test beside this file prints how the verdict moves when they
// are doubled or halved. Lower is better. `gain` compares two penalties for
// one view on a scale from −1 (all of it the new engine's) to +1.

import type { Metrics } from "./metrics.js";

export const WEIGHTS = { illegal: 60, crossings: 10, kinks: 5, nearMiss: 5, lopsided: 4, unstraight: 3, offCentre: 2, bends: 1, wire: 1 / 200, area: 0 };
export type Weights = typeof WEIGHTS;

export function penalty(m: Metrics, illegal: number, w: Weights = WEIGHTS): number {
  return w.illegal * (illegal + m.throughNode) + w.crossings * m.crossings + w.kinks * m.kinks + w.nearMiss * m.nearMiss
    + w.lopsided * m.lopsided + w.unstraight * m.unstraight + w.offCentre * m.offCentre + w.bends * m.bends + w.wire * m.wire + w.area * m.area;
}

/** Two views less than this apart are level, whatever the ratio: one point is
 *  one bend, and half a point against a quarter is not "twice as bad". */
export const FLOOR = 2;
/** How much better `mine` is than `theirs`: +1 all the way, 0 level, −1 worse. */
export const gain = (theirs: number, mine: number): number =>
  Math.abs(theirs - mine) < FLOOR ? 0 : (theirs - mine) / Math.max(theirs, mine, 1e-9);

export const MARGIN = 0.05; // within five percent is "about the same"
export type Verdict = "better" | "same" | "worse";
export const verdict = (g: number): Verdict => (g > MARGIN ? "better" : g < -MARGIN ? "worse" : "same");
