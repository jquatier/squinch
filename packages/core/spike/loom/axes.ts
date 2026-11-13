// Inside a container everything is computed on two abstract axes: `f` is the
// way the ranks advance (the flow), `l` is the way boxes sit side by side in a
// rank (the lane). This file is the only place that knows which of them is x.
// `direction right` is `direction down` with the two swapped here.

import type { Box, Dir, Group, Pt, Rect, Role, Side, Wire } from "./types.js";

const ROLE: Record<Dir, Record<Side, Role>> = {
  down: { north: "start", south: "end", west: "low", east: "high" },
  right: { west: "start", east: "end", north: "low", south: "high" },
};
const SIDE: Record<Dir, Record<Role, Side>> = {
  down: { start: "north", end: "south", low: "west", high: "east" },
  right: { start: "west", end: "east", low: "north", high: "south" },
};

export const sideOf = (dir: Dir, role: Role): Side => SIDE[dir][role];

export interface Axes {
  down: boolean;
  role(side: Side): Role;
  lsize(b: Box): number; fsize(b: Box): number;
  /** How much of a box's flow-facing walls a wire may use, lane-wise… */
  flowFace(b: Box): number;
  /** …and of its side walls, flow-wise. */
  sideFace(b: Box): number;
  labelL(w: Wire): number; labelF(w: Wire): number;
  /** A point's offset along the lane / along the flow. */
  laneOf(p: Pt): number; flowOf(p: Pt): number;
  pad: { start: number; end: number; low: number; high: number };
  toScreen(l: number, f: number): Pt;
  rect(l: number, f: number, lsize: number, fsize: number): Rect;
}

export function axes(g: Group): Axes {
  const down = g.dir === "down";
  const toScreen = (l: number, f: number): Pt => (down ? { x: l, y: f } : { x: f, y: l });
  return {
    down,
    role: (s) => ROLE[g.dir][s],
    lsize: (b) => (down ? b.w : b.h),
    fsize: (b) => (down ? b.h : b.w),
    flowFace: (b) => (down ? b.w : b.face ?? b.h),
    sideFace: (b) => (down ? b.face ?? b.h : b.w),
    labelL: (w) => (down ? w.label!.w : w.label!.h),
    labelF: (w) => (down ? w.label!.h : w.label!.w),
    laneOf: (p) => (down ? p.x : p.y),
    flowOf: (p) => (down ? p.y : p.x),
    pad: down
      ? { start: g.pad.top, end: g.pad.bottom, low: g.pad.left, high: g.pad.right }
      : { start: g.pad.left, end: g.pad.right, low: g.pad.top, high: g.pad.bottom },
    toScreen,
    rect: (l, f, ls, fs) => {
      const p = toScreen(l, f);
      return down ? { x: p.x, y: p.y, w: ls, h: fs } : { x: p.x, y: p.y, w: fs, h: ls };
    },
  };
}
