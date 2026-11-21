// The contract between Squinch and a layout engine: what an engine is given
// and what it gives back. Nothing here says how.
//
// `../plan.ts` turns a Squinch view into a `Problem`; `../layout.ts` turns
// the `Solution` into the `Positioned` the renderer draws. An engine is one
// function, `solve(problem: Problem): Solution`.

export type Dir = "down" | "right";
export type Side = "north" | "south" | "east" | "west";
export interface Pt { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }

export interface Box {
  id: string;
  /** Leaves say their size; a container's is computed from its inside. */
  w: number; h: number;
  /** How much of the east/west walls a wire may land on, from the top — a
   *  table's head, when its rows hang below. Default: the whole wall. */
  face?: number;
  /** Something drawn below the box that is not part of it (a card's sheets). */
  bleed?: number;
  /** Clear space kept outside a wall of a leaf (a note anchored beside it),
   *  as deep as stated and as long as the wall, by screen side. Nothing
   *  enters it — no other box, no lane, no label, no wire but the box's own
   *  on that wall, which cross it straight — and the container's walls stay
   *  outside it. The box's rectangle, ports and balanced place are the box's
   *  own: the room is not part of it. South of a box that also has `bleed`,
   *  the deeper of the two holds. */
  room?: { north?: number; south?: number; east?: number; west?: number };
  /** A container is never narrower than this (its title has to fit). */
  minW?: number;
  /** A container's title, as the corner of its top-left it occupies. No wire
   *  enters through it: a port keeps clear, and a wire that has to pass under
   *  it turns below it. */
  title?: { w: number; h: number };
  group?: Group;
}
export interface Group {
  dir: Dir;
  pad: { top: number; right: number; bottom: number; left: number };
  gap: { lane: number; rank: number };
  /** In the order they sit within a rank, as declared. The engine reorders
   *  them only to uncross wires, and never the ones in `held`. */
  boxes: Box[];
  /** Boxes whose place in their rank the author arranged (`rows`, `cols`,
   *  `place`): each keeps its slot. */
  held?: string[];
  pins: Map<string, number>;
  /** Sets of boxes, in different ranks, that share one centre line. */
  aligned?: string[][];
  /** Bands across the ranks, low to high: every box of one stands wholly
   *  before every box of the next, whichever ranks they are in. */
  columns?: string[][];
}
export interface Wire {
  id: string; from: string; to: string;
  label?: { w: number; h: number };
  /** Wires of one bundle share an end and are drawn as a trunk with branches:
   *  one port on the shared box, one lane through each rank they all cross,
   *  one track where they part. (`wrap` on a fan-out; `channel`.) */
  bundle?: string;
  /** The wall a wire is asked to leave its `from` box by, and to enter its
   *  `to` box by — screen sides, and only for a wire whose ends are in
   *  different ranks or containers (between two row-mates it is ignored). A
   *  side that is the natural one changes nothing; any other is drawn the
   *  long way round, at least 16 px straight out of the wall first.
   *
   *  The side is asked of the box the wire names, and carries outward: where
   *  that box has a clear run to the same wall of the container around it —
   *  it is the last box of its row on that side as declared, or in the first
   *  (last) rank for north (south) — the wire crosses the container's wall by that side
   *  too, and so on through each container out to where the wire's two ends
   *  part. Where something stands between, the wire crosses that container
   *  by its natural wall. A wire that ends at a container is asked of that
   *  container's wall.
   *
   *  Where the named box's own wall cannot be given, the end keeps its
   *  natural side and is listed in `Solution.unhonoured`. */
  fromSide?: Side; toSide?: Side;
  /** Something is drawn on the wire where it meets its `from` box, or its
   *  `to` box, this far out from the wall and a little to either side. No
   *  label stands on it — the wire's own or a neighbour's. Leaves only. */
  tips?: { from?: number; to?: number };
}
export interface Problem { root: Group; wires: Wire[] }
export interface Solution {
  width: number; height: number;
  boxes: Map<string, Rect>;
  /** Rank of each box within its own container. */
  ranks: Map<string, number>;
  wires: Map<string, { points: Pt[]; label?: Rect }>;
  /** Wires the engine does not draw: one end contains the other. */
  skipped: string[];
  /** Boxes of an `aligned` set that do not stand on its centre line. Two
   *  boxes of one rank can never share one, so only the first member given
   *  in each rank takes part; and a set the rest of the arrangement
   *  contradicts (`columns`, `held`, another set) gives way rather than let
   *  two boxes overlap. Absent when every member is on its line. */
  unaligned?: string[];
  /** Ends of wires drawn, but not by the side they asked for (`fromSide`, `toSide`). Absent when there are none. */
  unhonoured?: Refusal[];
}
/** An end of a wire that was not given the side it asked for, and why — with
 *  what the caller needs to say so, in screen sides:
 *  - `trunk`: the wire is one of a bundle, which shares its port and lanes;
 *  - `taken`: that side of the box already carries a wire straight out of it
 *    — across to a neighbour, or on to the container's wall. Asked for north
 *    or south, the wire has to go round one side of its box, and both are in
 *    use. `inUse`: those sides;
 *  - `row`: the box stands in one rank with the box that holds the other end
 *    (`mate`), so the wire runs along the rank;
 *  - `far`: the wire leaves the box's container by a side wall (`by`), and
 *    the box was asked for the wall facing the other way;
 *  - `blocked`: it was asked for the wall facing that way, with a row-mate
 *    standing between. For both, `open` is the two sides it could be given
 *    there: over and under the row. */
export interface Refusal {
  wire: string; end: "from" | "to";
  why: "trunk" | "taken" | "row" | "far" | "blocked";
  inUse?: Side[]; mate?: string; by?: Side; open?: Side[];
}
