// How a finished picture counts: wires crossing, and turns. Cheap enough to
// ask of every pass, so the engine can keep the best one it drew.

import type { Solution } from "./types.js";

export function tally(sol: Solution): { crossings: number; bends: number } {
  const h: { y: number; a: number; b: number; w: number }[] = [], v: { x: number; a: number; b: number; w: number }[] = [];
  let bends = 0, w = 0;
  for (const { points } of sol.wires.values()) {
    bends += Math.max(0, points.length - 2);
    for (let i = 0; i + 1 < points.length; i++) {
      const p = points[i], q = points[i + 1];
      if (p.y === q.y) h.push({ y: p.y, a: Math.min(p.x, q.x), b: Math.max(p.x, q.x), w });
      else v.push({ x: p.x, a: Math.min(p.y, q.y), b: Math.max(p.y, q.y), w });
    }
    w++;
  }
  let crossings = 0;
  for (const s of h) for (const t of v) if (s.w !== t.w && t.x > s.a && t.x < s.b && s.y > t.a && s.y < t.b) crossings++;
  return { crossings, bends };
}
