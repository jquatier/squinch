// The contract between Squinch and a layout engine: what an engine is given
// and what it gives back. Nothing here says how.
//
// `grid/problem.ts` turns a Squinch view into a `Problem`; `grid/layout.ts`
// turns the `Solution` into the `Positioned` the renderer draws. An engine is
// one function, `solve(problem: Problem): Solution`.

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
}
