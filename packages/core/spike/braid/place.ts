// Where each item of a cell stands along its row (§5.5).
//
// One question, asked once per cell with everything in view: given the order
// of every row, how far apart neighbours must stand, and what each wire
// would like, where does everything go? It is put to the simplex as "least
// total sideways run": every wire is a term |x(one end) − x(other end)|,
// weighted by how much that wire should have its way. An L1 measure makes a
// wire that can be straight exactly straight, puts a box with three wires
// below it over the middle one, and — because every distance it is given is
// a multiple of 8 — lands every centre line on one 8-pixel grid.
//
// The rules are the weights and offsets of the terms, all in `pulls`:
//
//   • boxes line up on their centres (a term joins centres; ports go to meet
//     the wires afterwards, in ports.ts);
//   • a box over an even fan stands in the middle of it (the two middle
//     wires are each aimed half a gap to the side, so the middle is the one
//     place that satisfies both);
//   • a dead-end box pulls half as hard, so a stage stays in line with its
//     successor and the side lookup hangs beside it;
//   • a wire running back against the flow barely pulls at all: it follows;
//   • two boxes joined by several wires that lean different ways are pulled
//     middle to middle, once, rather than by each wire to its own port;
//   • row-mates are drawn together by the faintest of pulls, so no gap stays
//     open that nothing is holding open; the cell's walls likewise, so it is
//     as small as its inside allows.

import { sideMode } from "./count.js";
import type { Cell, End, Item, Seg } from "./plan.js";
import { wallIn } from "./plan.js";
import { feasible, solve, type Arc } from "./simplex.js";

export const GRID = 8;
export const LANE = 16; // between two wires side by side
const up8 = (v: number) => Math.ceil(v / GRID) * GRID;

const W = { box: 16, deadEnd: 8, lane: 8, stub: 8, back: 2, together: 1, walls: 1 };

/** A box's bleed lies to its right in a transposed cell (it is below, in the picture). */
const bleedAcross = (it: Item) => (it.cell.flip ? it.node?.box?.bleed ?? 0 : 0);
/** In a transposed cell a `face` limits where along the row's axis a wire may land. */
export const faceAcross = (it: Item): number | undefined => (it.cell.flip ? it.node?.box?.face : undefined);

/** How far along its box's wall (from the box's centre) a wire's end would stand, before ports are placed. */
export function offsetOf(end: End, key: string): number {
  const it = end.item;
  if (it.kind !== "box") return 0;
  if (it.inner) {
    const at = it.inner.portAt.get(`${wallIn(it.inner, it.cell, end.wall)}|${key}`);
    if (at !== undefined) return at - it.w / 2;
  }
  const face = faceAcross(it);
  return face !== undefined && face < it.w ? up8(-it.w / 2 + face / 2) : 0;
}

/** Lanes a container's sideways wires step into beside it, by side. */
export function steps(it: Item, wall: "E" | "W"): number {
  if (!it.inner) return 0;
  return it.cell.sides.filter((s) => s.from === it && s.wall === wall && sideMode(s) !== "direct").length;
}

/** Centre-to-centre distance two neighbours in a row must keep. */
export function apart(a: Item, b: Item): number {
  const cell = a.cell;
  const half = (it: Item) => it.w / 2;
  if (a.kind === "port" && b.kind === "port") return LANE;
  if (a.kind === "lane" && b.kind === "lane") return LANE;
  if (a.kind === "box" && b.kind === "box") {
    let gutter = cell.gap.lane;
    const s = steps(a, "E") + steps(b, "W");
    if (s) gutter = Math.max(gutter, LANE * (s + 1));
    // labels of wires straight across this gutter stand in it, in columns
    let room = 0;
    for (const g of cell.glues) if (g.a.item === a && g.b.item === b && g.label) room += g.label.w + 8;
    if (room) gutter = Math.max(gutter, room + 24);
    return up8(half(a) + bleedAcross(a) + gutter + half(b));
  }
  const side = Math.max(LANE, cell.gap.lane / 2);
  const gapOf = (it: Item) => (it.kind === "box" ? side : it.kind === "label" ? 8 : 0);
  return up8(half(a) + bleedAcross(a) + half(b) + Math.max(gapOf(a) + gapOf(b), a.kind === "label" || b.kind === "label" ? 8 : LANE));
}

interface Term {
  a: Item; b: Item; offA: number; offB: number; weight: number;
  /** How far off its line the wire can stand and still be drawn straight: the
   *  reach of the ports at its ends, when each has its wall to itself. */
  slack: number;
}

/** How far a wire's port can slide along its box's wall to meet it: nothing
 *  on a container (its ports are its inside's) or on a wall it shares. */
function reach(end: End, key: string, wires: number): number {
  const it = end.item;
  if (it.kind !== "box" || wires !== 1 || !stops(end, key) || it.inner) return 0;
  const face = faceAcross(it);
  return Math.max(0, Math.floor(((face !== undefined && face < it.w ? face : it.w) / 2 - 8) / GRID) * GRID);
}
const stops = (end: End, key: string) => !(end.item.inner && end.item.inner.portAt.has(`${wallIn(end.item.inner, end.item.cell, end.wall)}|${key}`));

/** §5.5, as terms: what each wire asks of the two things it joins. */
export function pulls(cell: Cell): Term[] {
  const terms: Term[] = [];
  const deadEnd = (it: Item) => it.kind === "box" && !it.inner && it.above + it.below === 1 && it.keys.size === 1;
  const weightOf = (s: Seg): number => {
    if (s.back) return W.back;
    const u = s.upper.item, l = s.lower.item;
    if (u.kind === "box" && l.kind === "box") return deadEnd(u) || deadEnd(l) ? W.deadEnd : W.box;
    return u.kind === "box" || l.kind === "box" ? W.stub : W.lane;
  };
  for (const segs of cell.segs) {
    // several wires between one pair of boxes: each to its own port if they
    // all lean one way, else middle to middle
    const pairs = new Map<string, Seg[]>();
    for (const s of segs) {
      const id = `${s.upper.item.uid}|${s.lower.item.uid}`;
      (pairs.get(id) ?? pairs.set(id, []).get(id)!).push(s);
    }
    for (const group of pairs.values()) {
      const leans = group.map((s) => offsetOf(s.upper, s.key) - offsetOf(s.lower, s.key));
      const mixed = group.length > 1 && !(leans.every((d) => d > 0) || leans.every((d) => d < 0) || leans.every((d) => d === 0));
      if (mixed) {
        terms.push({ a: group[0].upper.item, b: group[0].lower.item, offA: 0, offB: 0, weight: group.reduce((n, s) => n + weightOf(s), 0), slack: 0 });
        continue;
      }
      for (const s of group)
        terms.push({ a: s.upper.item, b: s.lower.item, offA: offsetOf(s.upper, s.key), offB: offsetOf(s.lower, s.key), weight: weightOf(s), slack: reach(s.upper, s.key, s.upper.item.below) + reach(s.lower, s.key, s.lower.item.above) });
    }
  }
  // An even fan: aim its two middle wires half a gap inward, so the box
  // stands exactly between them rather than anywhere between them.
  const fans = new Map<Item, { up: Term[]; down: Term[] }>();
  for (const t of terms) {
    if (t.a.kind === "box" && !t.a.inner) (fans.get(t.a) ?? fans.set(t.a, { up: [], down: [] }).get(t.a)!).down.push(t);
    if (t.b.kind === "box" && !t.b.inner) (fans.get(t.b) ?? fans.set(t.b, { up: [], down: [] }).get(t.b)!).up.push(t);
  }
  for (const [box, fan] of fans)
    for (const side of [fan.up, fan.down]) {
      const far = (t: Term) => (t.a === box ? t.b : t.a);
      const list = side.filter((t) => t.weight > W.back).sort((p, q) => far(p).pos - far(q).pos);
      if (list.length < 2 || list.length % 2) continue;
      const l = list[list.length / 2 - 1], r = list[list.length / 2];
      if (l.weight !== r.weight || far(r).pos !== far(l).pos + 1 || far(l) === far(r)) continue;
      const half = apart(far(l), far(r)) / 2;
      if (l.a === box) { l.offB += half; r.offB -= half; } else { l.offA += half; r.offA -= half; }
    }
  return terms;
}

/** Give every item of the cell its centre `x`, and the cell its width. */
export function place(cell: Cell): void {
  const rows = cell.rows;
  // ── nodes: the two walls, then the items — aligned boxes share one ─────────
  const L = 0, R = 1;
  let n = 2;
  const nodeOf = new Map<Item, number>();
  const build = (aligned: boolean): { arcs: Arc[]; n: number } => {
    n = 2; nodeOf.clear();
    if (aligned)
      for (const set of cell.aligned) {
        const seen = new Set<number>();
        let node = -1;
        for (const it of set) {
          if (seen.has(it.row) || nodeOf.has(it)) continue;
          seen.add(it.row);
          if (node < 0) node = n++;
          nodeOf.set(it, node);
        }
      }
    for (const row of rows) for (const it of row.items) if (!nodeOf.has(it)) nodeOf.set(it, n++);
    const arcs: Arc[] = [];
    const arc = (tail: number, head: number, min: number, weight: number) => { if (tail !== head) arcs.push({ tail, head, min, weight }); };
    arc(L, R, up8(Math.max(cell.minW, 16)), W.walls);

    // ── neighbours keep their distance; ends keep clear of the walls ─────────
    const titleEdge = cell.title ? up8(cell.title.w + 8) : 0;
    rows.forEach((row, k) => {
      const items = row.items;
      for (let i = 0; i + 1 < items.length; i++) arc(nodeOf.get(items[i])!, nodeOf.get(items[i + 1])!, apart(items[i], items[i + 1]), W.together);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      const margin = (it: Item, pad: number) => up8(it.kind === "box" ? pad + it.w / 2 : it.kind === "label" ? it.w / 2 + 8 : LANE);
      arc(L, nodeOf.get(first)!, margin(first, cell.pad.left), 0);
      arc(nodeOf.get(last)!, R, margin(last, cell.pad.right) + bleedAcross(last), 0);
      // §5.7: a wire that has to turn anyway comes in clear of the title; one
      // that runs straight on into the first box may pass the end of it
      if (k === 0 && titleEdge)
        for (const port of items) {
          const next = port.touch[0]?.lower.item;
          if (next && next.kind !== "box") arc(L, nodeOf.get(port)!, titleEdge, 0);
        }
    });

    // ── column bands: every box of one stands wholly before the next ─────────
    if (cell.bands > 1) {
      const edge = Array.from({ length: cell.bands - 1 }, () => n++);
      for (const it of cell.boxes.values()) {
        if (it.band < 0) continue;
        const half = up8(it.w / 2 + cell.gap.lane / 2);
        if (it.band < cell.bands - 1) arc(nodeOf.get(it)!, edge[it.band], half, 0);
        if (it.band > 0) arc(edge[it.band - 1], nodeOf.get(it)!, half, 0);
      }
    }

    // ── every wire: |x(a) + offA − x(b) − offB|, through a helper below both ──
    for (const t of pulls(cell)) {
      const a = nodeOf.get(t.a)!, b = nodeOf.get(t.b)!;
      if (a === b) continue;
      // A wire whose ports can reach each other is as good as straight. So
      // within their reach it pulls a little less (three quarters: enough
      // that boxes still line up on their centres, and hold their lane
      // against a wire merely passing) and beyond it in full.
      let from = a, off = t.offA, weight = t.weight;
      if (t.slack && t.weight >= 4) {
        const weak = n++, centre = (t.weight * 3) / 4;
        arc(weak, a, -t.offA, centre);
        arc(weak, b, -t.offB, centre);
        from = n++; off = 0; weight = t.weight - centre;
        arc(a, from, t.offA - t.slack, 0);
        arc(from, a, -t.offA - t.slack, 0);
      }
      const helper = n++;
      arc(helper, from, -off, weight);
      arc(helper, b, -t.offB, weight);
    }
    return { arcs, n };
  };

  let g = build(true);
  // aligned sets the order contradicts cannot share a line: drop them rather than draw something illegal
  if (!feasible(g.n, g.arcs)) g = build(false);
  const y = solve(g.n, g.arcs);
  for (const [it, node] of nodeOf) it.x = y[node] - y[L];
  cell.w = y[R] - y[L];
}
