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
import type { Cell, End, Item, Piece, Seg } from "./plan.js";
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
    const first = Math.max(w.lo, Math.min(w.hi - (n - 1) * pitch, Math.round(mid - ((n - 1) / 2) * pitch)));
    list.forEach((p, i) => {
      p.x = first + i * pitch;
      ports.set(portId(it, wall, p.key), p.x);
    });
  }

  // slide: a port goes to meet its wire if that makes the wire straight —
  // never changing places with a neighbour, never into a corner. A
  // neighbour whose own wire bends anyway gives way; one whose wire runs
  // straight does not.
  const wireOf = new Map<string, Seg>();
  for (const segs of cell.segs) for (const s of segs) {
    if (stops(s.upper, s.key)) wireOf.set(portId(s.upper.item, "S", s.key), s);
    if (stops(s.lower, s.key)) wireOf.set(portId(s.lower.item, "N", s.key), s);
  }
  const bent = (w: WallPorts, p: Port): boolean => {
    const s = wireOf.get(portId(w.it, w.wall, p.key));
    return !s || endAt(ports, s.upper, s.key) !== endAt(ports, s.lower, s.key);
  };
  /** How far towards `to` a port can go; where it ends up. */
  const slide = (it: Item, wall: "N" | "S", key: string, to: number): number | undefined => {
    const w = walls.get(`${it.uid}|${wall}`), i = w?.ports.findIndex((p) => p.key === key) ?? -1;
    if (!w || i < 0) return undefined;
    const list = w.ports, dir = to > list[i].x ? 1 : -1;
    let limit = dir > 0 ? w.hi : w.lo, k = i;
    for (let j = i + dir; j >= 0 && j < list.length; j += dir) {
      if (!bent(w, list[j])) { limit = list[j].x - dir * w.gap * (Math.abs(j - i)); k = -1; break; }
      k = j;
    }
    if (k >= 0) limit -= dir * w.gap * Math.abs(k - i);
    return dir > 0 ? Math.max(list[i].x, Math.min(limit, to)) : Math.min(list[i].x, Math.max(limit, to));
  };
  const set = (it: Item, wall: "N" | "S", key: string, x: number) => {
    const w = walls.get(`${it.uid}|${wall}`)!, list = w.ports, i = list.findIndex((p) => p.key === key);
    const put = (p: Port, at: number) => { p.x = at; ports.set(portId(it, wall, p.key), at); };
    put(list[i], x);
    for (let j = i + 1; j < list.length && list[j].x < list[j - 1].x + w.gap; j++) put(list[j], list[j - 1].x + w.gap);
    for (let j = i - 1; j >= 0 && list[j].x > list[j + 1].x - w.gap; j--) put(list[j], list[j + 1].x - w.gap);
  };
  const straighten = (p: Piece) => {
    if (p.kind !== "seg") return;
    const a = endAt(ports, p.upper, p.key), b = endAt(ports, p.lower, p.key);
    if (a === b) return;
    // each end goes as far as it may; they move only if between them they meet
    const b2 = slide(p.lower.item, "N", p.key, a) ?? b;
    const a2 = slide(p.upper.item, "S", p.key, b2) ?? a;
    if (a2 === b2) {
      if (b2 !== b) set(p.lower.item, "N", p.key, b2);
      if (a2 !== a) set(p.upper.item, "S", p.key, a2);
      return;
    }
    // §4: nothing almost-right. If they cannot meet and would be left a
    // step apart, one stands back so the jog between them is a clear one.
    if (Math.abs(a - b) >= LANE) return;
    const away = a < b ? -1 : 1; // which way the upper end steps back
    const a3 = slide(p.upper.item, "S", p.key, b + away * LANE);
    if (a3 !== undefined && Math.abs(a3 - b) >= LANE) return set(p.upper.item, "S", p.key, a3);
    const b3 = slide(p.lower.item, "N", p.key, a - away * LANE);
    if (b3 !== undefined && Math.abs(b3 - a) >= LANE) set(p.lower.item, "N", p.key, b3);
  };
  for (const segs of cell.segs) for (const s of segs) straighten(s);
  for (let ch = cell.segs.length - 1; ch >= 0; ch--) for (const s of cell.segs[ch]) straighten(s);
  return ports;
}
