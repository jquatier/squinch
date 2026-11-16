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
  /** per slot: the room it takes in a rough row */
  cell: number[];
  /** per channel, per row: the counts, and whether they are out of date */
  chan: Unit[]; row: Unit[];
}
export interface Unit { tally: Tally; channel: boolean; k: number; cross: number; rough: number; dirty: boolean }
/** One end of a link, looked up once: its slot, and — at a container — the
 *  container's tally with the wire's port there (or its way through a side
 *  wall), and the slot inside that the port leads to. */
interface End { slot: number; inner?: Tally; port: number; thru?: Side | Sheet["terms"][number]; next: number }

export class Count {
  readonly tallies: Tally[];
  private readonly of = new Map<Sheet, Tally>();
  private pending: Unit[] = [];
  private readonly ends: { up: End; down: End; thin: boolean }[] = [];
  cross = 0;
  rough = 0;

  constructor(sheets: Sheet[]) {
    this.tallies = sheets.map((sheet) => {
      const n = sheet.slots.length, rows = sheet.rows.length;
      const t: Tally = {
        sheet, ups: Array.from({ length: n }, () => []), downs: Array.from({ length: n }, () => []),
        flats: Array.from({ length: rows }, () => []), sides: Array.from({ length: rows }, () => []),
        x: new Array(n).fill(0), stale: new Array(rows).fill(true), cell: [], chan: [], row: [],
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
    for (const t of this.tallies) for (const links of t.sheet.chan) for (const l of links) {
      const end = (slot: number, wall: Wall): End => {
        const s = t.sheet, sheet = s.slots[slot].kid?.sheet;
        if (!sheet) return { slot, port: -1, next: -1 };
        const inner = this.of.get(sheet)!, w = turn(wall, s.dir, sheet.dir), port = w === "n" || w === "s" ? sheet.port.get(`${w}|${l.key}`) ?? -1 : -1;
        const on = port < 0 ? undefined : w === "n" ? inner.downs[port][0] : inner.ups[port][0];
        return { slot, inner, port, thru: port < 0 ? sheet.through.get(`${w}|${l.key}`) : undefined, next: on && sheet.dir === s.dir ? (w === "n" ? on.down : on.up) : -1 };
      };
      l.n = this.ends.length;
      this.ends.push({ up: end(l.up, "s"), down: end(l.down, "n"), thin: t.sheet.slots[l.up].kind === "port" || t.sheet.slots[l.down].kind === "port" });
    }
    // rough widths, innermost first: a container is as wide as its widest row
    for (const t of [...this.tallies].reverse()) {
      const s = t.sheet;
      t.cell = s.slots.map((x) => (x.kid ? (x.kid.sheet?.rough ?? x.kid.w) + s.gap.lane : s.gap.lane / 2));
      s.rough = s.pad.w + s.pad.e + Math.max(0, ...s.rows.map((row) => this.pack(t, row) - s.gap.lane));
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

  /** Two neighbours in a row trade places. Only the pairs of wires with one
   *  end at each can change — each either starts crossing or stops — so the
   *  two channels are corrected rather than counted again. */
  swap(t: Tally, row: number, i: number): void {
    const s = t.sheet, r = s.rows[row], a = r[i], b = r[i + 1];
    const upper = t.chan[row - 1], lower = t.chan[row];
    const fixUp = upper && !upper.dirty, fixDown = lower && !lower.dirty;
    this.lengths(t, a, b, !!fixUp, !!fixDown);
    const wasUp = this.sum[0], wasDown = this.sum[1];
    r[i] = b; r[i + 1] = a;
    s.at[a] = i + 1; s.at[b] = i;
    if (!t.stale[row]) { const xa = t.x[a], xb = t.x[b]; t.x[b] = xa - t.cell[a] / 2 + t.cell[b] / 2; t.x[a] = xb + t.cell[b] / 2 - t.cell[a] / 2; }
    this.lengths(t, a, b, !!fixUp, !!fixDown);
    if (fixUp) this.adjust(upper, this.flips(t, t.ups[a], t.ups[b], true), this.sum[0] - wasUp);
    if (fixDown) this.adjust(lower, this.flips(t, t.downs[a], t.downs[b], false), this.sum[1] - wasDown);
    this.mark(t.row[row]);
    // the sheet outside reads this one's walls: the rough place of what a
    // port leads to, and the order of wires through a side wall
    const p = t.parent;
    if (!p || !(row === 1 || row === s.R || s.through.size)) return;
    const at = p.sheet.slots[s.self!].row;
    for (const k of [at - 1, at]) if (p.chan[k]) this.mark(p.chan[k]);
    this.mark(p.row[at]);
  }
  private adjust(u: Unit, cross: number, rough: number): void {
    u.cross += cross; u.rough += rough;
    this.cross += cross; this.rough += rough;
  }
  /** `a` now stands after `b`: how many more pairs of their wires cross, on one side. */
  private flips(t: Tally, la: Link[], lb: Link[], up: boolean): number {
    let cross = 0;
    for (const p of la) for (const q of lb) {
      const far = up ? this.above(t, p) - this.above(t, q) : this.below(t, p) - this.below(t, q);
      if (far) cross += far < 0 ? 1 : -1; // they cross if `a`'s wire goes to the earlier place
    }
    return cross;
  }
  private readonly sum = [0, 0];
  /** Rough length of the wires at `a` and `b`, above (into `sum[0]`) and below (`sum[1]`). */
  private lengths(t: Tally, a: number, b: number, up: boolean, down: boolean): void {
    this.sum[0] = up ? this.length(t, t.ups[a]) + this.length(t, t.ups[b]) : 0;
    this.sum[1] = down ? this.length(t, t.downs[a]) + this.length(t, t.downs[b]) : 0;
  }
  private length(t: Tally, links: Link[]): number {
    let sum = 0;
    for (let i = 0; i < links.length; i++) { const e = this.ends[links[i].n!]; if (!e.thin) sum += Math.abs(this.roughEnd(t, e.up) - this.roughEnd(t, e.down)); }
    return sum;
  }

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
  /** Lay a row out roughly, centred on 0; its width. Every slot has a cell —
   *  a box its width and a gap, a lane half a gap — so two neighbours can
   *  trade places without anything else in the row moving. */
  private pack(t: Tally, row: number[]): number {
    let x = 0;
    for (const slot of row) { t.x[slot] = x + t.cell[slot] / 2; x += t.cell[slot]; }
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
  private roughEnd(t: Tally, e: End): number {
    return this.roughAt(t, e.slot) + (e.next >= 0 ? this.roughAt(e.inner!, e.next) : 0);
  }

  // ── where an end stands ────────────────────────────────────────────────────
  /** Place of a link's upper end in its row: the slot's, then — at a
   *  container — the wire's place on that container's wall. */
  above(t: Tally, l: Link): number { return this.place(t, this.ends[l.n!].up); }
  /** …and of its lower end. */
  below(t: Tally, l: Link): number { return this.place(t, this.ends[l.n!].down); }
  private place(t: Tally, e: End): number {
    const at = t.sheet.at[e.slot] * 4096;
    if (!e.inner) return at;
    if (e.port >= 0) return at + 1 + e.inner.sheet.at[e.port];
    const thru = e.thru, s = e.inner.sheet;
    if (!thru) return at + 1;
    if (!("x" in thru)) return at + 4001;
    // along an east or west wall: by row, then over, level with, or under it
    const how = sideWay(s, thru), row = s.slots[thru.x].row, i = s.at[thru.x], far = thru.wall === "e" ? i : 39 - i;
    return at + 1 + Math.min(3999, (row * 3 + (how === "over" ? 0 : how === "straight" ? 1 : 2)) * 40 + Math.max(0, Math.min(39, how === "over" ? far : how === "under" ? 39 - far : 0)));
  }

  // ── the units ──────────────────────────────────────────────────────────────
  private top: number[] = [];
  private bot: number[] = [];
  private channel(u: Unit): void {
    const t = u.tally, links = t.sheet.chan[u.k], n = links.length, top = this.top, bot = this.bot;
    let rough = 0;
    for (let i = 0; i < n; i++) {
      const e = this.ends[links[i].n!];
      top[i] = this.place(t, e.up);
      bot[i] = this.place(t, e.down);
      if (!e.thin) rough += Math.abs(this.roughEnd(t, e.up) - this.roughEnd(t, e.down));
    }
    let cross = 0;
    for (let i = 0; i < n; i++) {
      const a = top[i], b = bot[i];
      for (let j = i + 1; j < n; j++) if ((a - top[j]) * (b - bot[j]) < 0) cross++;
    }
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
