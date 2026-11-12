// The engine's vocabulary. The first half is what a caller sees; the second
// is what the stages hand each other while laying out one container.

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

// ── spacing ─────────────────────────────────────────────────────────────────
export const STUB = 16;        // a wire runs this far before it turns
export const TRACK = 16;       // between two tracks in one channel
export const WIRE_WIRE = 16;   // between two pass-through wires in a rank
export const WIRE_BOX = 24;    // between a pass-through wire and a box
export const LABEL_PAD = 10;   // between a label and anything beside it
export const CORNER = 8;       // a port keeps this far from a box's corner

// ── between the stages ──────────────────────────────────────────────────────

/** A container's four walls, named by what they are to its flow: where it
 *  starts and ends, and the low and high side of a rank. */
export type Role = "start" | "end" | "low" | "high";
/** The two walls of a box that face along the flow. */
export type Face = "start" | "end";

/** How a wire crosses the container that holds both its ends. */
export interface Route {
  home: string;                 // that container
  a: string; b: string;         // its direct children holding `from` and `to`
  kind: "down" | "up" | "beside" | "around";
  sideFrom: Side; sideTo: Side; // the walls it leaves and enters by
  fromChain: string[]; toChain: string[]; // containers between each end and `home`, outermost first
}

/** One container, laid out, in its own coordinates. */
export interface Laid {
  w: number; h: number;
  rects: Map<string, Rect>;     // its children
  pieces: Map<string, Pt[]>;    // wire → its run here, from → to
  labels: Map<string, Rect>;
  wall: Map<string, Pt>;        // wire → where it meets this container's wall
  /** child container → wire → the lane, in the child's own coordinates, the
   *  wire arrives on from this side of its wall. What the outside would like;
   *  the child may take it on a second pass. */
  approach: Map<string, Map<string, number>>;
}

/** What a wire does inside one container. */
export type Link =
  | { wire: Wire; type: "chain"; top: string | "wall"; bottom: string | "wall"; flipped: boolean }
  | { wire: Wire; type: "beside"; a: string; b: string }   // neighbours on one rank
  | { wire: Wire; type: "around"; a: string; b: string }   // one rank, something between
  | { wire: Wire; type: "side"; box: string; wall: "low" | "high"; outward: boolean };
export type ChainLink = Extract<Link, { type: "chain" }>;
export type BesideLink = Extract<Link, { type: "beside" }>;

/** Something that occupies a place in a layer: a box, a wire passing through
 *  (optionally carrying its label), or a wire's port on the container wall. */
export interface Slot {
  kind: "box" | "pass" | "port";
  id: string;                 // box id, or the wire's
  box?: Box;
  lsize: number; fsize: number;
  after: number;              // extra room on the lane-high side (a bleed, sideways)
  pos: number;                // lane start
  label?: boolean;
  /** Its place in its layer is settled: every box, and a wall port once the
   *  outside has said which lane its wire arrives on. */
  pinned?: boolean;
}
export interface Layer { kind: "rank" | "label" | "wall"; slots: Slot[]; f: number; depth: number }

/** A wire's way through the layers, top to bottom. `flipped` when the wire
 *  itself runs bottom to top. */
export interface Chain { wire: Wire; path: Slot[]; first: number; flipped: boolean }
