// Order within every row of every sheet, decided together (REQUIREMENTS §5.2).
//
// The state is the order of the boxes and lanes in each rank; the cost is
// `Count` — the crossings that will be drawn, over the whole tree. Ports are
// not searched: a container's wall takes its wires in the order the rank
// behind it has them (`comb`), so the stretch just inside a wall never
// crosses, and whatever disagreement there is shows up outside, where the
// row out there can answer it. That is what makes the wall shared rather
// than owned: one order, read from the inside, counted on both sides.
//
//   seed      boxes as declared; each lane where a straight stroke between
//             its wire's ends would pass.
//   sift      take one slot along its row to the place where the whole
//             picture crosses least.
//   untangle  when slots trade places, the lanes their wires run on to are
//             put back in step — in the next row, the one after, and on
//             through a wall into the sheet outside. That is the move
//             "port, place in the row inside, row outside, all at once"
//             where each alone would cross something.
//   mirror    a container nobody arranged, turned about whole.
//   restore   boxes that left their declared order for nothing go back.
//
// What decides between two orders, in this order: fewer crossings; then —
// only if no box has passed another, because declaration order is worth a
// tie and a box never moves merely to straighten a wire — the straighter.
import { Count, type Tally } from "./count.js";
import type { Link, Sheet } from "./types.js";

const ROUNDS = 12, SWEEPS = 6, TRIES = 2;

export function order(sheets: Sheet[]): Count {
  for (const s of sheets) seed(s);
  const count = new Count(sheets);
  const search = new Search(count);
  search.descend();
  // Sifting stops where no single slot can do better, and from the declared
  // order that can be well short of the best. If crossings remain, look once
  // more from a different start — every row sorted by where its wires come
  // from — and keep that only if it crosses less: a tie goes to the picture
  // nearer the order the author wrote.
  if (count.cross > 0) {
    const declared = search.snapshot(), was = count.cross;
    search.loose = true;
    let best = declared, least = was;
    for (let tries = 0; tries < TRIES && least > 0; tries++) {
      search.sweep();
      search.descend();
      if (count.cross >= least) break;
      least = count.cross;
      best = search.snapshot();
    }
    search.loose = false;
    search.revert(best);
  }
  search.restore();
  count.settle();
  return count;
}

/** Lanes go where a straight stroke between their wire's ends would pass.
 *  Boxes keep the declared order. */
function seed(s: Sheet): void {
  // each row's boxes, packed and centred
  const x = new Map<number, number>();
  for (const row of s.rows) {
    const boxes = row.filter((i) => s.slots[i].kind === "box");
    let at = 0;
    const mid = boxes.map((i) => { const w = s.slots[i].kid!.w; at += w + s.gap.lane; return at - s.gap.lane - w / 2; });
    boxes.forEach((i, k) => x.set(i, mid[k] - (at - s.gap.lane) / 2));
  }
  const want = new Map<number, number>();
  for (const piece of s.pieces.values()) {
    if (piece.kind !== "vert") continue;
    const path = piece.slots, n = path.length - 1;
    const top = x.get(path[0]) ?? x.get(path[n]) ?? 0, bottom = x.get(path[n]) ?? top;
    path.forEach((slot, i) => { if (s.slots[slot].kind !== "box" && !want.has(slot)) want.set(slot, top + ((bottom - top) * i) / n); });
  }
  s.rows.forEach((row, k) => {
    const place = (i: number) => x.get(i) ?? want.get(i) ?? 0;
    // a stable sort: boxes are already in order, and a lane at a box's own centre passes after it
    s.rows[k] = row.map((i, n) => ({ i, n })).sort((p, q) => place(p.i) - place(q.i) || p.n - q.n).map((p) => p.i);
    s.rows[k].forEach((i, n) => { s.at[i] = n; });
  });
}

type Swap = [t: Tally, row: number, i: number];

class Search {
  /** per sheet: `a*n+b` for every pair of boxes that may not trade places */
  private readonly fixed = new Map<Sheet, Set<number>>();
  /** in the second start boxes may pass each other for a straighter picture too: its order is not the declared one any more */
  loose = false;
  constructor(private readonly count: Count) {
    for (const t of count.tallies) {
      const sheet = t.sheet;
      this.fixed.set(sheet, new Set(sheet.before.flatMap(([a, b]) => [a * sheet.slots.length + b, b * sheet.slots.length + a])));
    }
    for (const t of count.tallies) { this.ties(t, "n"); this.ties(t, "s"); }
    this.anyTied = this.tied.size > 0;
    for (const t of count.tallies) this.heading.set(t, t.sheet.slots.map((x) => (x.kind === "port" ? this.head(t, x.i) : undefined)));
    for (const tallies of [[...count.tallies].reverse(), count.tallies]) for (const t of tallies) { this.comb(t, "n", false); this.comb(t, "s", false); }
    count.settle();
    // every wire's lanes, in every sheet it passes
    const byWire = new Map<string, { t: Tally; slot: number }[]>();
    for (const t of count.tallies)
      for (const [wire, piece] of t.sheet.pieces)
        if (piece.kind === "vert") for (const slot of piece.slots)
          if (t.sheet.slots[slot].kind === "lane") (byWire.get(wire) ?? byWire.set(wire, []).get(wire)!).push({ t, slot });
    this.threads = [...byWire.values()];
    this.byWire = byWire;
  }
  private readonly threads: { t: Tally; slot: number }[][];
  private readonly byWire: Map<string, { t: Tally; slot: number }[]>;
  /** The lanes of every wire that touches `slot`. */
  private lanesOf(t: Tally, slot: number): { t: Tally; slot: number }[] {
    const wires = new Set([...t.ups[slot], ...t.downs[slot]].flatMap((l) => l.wires));
    return [...wires].flatMap((w) => this.byWire.get(w) ?? []);
  }

  /** A wire that passes several rows — in one sheet or in several — may be
   *  on the wrong side of everything it passes, and no one lane can change
   *  sides alone without crossing the wire's own neighbours. So the whole
   *  wire is tried on the far left, then on the far right, each lane then
   *  settling where it is best; kept only if the picture as a whole gains. */
  reroute(thread: { t: Tally; slot: number }[]): boolean {
    const count = this.count;
    count.settle();
    const base = { cross: count.cross, rough: count.rough };
    for (const step of [-1, 1]) {
      const log: Swap[] = [];
      for (const { t, slot } of thread) {
        const s = t.sheet, row = s.slots[slot].row;
        for (let j = s.at[slot] + step; j >= 0 && j < s.rows[row].length; j = s.at[slot] + step) this.trade(t, row, Math.min(s.at[slot], j), log);
      }
      for (const { t, slot } of thread) this.sift(t, slot, log);
      count.settle();
      if (count.cross < base.cross || (count.cross === base.cross && count.rough < base.rough - 0.5)) return true;
      this.undo(log);
    }
    return false;
  }

  /** Sift every slot, and try every container turned about, until nothing moves. */
  descend(): void {
    const count = this.count;
    for (let round = 0; round < ROUNDS; round++) {
      let moved = false;
      for (const t of round % 2 ? [...count.tallies].reverse() : count.tallies) {
        const rows = t.sheet.rows.map((_, k) => k).slice(1, t.sheet.R + 1);
        for (const k of round % 2 ? rows.reverse() : rows)
          for (const slot of [...t.sheet.rows[k]])
            if (this.sift(t, slot) || (count.cross > 0 && t.sheet.slots[slot].kind === "box" && this.sift(t, slot, [], true))) moved = true;
      }
      for (const t of count.tallies) if (this.mirror(t)) moved = true;
      for (const thread of this.threads) if (count.cross > 0 && this.reroute(thread)) moved = true;
      if (!moved) break;
    }
    count.settle();
  }

  snapshot(): number[][][] { return this.count.tallies.map((t) => t.sheet.rows.map((row) => [...row])); }
  revert(rows: number[][][]): void {
    this.count.tallies.forEach((t, i) => rows[i].forEach((row, k) => this.set(t, k, [...row])));
    this.count.settle();
  }
  private set(t: Tally, k: number, row: number[]): void {
    t.sheet.rows[k] = row;
    row.forEach((slot, n) => { t.sheet.at[slot] = n; });
    this.count.touch(t, k);
  }

  /** A wall's ports in the order the rank behind the wall has their wires;
   *  two wires of one box inside, in the order they are headed for outside.
   *  A wall that changes is read by the wall outside it, if this sheet
   *  stands against that one. `deep`: what lies outside has changed, so the
   *  containers standing against this wall inside — whose wires are headed
   *  out through it — are combed too. */
  private comb(t: Tally, wall: "n" | "s", deep: boolean): void {
    const s = t.sheet, k = wall === "n" ? 0 : s.R + 1, row = s.rows[k], n = row.length;
    if (n > 1) {
      const inside = this.inside, outside = this.outside, heading = this.heading.get(t)!, links = wall === "n" ? t.downs : t.ups;
      let sorted = true;
      for (let i = 0; i < n; i++) {
        const l = links[row[i]][0], h = heading[row[i]];
        inside[i] = l ? (wall === "n" ? this.count.below(t, l) : this.count.above(t, l)) : Infinity;
        outside[i] = h ? (wall === "n" ? this.count.above(h.t, h.link) : this.count.below(h.t, h.link)) : 0;
        if (i && (inside[i - 1] > inside[i] || (inside[i - 1] === inside[i] && outside[i - 1] > outside[i]))) sorted = false;
      }
      if (!sorted) {
        const by = row.map((_, i) => i).sort((p, q) => inside[p] - inside[q] || outside[p] - outside[q] || p - q);
        this.set(t, k, by.map((i) => row[i]));
        const out = t.parent;
        if (out && out.sheet.dir === s.dir) {
          const at = out.sheet.slots[s.self!].row;
          if (at === (wall === "n" ? 1 : out.sheet.R)) this.comb(out, wall, false);
          // …and by the containers across the channel, whose own ties follow this order
          if (this.anyTied) for (const slot of out.sheet.rows[wall === "n" ? at - 1 : at + 1] ?? []) {
            const inner = out.sheet.slots[slot].kid?.sheet, facing = wall === "n" ? "s" : "n";
            if (inner && inner.dir === s.dir && this.tied.has(`${facing}${inner.cell.id}`)) this.comb(this.count.tally(inner), facing, true);
          }
        }
      }
    }
    if (deep) for (const slot of s.rows[wall === "n" ? 1 : s.R] ?? []) {
      const inner = s.slots[slot].kid?.sheet;
      if (inner && inner.dir === s.dir && this.tied.has(`${wall}${inner.cell.id}`)) this.comb(this.count.tally(inner), wall, true);
    }
  }
  /** `wall` + container id, for every wall whose order depends on what lies
   *  outside it: two of its wires come from one box inside — or a container
   *  standing against it inside has such a wall. Only these need combing
   *  again when the row outside changes. */
  private readonly inside: number[] = [];
  private readonly outside: number[] = [];
  private readonly tied = new Set<string>();
  private anyTied = false;
  private ties(t: Tally, wall: "n" | "s"): boolean {
    const s = t.sheet, ports = s.rows[wall === "n" ? 0 : s.R + 1];
    const inner = ports.map((p) => { const l = (wall === "n" ? t.downs : t.ups)[p][0]; return l ? (wall === "n" ? l.down : l.up) : -1; });
    let tied = new Set(inner).size < inner.length;
    for (const slot of s.rows[wall === "n" ? 1 : s.R] ?? []) {
      const kid = s.slots[slot].kid?.sheet;
      if (kid && kid.dir === s.dir && this.ties(this.count.tally(kid), wall)) tied = true;
    }
    if (tied) this.tied.add(`${wall}${s.cell.id}`);
    return tied;
  }
  /** per sheet, per port: the link outside on which the port's wire next
   *  comes to rest — beyond the next wall out, if it goes on through that */
  private readonly heading = new Map<Tally, ({ t: Tally; link: Link } | undefined)[]>();
  private head(t: Tally, port: number): { t: Tally; link: Link } | undefined {
    const s = t.sheet, out = t.parent, north = s.slots[port].row === 0;
    if (!out || out.sheet.dir !== s.dir) return undefined;
    const link = (north ? out.ups : out.downs)[s.self!].find((x) => x.key === s.slots[port].key);
    if (!link) return undefined;
    const far = north ? link.up : link.down;
    return out.sheet.slots[far].kind === "port" ? this.head(out, far) : { t: out, link };
  }
  /** Row `k` of `t` has changed: comb the walls that read from it. */
  private combed(t: Tally, k: number): void {
    const s = t.sheet;
    if (k === 1) this.comb(t, "n", false);
    if (k === s.R) this.comb(t, "s", false);
    if (!this.anyTied) return;
    for (const [near, wall] of [[k + 1, "n"], [k - 1, "s"]] as const)
      for (const slot of s.rows[near] ?? []) { const inner = s.slots[slot].kid?.sheet; if (inner && inner.dir === s.dir && this.tied.has(`${wall}${inner.cell.id}`)) this.comb(this.count.tally(inner), wall, true); }
  }

  /** The other start: down the sheets and back up, each row sorted by the
   *  average place of what its slots are wired to in the row before — as far
   *  as the author's arrangement lets slots pass each other. The best order
   *  met on the way is the one left standing. */
  sweep(): void {
    const count = this.count;
    count.settle();
    let best = this.snapshot(), least = Infinity;
    for (let pass = 0; pass < 2 * SWEEPS && least > 0; pass++) {
      const up = pass % 2 === 1;
      for (const t of count.tallies) {
        const s = t.sheet, rows = s.rows.map((_, k) => k).slice(1, s.R + 1);
        for (const k of up ? rows.reverse() : rows) {
          const was = s.rows[k], row = [...was];
          const mean = new Map(row.map((slot, i) => {
            const links = up ? t.downs[slot] : t.ups[slot], n = s.rows[up ? k + 1 : k - 1].length || 1;
            const sum = links.reduce((a, l) => a + (up ? count.below(t, l) : count.above(t, l)) / 4096 + 0.5, 0);
            return [slot, links.length ? sum / links.length / n : (i + 0.5) / row.length];
          }));
          // a bubble sort: only neighbours trade, and only those that may
          for (let again = true; again;) {
            again = false;
            for (let i = 0; i + 1 < row.length; i++)
              if (mean.get(row[i])! > mean.get(row[i + 1])! + 1e-9 && this.free(s, row[i], row[i + 1])) { [row[i], row[i + 1]] = [row[i + 1], row[i]]; again = true; }
          }
          this.set(t, k, row);
          if (!this.sound(s, k)) this.set(t, k, was);
          this.combed(t, k);
        }
      }
      count.settle();
      if (count.cross < least) { least = count.cross; best = this.snapshot(); }
    }
    this.revert(best);
  }

  /** May these two neighbours trade places at all? Lanes always; two boxes
   *  not if the author placed both, if `columns` orders them, if a same-rank
   *  wire joins them, or if one has no wire and so stands aside. */
  private free(s: Sheet, p: number, q: number): boolean {
    const a = s.slots[p], b = s.slots[q];
    if (a.kind !== "box" || b.kind !== "box") return true;
    if (a.held && b.held) return false;
    if (a.col >= 0 && b.col >= 0 && a.col !== b.col) return false;
    if ((a.idle && !a.held) || (b.idle && !b.held)) return false;
    return !this.fixed.get(s)!.has(p * s.slots.length + q);
  }
  /** Does the row still keep what the sheet promised — nothing but lanes
   *  between two boxes a straight wire joins, nothing but lanes past a
   *  container whose wire runs straight out? */
  private sound(s: Sheet, row: number): boolean {
    for (const [a, b] of s.glue) if (s.slots[a].row === row && this.boxed(s, row, s.at[a] + 1, s.at[b])) return false;
    for (const { x, wall } of s.last) if (s.slots[x].row === row && (wall === "e" ? this.boxed(s, row, s.at[x] + 1, s.rows[row].length) : this.boxed(s, row, 0, s.at[x]))) return false;
    return true;
  }
  private boxed(s: Sheet, row: number, from: number, to: number): boolean {
    for (let i = from; i < to; i++) if (s.slots[s.rows[row][i]].kind === "box") return true;
    return false;
  }

  private swap(t: Tally, row: number, i: number, log: Swap[]): void {
    this.count.swap(t, row, i);
    this.combed(t, row);
    log.push([t, row, i]);
  }
  private undo(log: Swap[], to = 0): void {
    while (log.length > to) { const [t, row, i] = log.pop()!; this.swap(t, row, i, []); }
  }
  /** Two neighbours trade places, and what their wires lead to is put back in step. */
  private trade(t: Tally, row: number, i: number, log: Swap[]): void {
    this.swap(t, row, i, log);
    for (const step of [-1, 1]) this.untangle(t, row + step, step, log);
  }
  /** Row `k` reads from the row `step` behind it, which has just changed.
   *  Two neighbouring lanes there whose wires now cross on that side trade
   *  places; if any did, the row beyond is looked at in turn. At a wall the
   *  ports are already combed, and the look goes on in the sheet outside. */
  private untangle(t: Tally, k: number, step: number, log: Swap[]): void {
    const s = t.sheet;
    if (k <= 0 || k > s.R) {
      const out = t.parent;
      if (out && out.sheet.dir === s.dir) this.untangle(out, out.sheet.slots[s.self!].row + step, step, log);
      return;
    }
    const row = s.rows[k];
    let any = false;
    for (let again = true, pass = 0; again && pass < row.length; pass++) {
      again = false;
      for (let i = 0; i + 1 < row.length; i++)
        if (this.back(t, row[i], step) > this.back(t, row[i + 1], step)) { this.swap(t, k, i, log); again = any = true; }
    }
    if (any) this.untangle(t, k + step, step, log);
  }
  /** Where a lane's one wire comes from, `step` behind it; not a number for anything else. */
  private back(t: Tally, slot: number, step: number): number {
    const links = step < 0 ? t.downs[slot] : t.ups[slot];
    if (t.sheet.slots[slot].kind === "box" || links.length !== 1) return NaN;
    return step < 0 ? this.count.below(t, links[0]) : this.count.above(t, links[0]);
  }

  /** Take `slot` to the place in its row where the picture is best; say
   *  whether it moved. `carry`: at each place tried, the lanes of the slot's
   *  own wires settle again before the place is judged — a box and the wires
   *  that reach it from far off change sides together or not at all. */
  sift(t: Tally, slot: number, kept: Swap[] = [], carry = false): boolean {
    const s = t.sheet, row = s.slots[slot].row, count = this.count;
    if (s.rows[row].length < 2) return false;
    count.settle();
    const base = { cross: count.cross, rough: count.rough };
    let best = { cross: base.cross, passed: 0, rough: base.rough, step: 0, moves: 0 };
    const lanes = carry ? this.lanesOf(t, slot) : [];
    if (carry && !lanes.length) return false;
    for (const step of [-1, 1]) {
      const log: Swap[] = [];
      let passed = 0;
      for (let moves = 1; ; moves++) {
        const i = s.at[slot], j = i + step;
        if (j < 0 || j >= s.rows[row].length || !this.free(s, slot, s.rows[row][j])) break;
        if (s.slots[slot].kind === "box" && s.slots[s.rows[row][j]].kind === "box") passed++;
        this.trade(t, row, Math.min(i, j), log);
        if (carry) for (const lane of lanes) this.sift(lane.t, lane.slot, log);
        if (!this.sound(s, row)) continue;
        count.settle();
        const here = { cross: count.cross, passed, rough: count.rough, step, moves };
        // a box passes another only to remove a crossing; anything else may move to run straighter
        const gain = here.cross < base.cross || (here.cross === base.cross && (!passed || this.loose) && here.rough < base.rough - 0.5);
        if (gain && (here.cross - best.cross || here.passed - best.passed || here.rough - best.rough) < 0) best = here;
      }
      this.undo(log);
    }
    if (!best.moves) return false;
    for (let m = 0; m < best.moves; m++) {
      this.trade(t, row, Math.min(s.at[slot], s.at[slot] + best.step), kept);
      if (carry) for (const lane of lanes) this.sift(lane.t, lane.slot, kept);
    }
    return true;
  }

  /** A container whose boxes nobody arranged, turned about: every row
   *  reversed at once. Kept only if the whole picture crosses less. */
  mirror(t: Tally): boolean {
    const s = t.sheet, count = this.count;
    if (!s.parent || s.before.length || s.sides.length || s.terms.length || s.slots.some((x) => x.held || x.col >= 0)) return false;
    if (!s.rows.some((row) => row.length > 1)) return false;
    count.settle();
    const before = count.cross;
    const flip = () => { for (let k = 1; k <= s.R; k++) this.set(t, k, [...s.rows[k]].reverse()); for (let k = 1; k <= s.R; k++) this.combed(t, k); };
    flip();
    count.settle();
    if (count.cross < before) return true;
    flip();
    return false;
  }

  /** Declaration order is worth a tie: two neighbouring boxes standing the
   *  other way round go back, if that costs no crossing. */
  restore(): void {
    const count = this.count;
    for (let pass = 0, moved = true; moved && pass < 6; pass++) {
      moved = false;
      for (const t of count.tallies) {
        const s = t.sheet;
        for (let k = 1; k <= s.R; k++) {
          for (let i = 0; i + 1 < s.rows[k].length; i++) {
            const a = s.slots[s.rows[k][i]], b = s.slots[s.rows[k][i + 1]];
            if (a.kind !== "box" || b.kind !== "box" || a.decl < b.decl || !this.free(s, a.i, b.i)) continue;
            count.settle();
            const was = count.cross, log: Swap[] = [];
            this.trade(t, k, i, log);
            count.settle();
            if (this.sound(s, k) && count.cross <= was) moved = true; else this.undo(log);
          }
        }
      }
    }
  }
}
