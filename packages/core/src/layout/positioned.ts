// `Positioned`: a view with a place for everything — what layout produces,
// what the renderer draws and what `checkLayout` holds to the invariants.
import type { VNode } from "../view/resolve.js";
import type { Side, Hue, ZoneKind, ZoneLabelPos } from "../model/types.js";

export interface PNode extends VNode {
  x: number; y: number; w: number; h: number;
  rank: number;
}
export interface PPort { edge: string; node: string; side: Side; x: number; y: number }
export interface PFrame {
  path: string; label: string; x: number; y: number; w: number; h: number;
  color?: Hue;
  /** A wire runs through the title: the renderer draws the title last, on a
   *  halo, so it stays legible — the zone-chip rule applied to frame titles.
   *  Set only when it happens, which keeps every other render byte-identical. */
  titleCrossed?: boolean;
  /** Frame-chain nesting depth, outermost = 0. Counts *frames* only — a frame
   *  inside a zone is still depth 0 — because the renderer keys the recessed
   *  fill off it (depth 0 only; docs/notes/full-detail.md). */
  depth: number;
  /** The container's mark for the header chip (VFrame.icon). */
  icon?: { pack: string; id: string };
}
export interface PZone {
  id: string; label: string; kind: ZoneKind;
  icon?: { pack: string; id: string };
  labelPos: ZoneLabelPos;
  color?: Hue;
  /** mono chip segment — a CIDR, an account id (SPEC §zones) */
  detail?: string;
  x: number; y: number; w: number; h: number;
  depth: number; // nesting depth, outermost = 0 (render order)
}
export interface PEdge {
  id: string; from: string; to: string;
  label?: string; async: boolean;
  animate?: import("../model/types.js").EdgeAnimate;
  style?: "dashed" | "dotted";
  count: number;
  tags: string[];
  color?: Hue;
  heads: "one" | "both" | "none";
  /** Relationship marks to draw in place of the head, one per end — absent
   *  where the view's lines are straight (no stub to draw them on). */
  marks?: { from: import("../model/types.js").EdgeMark; to: import("../model/types.js").EdgeMark };
  points: { x: number; y: number }[];
  /** The room the layout reserved for this edge's label, on the wire. The pill
   *  is drawn exactly here — no search, no fallback, no way to collide: the
   *  room exists because the layout made it. Absent on an unlabelled edge. */
  labelRect?: { x: number; y: number; w: number; h: number };
  /** Set on the wires of a folded row's trunk (`wrap`): they share one port
   *  on the box they fan out of and run as a spine with branches
   *  (docs/notes/wrap.md). */
  via?: "bus";
}
export interface Positioned {
  name: string;
  width: number; height: number;
  nodes: PNode[]; edges: PEdge[]; ports: PPort[]; frames: PFrame[];
  zones: PZone[];
  flow?: { label: string; byEdge: Record<string, number[]> };
  lines: "orthogonal" | "curved" | "straight";
  /** Zone label chips: geometry only — colour is a theme concern and layout
   *  is theme-free (the adaptive contract shares one layout across palettes).
   *  Each is slid along its zone's border to the least-crossed spot. */
  chips: {
    x: number; y: number; w: number; h: number; label: string; zone: string;
    icon?: { pack: string; id: string };
    /** mono segment text, and the width reserved for it — measured here so
     *  the renderer draws the segment the placer actually made room for */
    detail?: string; detailW?: number;
  }[];
  /** Flow badges, reserved for the FULL flow's step text. Walking a flow
   *  (`flowStep`) is a viewer concern: the renderer draws the walked subset
   *  right-aligned inside the reservation, so per-step text changes never move
   *  or collide with anything. */
  badges: { edgeId: string; x: number; y: number; w: number; h: number; nums: number[] }[];
  /** Fully placed notes, in declaration order. A note anchored to a node
   *  stands in room the layout kept beside that node; one anchored to an edge,
   *  beside the wire. Text lines are pre-wrapped (font-derived, theme-free);
   *  style/colour stay the renderer's. */
  notes?: { i: number; x: number; y: number; w: number; h: number; lines: string[]; leader?: { x1: number; y1: number; x2: number; y2: number } }[];
}
