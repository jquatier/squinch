// Rows: what "room" means along a rank. Every stage that moves a slot asks
// here how close two neighbours may stand, and whether a move fits.

import type { Gutter } from "./gutters.js";
import type { Sheet } from "./sheet.js";
import { CORNER, LABEL_PAD, LATTICE, WIRE_BOX, WIRE_WIRE, type Slot } from "./types.js";

export interface Rows {
  /** Every slot of the container. */
  all: Slot[];
  /** The row `s` stands in. */
  of(s: Slot): Slot[];
  /** The least distance from the end of `s` to the start of `next`. */
  gapAfter(s: Slot, next: Slot): number;
  /** From the start of `row[i]` to the earliest start of `row[i + 1]`. */
  stride(row: Slot[], i: number): number;
  /** May `s` start at `pos` without crowding its neighbours? */
  fits(s: Slot, pos: number): boolean;
  /** Put `s` at `pos`; its row-mates make way. */
  force(s: Slot, pos: number): void;
  /** Measure lanes from the container's low wall: boxes one padding in,
   *  ports clear of the corners. In whole steps of the lattice, so a centre
   *  line on it stays on it — and, the container's size being a whole number
   *  of steps too (stack.ts), is on its parent's lattice as well: one grid
   *  for the whole picture. */
  settleWall(): void;
}

export function rowsOf(sh: Sheet, gutters: ReadonlyMap<Slot, Gutter>): Rows {
  const { layers, g, ax } = sh;
  const all = layers.flatMap((l) => l.slots);
  const of = (s: Slot) => layers[sh.layerOf(s)].slots;

  const gapAfter = (s: Slot, next: Slot): number => {
    if (s.kind === "box" && next.kind === "box") {
      const gu = gutters.get(s);
      return s.after + (gu && gu.right === next ? gu.width : g.gap.lane);
    }
    if (s.label || next.label) return s.after + LABEL_PAD;
    if (s.kind !== "box" && next.kind !== "box") return s.after + WIRE_WIRE;
    // a wire going round the end of a row hugs it; one threading between two boxes keeps its distance
    const row = of(s), wire = s.kind === "box" ? next : s;
    const outer = row.indexOf(wire) < row.findIndex((x) => x.kind === "box") || row.indexOf(wire) > row.map((x) => x.kind).lastIndexOf("box");
    return s.after + (outer ? WIRE_WIRE : WIRE_BOX);
  };
  // a port told to stand clear of the title is measured from there: the wall
  // never comes in so far that it would stand under it
  const clear = (s: Slot) => (s.kind === "port" ? s.least ?? CORNER : ax.pad.low);

  return {
    all, of, gapAfter,
    stride: (row, i) => row[i].lsize + (row[i + 1] ? gapAfter(row[i], row[i + 1]) : 0),
    fits: (s, pos) => {
      const row = of(s), i = row.indexOf(s);
      const prev = row[i - 1], next = row[i + 1];
      if (s.least !== undefined && pos < s.least) return false; // a wall port stays clear of the title
      return (!prev || pos >= prev.pos + prev.lsize + gapAfter(prev, s)) && (!next || next.pos >= pos + s.lsize + gapAfter(s, next));
    },
    force: (s, pos) => {
      const row = of(s), i = row.indexOf(s);
      s.pos = pos;
      for (let k = i - 1; k >= 0; k--) row[k].pos = Math.min(row[k].pos, row[k + 1].pos - gapAfter(row[k], row[k + 1]) - row[k].lsize);
      for (let k = i + 1; k < row.length; k++) row[k].pos = Math.max(row[k].pos, row[k - 1].pos + row[k - 1].lsize + gapAfter(row[k - 1], row[k]));
    },
    settleWall: () => {
      if (!all.length) return;
      const first = Math.floor(Math.min(...all.map((s) => s.pos - clear(s))) / LATTICE) * LATTICE;
      for (const s of all) s.pos -= first;
    },
  };
}
