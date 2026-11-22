// What `Wire.tips` is held to, measured on random Problems: the picture stays
// legal with tips on, and no label stands on a tip. `withTips` marks every
// wire between two leaves on a seeded coin; `onTips` lists labels that overlap
// the box a mark would be drawn in (12 out from the wall, 5 to either side).
import type { Box, Group, Problem, Solution } from "../../src/layout/weft/contract.js";

export const TIP = 12, HALF = 5;

export function withTips(p: Problem, seed: number): Problem {
  const leaf = new Set<string>();
  const walk = (g: Group) => { for (const b of g.boxes as Box[]) if (b.group) walk(b.group); else leaf.add(b.id); };
  walk(p.root);
  let s = seed * 7919 + 17;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  return { root: p.root, wires: p.wires.map((w) => (leaf.has(w.from) && leaf.has(w.to) && rnd() < 0.6 ? { ...w, tips: { from: TIP, to: TIP } } : w)) };
}

/** Labels that overlap a tip's box — whose label, and whose tip. */
export function onTips(p: Problem, sol: Solution): string[] {
  const out: string[] = [];
  const tips: { wire: string; r: { x: number; y: number; w: number; h: number } }[] = [];
  for (const w of p.wires) {
    const pts = sol.wires.get(w.id)?.points;
    if (!w.tips || !pts || pts.length < 2) continue;
    for (const [a, b] of [[pts[0], pts[1]], [pts[pts.length - 1], pts[pts.length - 2]]]) {
      const dx = Math.sign(b.x - a.x), dy = Math.sign(b.y - a.y);
      tips.push({ wire: w.id, r: dx ? { x: Math.min(a.x, a.x + dx * TIP), y: a.y - HALF, w: TIP, h: 2 * HALF } : { x: a.x - HALF, y: Math.min(a.y, a.y + dy * TIP), w: 2 * HALF, h: TIP } });
    }
  }
  for (const [id, { label }] of sol.wires) {
    if (!label) continue;
    for (const t of tips) if (label.x < t.r.x + t.r.w && label.x + label.w > t.r.x && label.y < t.r.y + t.r.h && label.y + label.h > t.r.y) out.push(`label of ${id} stands on a tip of ${t.wire}`);
  }
  return out;
}
