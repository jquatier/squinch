// Where on a box's top and bottom walls each of its wires stands (§5.4).
//
// The order along a wall is the one that keeps the wall's wires from
// crossing each other: going round the channel the wall faces, the far ends
// come in one rotation, and the ports stand in the same rotation. The ports
// start evenly spread about the wall's middle (a wall's only wire in the
// middle), and then each slides to meet its wire if the wire could then run
// straight — never past a neighbour, never within 8 px of a corner.
//
// A container's wall is not placed here: its ports are where its inside put
// them (lay.ts). Only a wire that *ends* at a container is, like a leaf's.

import { ring, sideMode, sub } from "./count.js";
import type { Cell, End, Item, Piece } from "./plan.js";
import { wallIn } from "./plan.js";
import { GRID, LANE, faceAcross } from "./place.js";

const CORNER = 8;
export const portId = (it: Item, wall: "N" | "S", key: string) => `${it.uid}|${wall}|${key}`;

interface Port { key: string; turn: number; x: number }
interface WallPorts { it: Item; wall: "N" | "S"; ports: Port[]; lo: number; hi: number; gap: number }

/** Does this end get a port here — a plain box, or a container the wire stops at? */
export const stops = (end: End, key: string): boolean => {
  const it = end.item;
  return it.kind === "box" && !(it.inner && it.inner.portAt.has(`${wallIn(it.inner, it.cell, end.wall)}|${key}`));
};

/** Where a piece's end meets its item, along the row. */
export function endAt(ports: Map<string, number>, end: End, key: string): number {
  const it = end.item;
  if (it.kind !== "box") return it.x;
  if (end.wall === "N" || end.wall === "S") {
    const x = ports.get(portId(it, end.wall, key));
    if (x !== undefined) return x;
  }
  const at = it.inner?.portAt.get(`${wallIn(it.inner, it.cell, end.wall)}|${key}`);
  return it.x - it.w / 2 + (at ?? it.w / 2);
}

export function assignPorts(cell: Cell): Map<string, number> {
  const ports = new Map<string, number>();
  const walls = new Map<string, WallPorts>();
  /** `turn`: how far round the channel (from this box, the way that reads left to right along the wall) the far end is. */
  const want = (end: End, key: string, turn: number) => {
    if (!stops(end, key)) return;
    const wall = end.wall as "N" | "S", id = `${end.item.uid}|${wall}`;
    const w = walls.get(id) ?? walls.set(id, { it: end.item, wall, ports: [], lo: 0, hi: 0, gap: LANE }).get(id)!;
    if (!w.ports.some((p) => p.key === key)) w.ports.push({ key, turn, x: 0 });
  };
  for (let ch = 0; ch + 1 < cell.rows.length; ch++) {
    const r = ring(cell, ch), size = cell.rows[ch].items.length + cell.rows[ch + 1].items.length + 2;
    const around = (from: number, to: number) => (((to - from) % size) + size) % size;
    const top = (e: End, key: string) => r.top(e.item.pos + sub(e, key)), bot = (e: End, key: string) => r.bottom(e.item.pos + sub(e, key));
    for (const s of cell.segs[ch]) {
      // along a bottom wall, left to right is anticlockwise; along a top wall, clockwise
      want(s.upper, s.key, around(bot(s.lower, s.key), top(s.upper, s.key)));
      want(s.lower, s.key, around(bot(s.lower, s.key), top(s.upper, s.key)));
    }
    for (const t of cell.turns)
      if (t.row === ch) {
        want(t.a, t.key, around(top(t.b, t.key), top(t.a, t.key)));
        want(t.b, t.key, around(top(t.a, t.key), top(t.b, t.key)));
      }
    for (const s of cell.sides) {
      if (s.from.inner) continue;
      const mode = sideMode(s);
      // a wire off to a side wall leaves from the end of the wall nearest it
      if (mode === "under" && s.row === ch) want({ item: s.from, wall: "S" }, s.key, s.wall === "E" ? size : s.from.pos + 0.9);
      if (mode === "over" && s.row === ch + 1) want({ item: s.from, wall: "N" }, s.key, s.wall === "E" ? size : s.from.pos + 0.9);
    }
  }

  for (const w of walls.values()) {
    const { it, wall, ports: list } = w;
    list.sort((p, q) => p.turn - q.turn);
    const face = faceAcross(it);
    const left = it.x - it.w / 2, n = list.length;
    w.lo = left + CORNER;
    w.hi = face !== undefined && face < it.w ? left + face - CORNER : left + it.w - CORNER;
    const mid = Math.round((w.lo + w.hi) / 2 / GRID) * GRID;
    // evenly spread: the wall in n + 1 parts, on the grid — closer only if the wall is too short
    const pitch = n > 1 ? Math.min(Math.max(LANE, Math.floor((w.hi - w.lo) / (n + 1) / GRID) * GRID), Math.floor((w.hi - w.lo) / (n - 1))) : 0;
    w.gap = n > 1 ? Math.min(LANE, pitch) : LANE;
    list.forEach((p, i) => {
      p.x = Math.round(mid + (i - (n - 1) / 2) * pitch);
      ports.set(portId(it, wall, p.key), p.x);
    });
  }

  // slide: a port goes to meet its wire if that makes the wire straight —
  // never changing places with a neighbour, never into a corner
  /** Move a port towards `to` as far as its wall and neighbours let it; where it ends up. */
  const slide = (it: Item, wall: "N" | "S", key: string, to: number): number | undefined => {
    const w = walls.get(`${it.uid}|${wall}`), i = w?.ports.findIndex((p) => p.key === key) ?? -1;
    if (!w || i < 0) return undefined;
    const list = w.ports;
    const lo = i ? list[i - 1].x + w.gap : w.lo, hi = i + 1 < list.length ? list[i + 1].x - w.gap : w.hi;
    return Math.max(Math.min(lo, list[i].x), Math.min(Math.max(hi, list[i].x), to));
  };
  const set = (it: Item, wall: "N" | "S", key: string, x: number) => {
    walls.get(`${it.uid}|${wall}`)!.ports.find((p) => p.key === key)!.x = x;
    ports.set(portId(it, wall, key), x);
  };
  const straighten = (p: Piece) => {
    if (p.kind !== "seg") return;
    const a = endAt(ports, p.upper, p.key), b = endAt(ports, p.lower, p.key);
    if (a === b) return;
    // each end goes as far as it may; they move only if between them they meet
    const b2 = slide(p.lower.item, "N", p.key, a) ?? b;
    const a2 = slide(p.upper.item, "S", p.key, b2) ?? a;
    if (a2 !== b2) return;
    if (b2 !== b) set(p.lower.item, "N", p.key, b2);
    if (a2 !== a) set(p.upper.item, "S", p.key, a2);
  };
  for (const segs of cell.segs) for (const s of segs) straighten(s);
  for (let ch = cell.segs.length - 1; ch >= 0; ch--) for (const s of cell.segs[ch]) straighten(s);
  return ports;
}
