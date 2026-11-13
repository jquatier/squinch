// A guess at where things will stand, from sizes alone.
//
// The order is searched before anything has a position, yet "among orders
// that cross the same, prefer the straighter" (§5.2) needs distances — and
// they must be judged with real box sizes, because rows of different lengths
// make positions-as-fractions lie. So each row is packed at its real widths
// and centred on its cell, and a wire's sideways run is measured between the
// centres that gives. It is a tie-break only: it never outvotes a crossing.

import { wallIn, type Cell, type End, type Item, type Plan, type Seg } from "./plan.js";

const BEND = 1000;

/** Pack every row of every cell; give each item its guessed centre. */
export function settle(plan: Plan): void {
  for (const cell of plan.cells) settleCell(cell);
}

export function settleCell(cell: Cell): void {
  for (let k = 1; k + 1 < cell.rows.length; k++) {
    const items = cell.rows[k].items;
    let x = 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (i) x += it.kind === "box" && items[i - 1].kind === "box" ? cell.gap.lane : 16;
      it.ex = x + it.ew / 2;
      x += it.ew;
    }
    for (const it of items) it.ex -= x / 2;
  }
  // a port stands over (or under) whatever it leads to inside — but in a
  // titled cell a wire that has to turn comes in clear of the title (§5.7)
  for (const row of [cell.rows[0], cell.rows[cell.rows.length - 1]])
    for (const port of row.items) {
      const s = port.touch[0];
      const next = s.upper.item === port ? s.lower.item : s.upper.item;
      port.ex = next.ex;
      if (row === cell.rows[0] && cell.title && next.kind !== "box") port.ex = Math.max(port.ex, cell.title.w + 8 - cell.ew / 2);
    }
}

/** Where a piece's end stands along its row, from the middle of its cell. */
export function endX(end: End, key: string): number {
  const it = end.item, inner = it.inner;
  if (!inner) return it.ex;
  const wall = wallIn(inner, it.cell, end.wall);
  if (wall === "N" || wall === "S") {
    const port = inner.free.get(`${wall === "N" ? 0 : inner.rows.length - 1}|${key}`);
    if (port) return it.ex + port.ex;
  }
  return it.ex;
}

/** What one seg costs in bends: nothing if its ends are in line, else a bend and its run. */
export const lean = (d: number): number => (Math.abs(d) > 4 ? BEND + Math.abs(d) : Math.abs(d));
export const segLean = (s: Seg): number => lean(endX(s.upper, s.key) - endX(s.lower, s.key));

/** The guessed centre of a gap between two items of a row (gap `g` is before item `g`). */
export function gapX(items: readonly Item[], g: number): number {
  if (!items.length) return 0;
  if (g <= 0) return items[0].ex - items[0].ew / 2 - 16;
  if (g >= items.length) { const l = items[items.length - 1]; return l.ex + l.ew / 2 + 16; }
  return (items[g - 1].ex + items[g - 1].ew / 2 + items[g].ex - items[g].ew / 2) / 2;
}

export function bends(plan: Plan): number {
  let n = 0;
  for (const cell of plan.cells) for (const segs of cell.segs) for (const s of segs) n += segLean(s);
  return n;
}
