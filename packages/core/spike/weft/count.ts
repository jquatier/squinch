// The count the ordering stage minimises: how many crossings the picture
// will have, given nothing but the order of the slots in every row of every
// sheet (REQUIREMENTS §5.2, "count exactly").
//
// It is a sum of small units, so a move re-counts only what it touched:
//
//   a channel   the links between two rows. Two links cross when their ends
//               stand in opposite orders. An end at a container is placed by
//               where the wire meets that container's wall, which is the
//               container's own port order — that is how the two sides of a
//               wall are decided together: one order, counted on both sides.
//   a row       the wires that run along it: a same-rank wire crosses every
//               lane between its ends (or, going round under the row, every
//               wire leaving the boxes it passes); a wire to a side wall
//               crosses what stands between its box and the wall, or the
//               wires of the row-mates it climbs over.
//
// Beside each count goes a `rough` length — how far from straight the links
// are, each row packed at its real sizes — which only ever breaks a tie.
import { turn } from "./frame.js";
import { beyond, sideWay } from "./sheet.js";
import type { Link, Sheet, Side, Wall } from "./types.js";

/** What the count keeps for one sheet. */
export interface Tally {
  sheet: Sheet;
  parent?: Tally;
  /** per slot: the links above it and below it */
  ups: Link[][]; downs: Link[][];
  /** per row: the wires drawn along it */
  flats: Sheet["flats"][]; sides: Side[][];
  /** per slot: rough centre, measured from the middle of its row */
  x: number[]; stale: boolean[];
  /** per channel, per row: the counts, and whether they are out of date */
  chan: Unit[]; row: Unit[];
}
export interface Unit { tally: Tally; channel: boolean; k: number; cross: number; rough: number; dirty: boolean }

export class Count {
  readonly tallies: Tally[];
  private readonly of = new Map<Sheet, Tally>();
  private pending: Unit[] = [];
  cross = 0;
  rough = 0;

  constructor(sheets: Sheet[]) {
    this.tallies = sheets.map((sheet) => {
      const n = sheet.slots.length, rows = sheet.rows.length;
      const t: Tally = {
        sheet, ups: Array.from({ length: n }, () => []), downs: Array.from({ length: n }, () => []),
        flats: Array.from({ length: rows }, () => []), sides: Array.from({ length: rows }, () => []),
        x: new Array(n).fill(0), stale: new Array(rows).fill(true), chan: [], row: [],
      };
      t.chan = sheet.chan.map((_, k) => ({ tally: t, channel: true, k, cross: 0, rough: 0, dirty: false }));
      t.row = sheet.rows.map((_, k) => ({ tally: t, channel: false, k, cross: 0, rough: 0, dirty: false }));
      for (const links of sheet.chan) for (const l of links) { t.downs[l.up].push(l); t.ups[l.down].push(l); }
      for (const f of sheet.flats) t.flats[sheet.slots[f.a].row].push(f);
      for (const s of sheet.sides) t.sides[sheet.slots[s.x].row].push(s);
      this.of.set(sheet, t);
      return t;
    });
    for (const t of this.tallies) t.parent = t.sheet.parent && this.of.get(t.sheet.parent);
    // rough widths, innermost first: a container is as wide as its widest row
    for (const t of [...this.tallies].reverse()) {
      const s = t.sheet;
      s.rough = s.pad.w + s.pad.e + Math.max(0, ...s.rows.map((row) => this.pack(t, row)));
    }
    for (const t of this.tallies) for (const u of [...t.chan, ...t.row]) this.mark(u);
    this.settle();
  }

  tally(sheet: Sheet): Tally { return this.of.get(sheet)!; }

  /** Row `row` of `t` changed its order: everything counted from it is out of date. */
  touch(t: Tally, row: number): void {
    t.stale[row] = true;
    for (const k of [row - 1, row]) if (t.chan[k]) this.mark(t.chan[k]);
    this.mark(t.row[row]);
    // …and so is what the sheet outside counts across this sheet's walls
    const p = t.parent;
    if (!p) return;
    const at = p.sheet.slots[t.sheet.self!].row;
    for (const k of [at - 1, at]) if (p.chan[k]) this.mark(p.chan[k]);
    this.mark(p.row[at]);
  }
  private mark(u: Unit): void { if (!u.dirty) { u.dirty = true; this.pending.push(u); } }

  /** Bring the totals up to date. */
  settle(): void {
    for (const u of this.pending) {
      this.cross -= u.cross; this.rough -= u.rough;
      if (u.channel) this.channel(u); else this.along(u);
      this.cross += u.cross; this.rough += u.rough;
      u.dirty = false;
    }
    this.pending = [];
  }

  // ── rough positions ────────────────────────────────────────────────────────
  private width(t: Tally, slot: number): number {
    const kid = t.sheet.slots[slot].kid;
    return kid ? kid.sheet?.rough ?? kid.w : 0;
  }
  /** Lay a row out roughly, centred on 0; its width. */
  private pack(t: Tally, row: number[]): number {
    const s = t.sheet;
    let x = 0;
    row.forEach((slot, i) => {
      if (i) x += s.slots[slot].kind === "box" && s.slots[row[i - 1]].kind === "box" ? s.gap.lane : s.gap.lane / 2;
      const w = this.width(t, slot);
      t.x[slot] = x + w / 2;
      x += w;
    });
    for (const slot of row) t.x[slot] -= x / 2;
    return x;
  }
  private roughAt(t: Tally, slot: number): number {
    const row = t.sheet.slots[slot].row;
    if (t.stale[row]) { this.pack(t, t.sheet.rows[row]); t.stale[row] = false; }
    return t.x[slot];
  }
  /** Rough place of a link's end: the box's middle, or — at a container of
   *  the same direction — the box inside that the wire goes on to. */
  private roughEnd(t: Tally, slot: number, wall: Wall, key: string): number {
    const x = this.roughAt(t, slot), inner = t.sheet.slots[slot].kid?.sheet;
    if (!inner || inner.dir !== t.sheet.dir) return x;
    const c = this.of.get(inner)!, port = inner.port.get(`${wall}|${key}`);
    if (port === undefined) return x;
    const link = wall === "n" ? c.downs[port][0] : c.ups[port][0];
    return link ? x + this.roughAt(c, wall === "n" ? link.down : link.up) : x;
  }

  // ── where an end stands ────────────────────────────────────────────────────
  /** Place of a wire's end in its row: the slot's, then — at a container —
   *  the wire's place on that container's wall. */
  key(t: Tally, slot: number, wall: Wall, key: string): number {
    const s = t.sheet, inner = s.slots[slot].kid?.sheet;
    return s.at[slot] * 4096 + (inner ? 1 + this.onWall(this.of.get(inner)!, turn(wall, s.dir, inner.dir), key) : 0);
  }
  /** Place of a wire along a wall of its own sheet, low to high. */
  private onWall(t: Tally, wall: Wall, key: string): number {
    const s = t.sheet;
    if (wall === "n" || wall === "s") { const p = s.port.get(`${wall}|${key}`); return p === undefined ? 0 : s.at[p]; }
    const thru = s.through.get(`${wall}|${key}`);
    if (!thru) return 0;
    if (!("x" in thru)) return 4000;
    // along an east or west wall: by row, then over, level with, or under it
    const how = sideWay(s, thru), row = s.slots[thru.x].row, i = s.at[thru.x], far = wall === "e" ? i : 39 - i;
    return Math.min(3999, (row * 3 + (how === "over" ? 0 : how === "straight" ? 1 : 2)) * 40 + Math.max(0, Math.min(39, how === "over" ? far : how === "under" ? 39 - far : 0)));
  }

  // ── the units ──────────────────────────────────────────────────────────────
  private channel(u: Unit): void {
    const t = u.tally, s = t.sheet, links = s.chan[u.k], n = links.length;
    const top = new Array<number>(n), bot = new Array<number>(n);
    let rough = 0;
    for (let i = 0; i < n; i++) {
      const l = links[i];
      top[i] = this.key(t, l.up, "s", l.key);
      bot[i] = this.key(t, l.down, "n", l.key);
      if (s.slots[l.up].kind !== "port" && s.slots[l.down].kind !== "port")
        rough += Math.abs(this.roughEnd(t, l.up, "s", l.key) - this.roughEnd(t, l.down, "n", l.key));
    }
    let cross = 0;
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++)
        if ((top[i] - top[j]) * (bot[i] - bot[j]) < 0) cross++;
    u.cross = cross; u.rough = rough;
  }
  private along(u: Unit): void {
    const t = u.tally, s = t.sheet;
    let cross = 0;
    for (const f of t.flats[u.k]) {
      const between = s.rows[u.k].slice(s.at[f.a] + 1, s.at[f.b]);
      for (const m of between) cross += f.straight ? (s.slots[m].kind === "lane" ? 1 : 0) : t.downs[m].length;
    }
    for (const side of t.sides[u.k]) {
      const how = sideWay(s, side);
      for (const m of beyond(s, side)) cross += how === "straight" ? 1 : how === "over" ? s.busy.up[m] : s.busy.down[m];
    }
    u.cross = cross; u.rough = 0;
  }
}
