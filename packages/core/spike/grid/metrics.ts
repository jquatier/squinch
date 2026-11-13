// What "a better layout" means, as numbers — the same function over either
// engine's `Positioned`, so the comparison cannot favour one by construction.
//
// The invariant sweep says whether a layout is *legal*. These say how good a
// legal one is, in the terms DESIGN §9 reviews by eye: how big, how much wire,
// how many turns, how many crossings, and whether anything runs through
// something it should go around.
import type { Positioned } from "../../src/layout/layout.js";

export interface Metrics {
  area: number; width: number; height: number;
  wire: number;        // total wire length
  bends: number;       // turns, over all wires
  crossings: number;   // two different wires crossing
  overlaps: number;    // two different wires drawn along the same line
  throughNode: number; // a wire through a node that is not one of its ends
  throughFrame: number;// a wire through a frame or zone neither end is inside
  kinks: number;       // a jog shorter than a corner radius can draw cleanly
  unstraight: number;  // wires that turn although their ends face each other
  nearMiss: number;    // two boxes in one container almost, but not, on one line
}

type Seg = { x1: number; y1: number; x2: number; y2: number; horizontal: boolean };
const segs = (pts: { x: number; y: number }[]): Seg[] =>
  pts.slice(1).map((b, i) => {
    const a = pts[i];
    return { x1: Math.min(a.x, b.x), y1: Math.min(a.y, b.y), x2: Math.max(a.x, b.x), y2: Math.max(a.y, b.y), horizontal: a.y === b.y };
  });
const within = (v: number, lo: number, hi: number) => v > lo && v < hi;

export function measureLayout(p: Positioned): Metrics {
  const wires = p.edges.map((e) => ({ e, segs: segs(e.points) }));
  let wire = 0, bends = 0, crossings = 0, overlaps = 0, throughNode = 0, throughFrame = 0, kinks = 0, unstraight = 0;
  for (const { e, segs: ss } of wires) {
    wire += ss.reduce((a, s) => a + (s.x2 - s.x1) + (s.y2 - s.y1), 0);
    bends += Math.max(0, e.points.length - 2);
    for (let i = 1; i + 1 < ss.length; i++) if (ss[i].x2 - ss[i].x1 + ss[i].y2 - ss[i].y1 < 16) kinks++;
    const a = e.points[0], b = e.points[e.points.length - 1];
    if (e.points.length > 2 && (Math.abs(a.x - b.x) < 8 || Math.abs(a.y - b.y) < 8)) unstraight++;

    const own = (path: string) => e.from === path || e.to === path || e.from.startsWith(path + ".") || e.to.startsWith(path + ".");
    const hits = (r: { x: number; y: number; w: number; h: number }) =>
      ss.some((s) => s.x1 < r.x + r.w && s.x2 > r.x && s.y1 < r.y + r.h && s.y2 > r.y);
    for (const n of p.nodes) if (n.path !== e.from && n.path !== e.to && hits(n)) throughNode++;
    for (const f of p.frames) if (!own(f.path) && hits(f)) throughFrame++;
  }
  for (let i = 0; i < wires.length; i++)
    for (let j = i + 1; j < wires.length; j++)
      for (const s of wires[i].segs)
        for (const t of wires[j].segs) {
          if (s.horizontal !== t.horizontal) {
            const [h, v] = s.horizontal ? [s, t] : [t, s];
            if (within(v.x1, h.x1, h.x2) && within(h.y1, v.y1, v.y2)) crossings++;
          } else if (s.horizontal ? s.y1 === t.y1 && s.x1 < t.x2 && t.x1 < s.x2 : s.x1 === t.x1 && s.y1 < t.y2 && t.y1 < s.y2) {
            overlaps++;
          }
        }
  // DESIGN: nothing almost-aligned. Two boxes of one container whose centre
  // lines are 1–7 px apart read as a mistake; 0 is aligned, 8 and more is a choice.
  let nearMiss = 0;
  const almost = (a: number, b: number) => Math.abs(a - b) > 0 && Math.abs(a - b) < 8;
  for (let i = 0; i < p.nodes.length; i++)
    for (let j = i + 1; j < p.nodes.length; j++) {
      const a = p.nodes[i], b = p.nodes[j];
      if (a.frame !== b.frame) continue;
      const beside = a.x + a.w <= b.x || b.x + b.w <= a.x, stacked = a.y + a.h <= b.y || b.y + b.h <= a.y;
      if (beside && !stacked && almost(a.y + a.h / 2, b.y + b.h / 2) && almost(a.y, b.y)) nearMiss++;
      if (stacked && !beside && almost(a.x + a.w / 2, b.x + b.w / 2) && almost(a.x, b.x)) nearMiss++;
    }
  return { area: p.width * p.height, width: p.width, height: p.height, wire, bends, crossings, overlaps, throughNode, throughFrame, kinks, unstraight, nearMiss };
}
