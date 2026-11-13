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

import { sideMode, sub } from "./count.js";
import type { Cell, End, Item, Seg } from "./plan.js";
import { wallIn } from "./plan.js";
import { feasible, solve, type Arc } from "./simplex.js";

declare const process: { env: Record<string, string | undefined> } | undefined;
export const GRID = 8;
export const LANE = 16; // between two wires side by side
const up8 = (v: number) => Math.ceil(v / GRID) * GRID;

const W: Record<string, number> = {
  balance: 12,  // a box and the box its wire reaches: centres in line
  deadEnd: 8,   // …less hard if one of them goes nowhere else
  back: 2,      // …and barely at all for a wire running back against the flow
  fixed: 12,    // a wire between two ports that cannot move: straight
  lane: 8,      // a wire passing a rank: straight
  reach: 4,     // a wire whose ports can slide: within their reach
  middle: 2,    // a wall's only wire: in the wall's middle
  together: 1, walls: 1,
};

if (typeof process !== "undefined" && process.env.BRAID_W) for (const kv of process.env.BRAID_W.split(",")) { const [k, v] = kv.split("="); W[k] = +v; }

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
export function apart(a: Item, b: Item, tight = false): number {
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
    // and each wire that may have to step from one level to another needs a lane of its own to do it in
    const stepping = cell.glues.filter((g) => g.a.item === a && g.b.item === b && (a.inner || b.inner)).length;
    if (stepping > 1) gutter = Math.max(gutter, room + LANE * (stepping + 1) + (room ? 8 : 0));
    return up8(half(a) + bleedAcross(a) + gutter + half(b));
  }
  const side = tight ? LANE : Math.max(LANE, cell.gap.lane / 2);
  const gapOf = (it: Item) => (it.kind === "box" ? side : it.kind === "label" ? 8 : 0);
  return up8(half(a) + bleedAcross(a) + half(b) + Math.max(gapOf(a) + gapOf(b), a.kind === "label" || b.kind === "label" ? 8 : LANE));
}

/** What a wire asks of the two things it joins: |x(a) + offA − x(b) − offB|,
 *  costing nothing while within `slack` (how far each end's port can slide
 *  to meet the other: left and right of where it would stand). */
interface Term {
  a: Item; b: Item; offA: number; offB: number; weight: number;
  slackA?: [left: number, right: number]; slackB?: [left: number, right: number];
}

/** How far a wire's port can slide along its box's wall, left and right of
 *  the wall's middle: up to 8 px from each corner, less a lane for each
 *  port it shares the wall with on that side. Nothing on a container, whose
 *  ports are where its inside put them. */
const spreadOf = new Map<string, number>();
function reach(end: End, key: string): [number, number] | undefined {
  const it = end.item;
  if (it.kind !== "box" || !stops(end, key)) return undefined;
  const mates = (end.wall === "S" ? it.touch.filter((s) => s.upper.item === it) : it.touch.filter((s) => s.lower.item === it))
    .map((s) => ({ key: s.key, far: end.wall === "S" ? s.lower.item.pos + sub(s.lower, s.key) : s.upper.item.pos + sub(s.upper, s.key) }))
    .filter((m, i, all) => all.findIndex((o) => o.key === m.key) === i)
    .sort((p, q) => p.far - q.far);
  const i = mates.findIndex((m) => m.key === key), n = mates.length;
  if (i < 0) return undefined;
  spreadOf.set(`${it.uid}|${end.wall}|${key}`, (i - (n - 1) / 2) * LANE);
  const face = faceAcross(it), wide = face !== undefined && face < it.w ? face : it.w;
  const half = Math.floor((wide / 2 - 8) / GRID) * GRID;
  return [Math.max(0, half - LANE * i), Math.max(0, half - LANE * (n - 1 - i))];
}
const stops = (end: End, key: string) => !(end.item.inner && end.item.inner.portAt.has(`${wallIn(end.item.inner, end.item.cell, end.wall)}|${key}`));

/** §5.5, as terms. Two kinds:
 *   straight  one per seg: its two ends in line, or within reach of the ports;
 *   balance   one per wire, from a plain box to whatever its wire reaches in
 *             this cell (through any lanes between): centres in line. */
export function pulls(cell: Cell): { terms: Term[]; spans: { a: Item; b: Item; min: number }[] } {
  const terms: Term[] = [], spans: { a: Item; b: Item; min: number }[] = [];
  const plain = (it: Item) => it.kind === "box" && !it.inner;
  // a box that goes nowhere else — a wire back against the flow does not count as somewhere
  const deadEnd = (it: Item) => plain(it) && it.touch.filter((s) => !s.back).length === 1 && it.keys.size === new Set(it.touch.map((s) => s.key)).size;

  // ── straight ───────────────────────────────────────────────────────────────
  for (const segs of cell.segs) {
    // several wires between one pair of boxes: each to its own port if they
    // all lean one way, else middle to middle (two containers so joined
    // stand in a column)
    const pairs = new Map<string, Seg[]>();
    for (const s of segs) {
      const id = `${s.upper.item.uid}|${s.lower.item.uid}`;
      (pairs.get(id) ?? pairs.set(id, []).get(id)!).push(s);
    }
    for (const group of pairs.values()) {
      const leans = group.map((s) => offsetOf(s.upper, s.key) - offsetOf(s.lower, s.key));
      const mixed = group.length > 1 && !(leans.every((d) => d > 0) || leans.every((d) => d < 0) || leans.every((d) => d === 0));
      if (mixed) {
        terms.push({ a: group[0].upper.item, b: group[0].lower.item, offA: 0, offB: 0, weight: group.reduce((n, s) => n + (s.back ? W.back : W.fixed), 0) });
        continue;
      }
      for (const s of group) {
        const ra = reach(s.upper, s.key), rb = reach(s.lower, s.key);
        const weight = s.back ? W.back : ra || rb ? (s.upper.item.kind === "box" && s.lower.item.kind === "box" ? W.reach : W.lane) : s.upper.item.kind === "box" && s.lower.item.kind === "box" ? W.fixed : W.lane;
        terms.push({ a: s.upper.item, b: s.lower.item, offA: offsetOf(s.upper, s.key), offB: offsetOf(s.lower, s.key), weight, slackA: ra, slackB: rb });
        // a wall's only wire meets it in the middle, and several stand
        // evenly about it (§5.4): whatever a port leads to that is not a box
        // is drawn, faintly, to where the port would stand
        const even = (e: End) => Math.round((spreadOf.get(`${e.item.uid}|${e.wall}|${s.key}`) ?? 0) / GRID) * GRID;
        if (!s.back && ra && !plain(s.lower.item)) terms.push({ a: s.upper.item, b: s.lower.item, offA: offsetOf(s.upper, s.key) + even(s.upper), offB: offsetOf(s.lower, s.key), weight: W.middle });
        if (!s.back && rb && !plain(s.upper.item)) terms.push({ a: s.upper.item, b: s.lower.item, offA: offsetOf(s.upper, s.key), offB: offsetOf(s.lower, s.key) + even(s.lower), weight: W.middle });
      }
    }
  }

  // ── balance ────────────────────────────────────────────────────────────────
  // every wire from where it enters the cell's rows (a box, or a port on the
  // north wall) down to where it leaves them, through the lanes between
  const balance: Term[] = [];
  const walk = (s: Seg): End[] => {
    const it = s.lower.item;
    if (it.kind === "box" || it.kind === "port") return [s.lower];
    return it.touch.filter((n) => n.upper.item === it && (n.key === s.key || it.key !== s.key)).flatMap(walk);
  };
  for (const segs of cell.segs)
    for (const s of segs) {
      const from = s.upper.item;
      if (from.kind !== "box" && from.kind !== "port") continue;
      for (const end of walk(s)) {
        const to = end.item;
        // only a box is stood over: a port on the wall follows its wire, it does not lead it
        if (!plain(from) && !plain(to)) continue;
        if (from.kind === "port" || to.kind === "port") continue;
        if (from.row + 1 === to.row && cell.segs[from.row].filter((o) => o.upper.item === from && o.lower.item === to).length > 1) continue; // already middle to middle
        balance.push({
          a: from, b: to, offA: offsetOf(s.upper, s.key), offB: offsetOf(end, s.key),
          weight: s.back ? W.back : deadEnd(from) || deadEnd(to) ? W.deadEnd : W.balance,
        });
      }
    }
  // An even fan: aim its two middle wires half a gap inward, so the box
  // stands exactly between them rather than anywhere between them.
  const fans = new Map<Item, { up: Term[]; down: Term[] }>();
  for (const t of balance) {
    if (plain(t.a)) (fans.get(t.a) ?? fans.set(t.a, { up: [], down: [] }).get(t.a)!).down.push(t);
    if (plain(t.b)) (fans.get(t.b) ?? fans.set(t.b, { up: [], down: [] }).get(t.b)!).up.push(t);
  }
  for (const [box, fan] of fans)
    for (const side of [fan.up, fan.down]) {
      const far = (t: Term) => (t.a === box ? t.b : t.a);
      const list = side.filter((t) => t.weight > W.back).sort((p, q) => far(p).row - far(q).row || far(p).pos - far(q).pos);
      if (list.length < 2 || list.length % 2) continue;
      const l = list[list.length / 2 - 1], r = list[list.length / 2];
      if (l.weight !== r.weight || far(r).row !== far(l).row || far(r).pos !== far(l).pos + 1) continue;
      // (the middle of two grid lines is on the grid only if they are an even
      // number of steps apart: the pair stands a step wider where it must)
      const gap = Math.ceil(apart(far(l), far(r)) / (2 * GRID)) * 2 * GRID, half = gap / 2;
      spans.push({ a: far(l), b: far(r), min: gap });
      if (l.a === box) { l.offB += half; r.offB -= half; } else { l.offA += half; r.offA -= half; }
    }
  return { terms: [...terms, ...balance], spans };
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
      // a box keeps the cell's padding; a wire passing or a label may stand in it
      const margin = (it: Item, pad: number) => up8(it.kind === "box" ? pad + it.w / 2 : it.kind === "label" ? it.w / 2 + 8 : LANE);
      for (const it of items) {
        if (it.kind !== "box" && it !== first && it !== last) continue;
        if (it.kind === "box" || it === first) arc(L, nodeOf.get(it)!, margin(it, cell.pad.left), 0);
        if (it.kind === "box" || it === last) arc(nodeOf.get(it)!, R, margin(it, cell.pad.right) + bleedAcross(it), 0);
      }
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
    const { terms, spans } = pulls(cell);
    for (const sp of spans) arc(nodeOf.get(sp.a)!, nodeOf.get(sp.b)!, sp.min, 0);
    for (const t of terms) {
      const a = nodeOf.get(t.a)!, b = nodeOf.get(t.b)!;
      if (a === b) continue;
      // a port that can slide is a point of its own, held within reach of where it would stand
      let from = a, offF = t.offA, to = b, offT = t.offB;
      if (t.slackA && (t.slackA[0] || t.slackA[1])) {
        from = n++; offF = 0;
        arc(a, from, t.offA - t.slackA[0], 0);
        arc(from, a, -t.offA - t.slackA[1], 0);
      }
      if (t.slackB && (t.slackB[0] || t.slackB[1])) {
        to = n++; offT = 0;
        arc(b, to, t.offB - t.slackB[0], 0);
        arc(to, b, -t.offB - t.slackB[1], 0);
      }
      const helper = n++;
      arc(helper, from, -offF, t.weight);
      arc(helper, to, -offT, t.weight);
    }
    return { arcs, n };
  };

  let g = build(true);
  // aligned sets the order contradicts cannot share a line: drop them rather than draw something illegal
  if (!feasible(g.n, g.arcs)) g = build(false);
  const y = solve(g.n, g.arcs);
  for (const [it, node] of nodeOf) it.x = y[node] - y[L];
  cell.w = y[R] - y[L];
  // §5.5: a rank with no wire up or down is centred on its neighbours —
  // nothing pulled it anywhere, so it was left against a wall
  const banded = new Set(cell.aligned.flat());
  for (const row of rows) {
    const items = row.items;
    if (row.kind !== "rank" || !items.length || items.some((it) => it.touch.length || it.band >= 0 || banded.has(it))) continue;
    const first = items[0], last = items[items.length - 1];
    const room = (cell.w - cell.pad.right - (last.x + last.w / 2)) - (first.x - first.w / 2 - cell.pad.left);
    const shift = Math.trunc(room / 2 / GRID) * GRID;
    for (const it of items) it.x += shift;
  }
  unkink(cell);
}

/** Fewer turns. The simplex measures sideways run, and a wire that must
 *  travel sideways anyway costs it the same in one jog as in two — so a lane
 *  between two bends is left wherever a neighbour stopped it. Here each such
 *  lane is tried in line with the stretch above it and the stretch below
 *  (pushing other lanes along if they are in the way, never a box), and
 *  moves if the cell then has fewer bends — a jog shorter than a lane's
 *  width counting for more than a clear one (§4: nothing almost-right). A
 *  wire passing a rank stands half a gutter off the box it passes, a step
 *  more than it strictly needs, and that step is what these moves spend. */
function unkink(cell: Cell): void {
  const loose = (it: Item) => it.kind !== "box";
  // where an end may stand: a lane, label or container port where it is; a
  // plain box's port anywhere its wall lets it slide
  const span = (e: End, key: string): [number, number] => {
    if (e.item.kind !== "box") return [e.item.x, e.item.x];
    const at = e.item.x + offsetOf(e, key), r = reach(e, key);
    return r ? [at - r[0], at + r[1]] : [at, at];
  };
  const jog = (s: Seg) => {
    const a = span(s.upper, s.key), b = span(s.lower, s.key), d = Math.max(a[0] - b[1], b[0] - a[1]);
    return d <= 0 ? 0 : d < LANE ? 7 : 2;
  };
  /** The nearest place to `x` from which a seg's other end can be met straight. */
  const meet = (e: End, key: string, x: number) => { const [lo, hi] = span(e, key); return Math.max(lo, Math.min(hi, x)); };
  /** The lanes that would have to move for `it` to stand at `x`: itself, and
   *  any lane it would crowd, pushed along — or nothing, if a box, a label or
   *  a wall is in the way. */
  const shove = (it: Item, x: number): [Item, number][] | undefined => {
    const items = cell.rows[it.row].items, dir = x > it.x ? 1 : -1, out: [Item, number][] = [];
    let at = x;
    for (let k = it.pos; ; k += dir) {
      const cur = items[k];
      if (cur.row === 0 && cell.title && cur.touch[0]?.lower.item.kind !== "box" && at < cell.title.w + 8) return undefined;
      out.push([cur, at]);
      const next = items[k + dir];
      if (!next) return at >= LANE && at <= cell.w - LANE ? out : undefined;
      const need = dir > 0 ? apart(cur, next, true) : apart(next, cur, true);
      if ((next.x - at) * dir >= need) return out;
      if (!loose(next)) return undefined;
      at += dir * need;
    }
  };
  for (let pass = 0; pass < 6; pass++) {
    let moved = false;
    for (const segs of cell.segs)
      for (const s of segs) {
        if (!jog(s)) continue;
        for (const [it, to] of [[s.lower.item, meet(s.upper, s.key, s.lower.item.x)], [s.upper.item, meet(s.lower, s.key, s.upper.item.x)]] as const) {
          const moves = loose(it) && to !== it.x ? shove(it, to) : undefined;
          if (!moves) continue;
          const touched = [...new Set(moves.flatMap(([m]) => m.touch))];
          const before = touched.reduce((n, t) => n + jog(t), 0), was = moves.map(([m]) => m.x);
          for (const [m, x] of moves) m.x = x;
          if (touched.reduce((n, t) => n + jog(t), 0) < before) { moved = true; break; }
          moves.forEach(([m], i) => { m.x = was[i]; });
        }
      }
    if (!moved) break;
  }
}
