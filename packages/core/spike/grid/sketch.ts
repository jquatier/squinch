// Sketch: order every container's boxes with the whole picture in view.
//
// Each container is laid out on its own, innermost first, and can only guess
// where the wires through its walls end up. So before any of that, the
// picture is sketched whole — every box at its size, rows centred, no
// routing — with each wire drawn as one straight stroke between the middles
// of its two ends. Row-mates the author did not place then trade places
// wherever that uncrosses strokes. Crude, but it sees what no container can:
// that swapping two boxes here uncrosses a wire that ends three containers
// away. The order it finds is only where each container's own ordering
// starts from; declaration order stands wherever a swap gains nothing.

import type { Group, Pt, Wire } from "./types.js";

const ROOT = "";
const ROUNDS = 6;

/** container → its boxes, reordered within each rank. */
export function sketchOrder(root: Group, rank: ReadonlyMap<string, number>, wires: readonly Wire[]): Map<string, string[]> {
  const groups = new Map<string, Group>([[ROOT, root]]);
  const leaf = new Map<string, { w: number; h: number }>();
  const index = (g: Group) => {
    for (const b of g.boxes) {
      if (b.group) { groups.set(b.id, b.group); index(b.group); } else leaf.set(b.id, { w: b.w, h: b.h });
    }
  };
  index(root);
  const rows = new Map([...groups].map(([id, g]) => {
    const rs: string[][] = [];
    for (const b of g.boxes) (rs[rank.get(b.id)!] ??= []).push(b.id);
    return [id, rs.filter(Boolean)] as const;
  }));
  const held = new Set([...groups.values()].flatMap((g) => [...(g.held ?? []), ...(g.aligned ?? []).flat(), ...(g.columns ?? []).flat()]));

  // Sizes do not depend on the order within a row, so they are worked out once.
  const size = new Map<string, { l: number; f: number }>(); // along the lane and the flow of the container that holds it
  const extent = (id: string, down: boolean): { l: number; f: number } => {
    const own = leaf.get(id);
    if (own) return down ? { l: own.w, f: own.h } : { l: own.h, f: own.w };
    const g = groups.get(id)!, mine = g.dir === "down";
    let lane = 0, flow = 0;
    for (const row of rows.get(id)!) {
      const kids = row.map((k) => extent(k, mine));
      row.forEach((k, i) => size.set(k, kids[i]));
      lane = Math.max(lane, kids.reduce((a, k) => a + k.l, 0) + g.gap.lane * (row.length - 1));
      flow += Math.max(...kids.map((k) => k.f)) + g.gap.rank;
    }
    const w = (mine ? lane : flow) + g.pad.left + g.pad.right, h = (mine ? flow : lane) + g.pad.top + g.pad.bottom;
    return down ? { l: w, f: h } : { l: h, f: w };
  };
  const whole = extent(ROOT, true);

  /** The middle of every box, with the rows as they now stand. */
  const middles = (): Map<string, Pt> => {
    const at = new Map<string, Pt>();
    const place = (id: string, x: number, y: number, w: number, h: number) => {
      at.set(id, { x: x + w / 2, y: y + h / 2 });
      const g = groups.get(id);
      if (!g) return;
      const down = g.dir === "down";
      const inner = down ? w - g.pad.left - g.pad.right : h - g.pad.top - g.pad.bottom;
      let f = down ? y + g.pad.top : x + g.pad.left;
      for (const row of rows.get(id)!) {
        const kids = row.map((k) => size.get(k)!);
        let l = (down ? x + g.pad.left : y + g.pad.top) + (inner - kids.reduce((a, k) => a + k.l, 0) - g.gap.lane * (row.length - 1)) / 2;
        row.forEach((k, i) => {
          if (down) place(k, l, f, kids[i].l, kids[i].f); else place(k, f, l, kids[i].f, kids[i].l);
          l += kids[i].l + g.gap.lane;
        });
        f += Math.max(...kids.map((k) => k.f)) + g.gap.rank;
      }
    };
    place(ROOT, 0, 0, whole.l, whole.f);
    return at;
  };

  const strokes = wires.filter((w) => w.from !== w.to && (leaf.has(w.from) || groups.has(w.from)) && (leaf.has(w.to) || groups.has(w.to)));
  const turn = (a: Pt, b: Pt, c: Pt) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  /** How many pairs of strokes cross. Two that share an end never do. */
  const crossings = (): number => {
    const at = middles();
    let n = 0;
    for (let i = 0; i < strokes.length; i++)
      for (let j = i + 1; j < strokes.length; j++) {
        const p = strokes[i], q = strokes[j];
        if (p.from === q.from || p.from === q.to || p.to === q.from || p.to === q.to) continue;
        const a = at.get(p.from)!, b = at.get(p.to)!, c = at.get(q.from)!, d = at.get(q.to)!;
        if (turn(a, b, c) * turn(a, b, d) < 0 && turn(c, d, a) * turn(c, d, b) < 0) n++;
      }
    return n;
  };

  let best = crossings();
  for (let round = 0, improved = true; improved && best > 0 && round < ROUNDS; round++) {
    improved = false;
    for (const rs of rows.values())
      for (const row of rs)
        for (let i = 0; i + 1 < row.length; i++) {
          if (held.has(row[i]) || held.has(row[i + 1])) continue;
          [row[i], row[i + 1]] = [row[i + 1], row[i]];
          const n = crossings();
          if (n < best) { best = n; improved = true; } else [row[i], row[i + 1]] = [row[i + 1], row[i]];
        }
  }
  return new Map([...rows].map(([id, rs]) => [id, rs.flat()]));
}
