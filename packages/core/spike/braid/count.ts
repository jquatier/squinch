// How many crossings will be drawn — counted, not estimated (§5.2).
//
// Between two consecutive rows of a cell lies a channel: a strip with the
// upper row's items along its top, the lower row's along its bottom, and the
// cell's side walls at its ends. Every piece routed through the channel
// joins two points on that boundary, and two pieces cross exactly when their
// ends alternate going round it. That one rule covers a wire between two
// ranks, a wire going round under a row, and a wire leaving sideways through
// a wall; nothing is special-cased.
//
// Where a point stands on the boundary is read off the rows: an item's place
// in its row, and — for a wire that enters a container — the place of its
// port on that container's wall, asked of the container each time. That is
// what joins the inside and the outside of a wall into one count: move a
// port and both sides see it.
//
// Wires that share a plain box's wall never cross each other (their ports
// are put in the order that prevents it — ports.ts), so they share one
// point, and only strict alternation counts.

import { wallIn, type Cell, type End, type Plan, type Side, type Wall } from "./plan.js";

/** How a wire to a side wall gets there: straight out if nothing stands
 *  between its box and the wall; otherwise along whichever channel — over
 *  the row or under it — fewer wires come down into on that stretch (§5.3). */
export function sideMode(p: Side): "direct" | "over" | "under" {
  const items = p.cell.rows[p.row].items, i = p.from.pos;
  let over = 0, under = 0, any = false;
  for (let k = p.wall === "E" ? i + 1 : 0; k < (p.wall === "E" ? items.length : i); k++) { over += items[k].above; under += items[k].below; any = true; }
  return !any ? "direct" : over < under ? "over" : "under";
}

/** The threads that leave through a side wall of `cell`, from its top to its
 *  bottom. Nothing here is a choice: within a channel the box nearest the
 *  wall turns first, which is the one order in which none of them cross. */
export function sideOrder(cell: Cell, wall: "E" | "W"): string[] {
  const out: string[] = [];
  const sides = cell.sides.filter((s) => s.wall === wall).map((s) => ({ s, mode: sideMode(s) }));
  const near = wall === "E" ? -1 : 1; // sort so the box nearest the wall comes first
  for (let k = 0; k < cell.rows.length; k++) {
    for (const { s, mode } of sides) if (mode === "direct" && s.row === k) out.push(s.key);
    const under = sides.filter((x) => x.mode === "under" && x.s.row === k).sort((p, q) => near * (p.s.from.pos - q.s.from.pos));
    const over = sides.filter((x) => x.mode === "over" && x.s.row === k + 1).sort((p, q) => -near * (p.s.from.pos - q.s.from.pos));
    for (const x of [...under, ...over]) out.push(x.s.key);
  }
  return out;
}

/** Where on a box's wall a thread's wire stands, as a fraction of the wall:
 *  for a container, the place of its port; for a plain box, the middle. */
export function sub(end: End, key: string): number {
  const inner = end.item.inner;
  if (!inner) return 0.5;
  const wall = wallIn(inner, end.item.cell, end.wall);
  if (wall === "N" || wall === "S") {
    const row = wall === "N" ? 0 : inner.rows.length - 1;
    const port = inner.free.get(`${row}|${key}`);
    return port ? (port.pos + 1) / (inner.rows[row].items.length + 1) : 0.5;
  }
  const order = sideOrder(inner, wall), i = order.indexOf(key);
  return i < 0 ? 0.5 : (i + 1) / (order.length + 1);
}

export interface Chord { lo: number; hi: number; key: string }
const chord = (a: number, b: number, key: string): Chord => (a < b ? { lo: a, hi: b, key } : { lo: b, hi: a, key });

/** A channel's boundary, as one number going round it clockwise. */
export function ring(cell: Cell, ch: number) {
  const nTop = cell.rows[ch].items.length, nBot = cell.rows[ch + 1].items.length;
  return {
    top: (pos: number) => pos,
    east: (f: number) => nTop + f,
    bottom: (pos: number) => nTop + 1 + nBot - pos,
    west: (f: number) => nTop + 1 + nBot + f,
  };
}

/** Every piece routed through channel `ch` of `cell` (between rows `ch` and
 *  `ch + 1`), but for those of thread `skip`. */
export function chordsIn(cell: Cell, ch: number, skip?: string): Chord[] {
  const r = ring(cell, ch), out: Chord[] = [];
  for (const s of cell.segs[ch])
    if (s.key !== skip) out.push(chord(r.top(s.upper.item.pos + sub(s.upper, s.key)), r.bottom(s.lower.item.pos + sub(s.lower, s.key)), s.key));
  for (const t of cell.turns)
    if (t.row === ch && t.key !== skip) out.push(chord(r.top(t.a.item.pos + sub(t.a, t.key)), r.top(t.b.item.pos + sub(t.b, t.key)), t.key));
  if (cell.sides.length)
    for (const wall of ["E", "W"] as const) {
      const here = cell.sides.filter((s) => s.wall === wall).map((s) => ({ s, mode: sideMode(s) }))
        .filter((x) => (x.mode === "under" && x.s.row === ch) || (x.mode === "over" && x.s.row === ch + 1));
      if (!here.length) continue;
      const near = wall === "E" ? -1 : 1;
      const order = [
        ...here.filter((x) => x.mode === "under").sort((p, q) => near * (p.s.from.pos - q.s.from.pos)),
        ...here.filter((x) => x.mode === "over").sort((p, q) => -near * (p.s.from.pos - q.s.from.pos)),
      ];
      order.forEach(({ s, mode }, i) => {
        if (s.key === skip) return;
        // a plain box lets the wire out of its top or bottom; a container
        // lets it out of its side, and it steps round the corner in the gutter
        const at = s.from.pos + (s.from.inner ? (wall === "E" ? 0.999 : 0.001) : 0.5);
        const f = (i + 1) / (order.length + 1);
        out.push(chord(mode === "under" ? r.top(at) : r.bottom(at), wall === "E" ? r.east(f) : r.west(1 - f), s.key));
      });
    }
  return out;
}

/** Strict alternation: the two cross. Chords of one thread are one net. */
export const cross = (a: Chord, b: Chord): boolean =>
  a.key !== b.key && ((a.lo < b.lo && b.lo < a.hi && a.hi < b.hi) || (b.lo < a.lo && a.lo < b.hi && b.hi < a.hi));

export function crossingsIn(cell: Cell): number {
  let n = 0;
  for (let ch = 0; ch + 1 < cell.rows.length; ch++) {
    const cs = chordsIn(cell, ch);
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) if (cross(cs[i], cs[j])) n++;
  }
  // wires straight across one gutter cross if the two walls order them differently
  for (let i = 0; i < cell.glues.length; i++)
    for (let j = i + 1; j < cell.glues.length; j++) {
      const p = cell.glues[i], q = cell.glues[j];
      if (p.a.item !== q.a.item || p.b.item !== q.b.item) continue;
      if ((sub(p.a, p.key) - sub(q.a, q.key)) * (sub(p.b, p.key) - sub(q.b, q.key)) < 0) n++;
    }
  return n;
}

export const crossings = (plan: Plan): number => plan.cells.reduce((n, c) => n + crossingsIn(c), 0);
export type { Wall };
