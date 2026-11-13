// The engine's vocabulary. Everything inside a container is described in that
// container's own frame — `u` runs along a rank (the lane axis), `v` runs
// across the ranks — so every stage is written once, for a downward flow, and
// `frame.ts` is the only place that knows which of the two is x.
import type { Box, Dir, Group, Wire } from "../contract.js";

/** A wall of a box or of a container, in the frame of the sheet being laid out. */
export type Wall = "n" | "s" | "e" | "w";

/** A container's inside, as the tree knows it. The root is the cell `""`. */
export interface Cell {
  id: string;
  box?: Box;
  group: Group;
  parent?: Cell;
  depth: number;
}

/** One container a wire passes on its way: the cell, and its child the wire
 *  goes on into — `null` where the wire ends at the container itself. */
export interface Step { cell: Cell; kid: string | null }

/** A wire, cut where its two ends part company. `a` and `b` are children of
 *  `lca`; `from` and `to` list the containers each side passes, outermost first. */
export interface Path {
  wire: Wire;
  lca: Cell;
  a: string; b: string;
  from: Step[]; to: Step[];
}

/** A child box as its parent's sheet sees it: sizes turned into the frame. */
export interface Kid {
  id: string;
  box: Box;
  /** the child's own sheet, when it is a container */
  sheet?: Sheet;
  w: number; h: number;
  /** how much of the n/s walls, from low u, takes a wire (a table in a rightward flow) */
  faceU?: number;
  /** how much of the e/w walls, from low v, takes a wire (a table in a downward flow) */
  faceV?: number;
  /** room past the box, along u or along v, that nothing may be placed over */
  bleedU: number; bleedV: number;
}

/** Something that takes a place in a row's order: a box, a wire passing the
 *  row (`lane`), or a wire crossing the sheet's north or south wall (`port`). */
export interface Slot {
  i: number;
  kind: "box" | "lane" | "port";
  /** 0 is the north wall, 1..R the ranks, R+1 the south wall */
  row: number;
  kid?: Kid;
  /** a lane's or port's wire, or the bundle it carries */
  key?: string;
  /** a label riding on a lane: its extent along u and along v, and its wire */
  label?: { u: number; v: number; wire: string };
  /** the author arranged this box's place in its row */
  held: boolean;
  /** band of `columns` the box belongs to, or -1 */
  col: number;
  /** no wire touches the box, inside or out */
  idle: boolean;
  /** place in the declared order of its row — worth a tie, not a crossing */
  decl: number;
}

/** A stretch of wire from a slot in one row to a slot in the next. Wires of
 *  one bundle that run together are one link. */
export interface Link {
  up: number; down: number;
  /** names the port at either end: the wire, or the bundle it belongs to */
  key: string;
  wires: string[];
  /** runs against the flow: it follows its boxes and never leads them */
  back: boolean;
  /** links of one trunk share a track where they part */
  net?: string;
  /** a label rides on this link's stub — the one into its lower end, or
   *  (a trunk that gathers) the one out of its upper end */
  label?: { u: number; v: number; wire: string; at: "top" | "bottom" };
}

/** A wire between two boxes of one rank. `a` stands before `b`. */
export interface Flat {
  a: number; b: number;
  key: string; wire: string;
  /** neighbours with facing walls: straight across the gutter. Otherwise round, under the row. */
  straight: boolean;
  /** the wire runs from `a` to `b` */
  fwd: boolean;
  label?: { u: number; v: number };
}

/** A wire from a box to the sheet's east or west wall. */
export interface Side {
  x: number;
  wall: "e" | "w";
  key: string; wire: string;
  /** `auto`: a leaf — straight when it is last in its row, else over or under
   *  the row, whichever is quieter, decided on the order as it stands. A
   *  container's answer is fixed when the sheet is built, because the wall it
   *  leaves the container by is part of that container's own structure. */
  via: "auto" | "straight" | "over" | "under";
  /** the wire runs from the box out to the wall */
  out: boolean;
}

/** A wire that ends at this container's own east or west wall. */
export interface Term { wall: "e" | "w"; key: string; wire: string }

/** How one wire is drawn in one sheet. */
export type Piece =
  | { kind: "vert"; slots: number[]; down: boolean }
  | { kind: "flat"; flat: Flat }
  | { kind: "side"; side: Side }
  | { kind: "term"; wall: Wall; key: string };

/** One container's inside: the static structure every later stage works on.
 *  `rows` is the one thing the ordering stage changes. */
export interface Sheet {
  cell: Cell;
  dir: Dir;
  parent?: Sheet;
  /** this sheet's slot in its parent */
  self?: number;
  /** number of ranks */
  R: number;
  kids: Kid[];
  slots: Slot[];
  /** rows[0] the north wall's ports, rows[1..R] the ranks, rows[R+1] the south wall's */
  rows: number[][];
  /** place of each slot in its row */
  at: number[];
  /** chan[k]: the links between rows[k] and rows[k+1] */
  chan: Link[][];
  flats: Flat[];
  sides: Side[];
  terms: Term[];
  pieces: Map<string, Piece>;
  /** `wall|key` → the port slot on the north or south wall */
  port: Map<string, number>;
  /** `wall|key` → the wire through the east or west wall */
  through: Map<string, Side | Term>;
  /** pairs that keep their order within a row: the ends of a same-rank wire */
  before: [number, number][];
  /** pairs no box may come between: neighbours a wire joins straight */
  glue: [number, number][];
  /** boxes that stay last in their row toward a wall: a container whose wire runs straight out */
  last: { x: number; wall: "e" | "w" }[];
  pad: { n: number; s: number; w: number; e: number };
  gap: { lane: number; rank: number };
  /** the title's corner, in this frame: along the north wall in a downward
   *  sheet, along the west wall in a rightward one */
  title?: { u: number; v: number };
  minW: number;
  /** per slot: how many wires leave it upward, and downward (round-the-row wires included) */
  busy: { up: number[]; down: number[] };
  /** rough width, for judging straightness before anything has a position */
  rough: number;
  geo?: Geo;
}

/** A sheet laid out: everything in the sheet's own frame, origin at its
 *  north-west corner. */
export interface Geo {
  W: number; H: number;
  /** per slot: centre along u */
  u: number[];
  /** per box slot: its north wall's v */
  top: number[];
  /** `wall|key` → where the wire crosses the wall, measured along it */
  ports: Map<string, number>;
  /** wire id → its polyline in this sheet, in the direction the wire runs */
  wires: Map<string, { x: number; y: number }[]>;
  labels: Map<string, { x: number; y: number; w: number; h: number }>;
}

export type { Box, Dir, Group, Wire };
