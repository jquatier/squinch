// Order within every row of every sheet, decided together (REQUIREMENTS §5.2).
//
// The state is the order of slots in each row; the cost is `Count` — the
// crossings that will be drawn, over the whole tree — and the search is the
// plainest one that can reach what the requirements ask for:
//
//   seed     boxes as declared; each lane where a straight stroke between
//            its wire's ends would pass; each port over what it feeds.
//   sift     take one slot — box, lane or port — along its row to the place
//            where the whole picture crosses least. Rows of a container's
//            wall are rows like any other, and moving a port is counted on
//            both sides of the wall, so inside and outside are never decided
//            apart.
//   follow   when two slots trade places, the lanes and ports their wires
//            run on to trade places with them, as far as the wires go. That
//            is the move "port, place in the row inside, row outside, all at
//            once" where each alone would cross something.
//   mirror   a container nobody arranged, turned about whole.
//   restore  boxes that left their declared order for nothing go back.
//
// What decides between two orders, in this order: fewer crossings; then —
// only if no box has passed another, because declaration order is worth a
// tie and a box never moves merely to straighten a wire — the straighter.
import { Count, type Tally } from "./count.js";
import type { Sheet } from "./types.js";

const ROUNDS = 12;

export function order(sheets: Sheet[]): Count {
  for (const s of sheets) seed(s);
  const count = new Count(sheets);
  const search = new Search(count);
  for (let round = 0; round < ROUNDS; round++) {
    let moved = false;
    for (const t of round % 2 ? [...count.tallies].reverse() : count.tallies) {
      const rows = t.sheet.rows.map((_, k) => k);
      for (const k of round % 2 ? rows.reverse() : rows)
        for (const slot of [...t.sheet.rows[k]]) if (search.sift(t, slot)) moved = true;
    }
    for (const t of count.tallies) if (search.mirror(t)) moved = true;
    if (!moved) break;
  }
  search.restore();
  return count;
}

/** Lanes go where a straight stroke between their wire's ends would pass;
 *  ports stand over (or under) what they feed. Boxes keep the declared order. */
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
  constructor(private readonly count: Count) {
    for (const { sheet } of count.tallies)
      this.fixed.set(sheet, new Set(sheet.before.flatMap(([a, b]) => [a * sheet.slots.length + b, b * sheet.slots.length + a])));
  }

  /** May these two neighbours trade places at all? Lanes and ports always;
   *  two boxes not if the author placed both, if `columns` orders them, if a
   *  same-rank wire joins them, or if one has no wire and so stands aside. */
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
    const boxed = (from: number, to: number) => s.rows[row].slice(from, to).some((i) => s.slots[i].kind === "box");
    for (const [a, b] of s.glue) if (s.slots[a].row === row && boxed(s.at[a] + 1, s.at[b])) return false;
    for (const { x, wall } of s.last) if (s.slots[x].row === row && (wall === "e" ? boxed(s.at[x] + 1, s.rows[row].length) : boxed(0, s.at[x]))) return false;
    return true;
  }

  private swap(t: Tally, row: number, i: number, log: Swap[]): void {
    const r = t.sheet.rows[row], a = r[i], b = r[i + 1];
    r[i] = b; r[i + 1] = a;
    t.sheet.at[a] = i + 1; t.sheet.at[b] = i;
    this.count.touch(t, row);
    log.push([t, row, i]);
  }
  private undo(log: Swap[], to = 0): void {
    while (log.length > to) { const [t, row, i] = log.pop()!; this.swap(t, row, i, []); }
  }
  /** Two neighbours trade places, and what their wires lead to trades with them. */
  private trade(t: Tally, row: number, i: number, log: Swap[]): void {
    const a = t.sheet.rows[row][i], b = t.sheet.rows[row][i + 1];
    this.swap(t, row, i, log);
    for (const step of [-1, 1]) this.follow(t, a, b, step, log);
  }
  /** `a` and `b` have just traded places. If each runs on, by its only wire
   *  that way, to a lane or port, and those two are neighbours standing the
   *  old way round, they trade too — and so on along the wires, through a
   *  container's wall to its ports inside, and out through the sheet's own
   *  wall to the row outside. */
  private follow(t: Tally, a: number, b: number, step: number, log: Swap[]): void {
    const p = this.onward(t, a, step), q = this.onward(t, b, step);
    if (!p || !q || p.t !== q.t || p.slot === q.slot) return;
    const s = p.t.sheet;
    if (s.slots[p.slot].row !== s.slots[q.slot].row || Math.abs(s.at[p.slot] - s.at[q.slot]) !== 1) return;
    if (t.sheet.at[a] < t.sheet.at[b] === s.at[p.slot] < s.at[q.slot]) return;
    this.swap(p.t, s.slots[p.slot].row, Math.min(s.at[p.slot], s.at[q.slot]), log);
    this.follow(p.t, p.slot, q.slot, step, log);
  }
  /** The lane or port `slot`'s wire runs on to, `step` rows away — in this
   *  sheet, inside the container it enters, or outside the wall it leaves by. */
  private onward(t: Tally, slot: number, step: number): { t: Tally; slot: number } | undefined {
    const s = t.sheet, x = s.slots[slot], facing = step < 0 ? "s" : "n";
    if (x.kind === "port" && x.row === (step < 0 ? 0 : s.R + 1)) {
      // out through the wall: the wire's next stop in the sheet outside
      const out = t.parent;
      if (!out || out.sheet.dir !== s.dir) return undefined;
      const l = (step < 0 ? out.ups : out.downs)[s.self!].find((k) => k.key === x.key);
      return l && this.into(out, step < 0 ? l.up : l.down, facing, x.key!);
    }
    const links = step < 0 ? t.ups[slot] : t.downs[slot];
    return links.length === 1 ? this.into(t, step < 0 ? links[0].up : links[0].down, facing, links[0].key) : undefined;
  }
  private into(t: Tally, slot: number, wall: "n" | "s", key: string): { t: Tally; slot: number } | undefined {
    const x = t.sheet.slots[slot];
    if (x.kind !== "box") return { t, slot };
    const inner = x.kid!.sheet;
    if (!inner || inner.dir !== t.sheet.dir) return undefined;
    const port = inner.port.get(`${wall}|${key}`);
    return port === undefined ? undefined : { t: this.count.tally(inner), slot: port };
  }

  /** Take `slot` to the place in its row where the picture is best; say whether it moved. */
  sift(t: Tally, slot: number): boolean {
    const s = t.sheet, row = s.slots[slot].row, count = this.count;
    if (s.rows[row].length < 2) return false;
    count.settle();
    const base = { cross: count.cross, rough: count.rough };
    let best = { cross: base.cross, passed: 0, rough: base.rough, step: 0, moves: 0 };
    for (const step of [-1, 1]) {
      const log: Swap[] = [];
      let passed = 0;
      for (let moves = 1; ; moves++) {
        const i = s.at[slot], j = i + step;
        if (j < 0 || j >= s.rows[row].length || !this.free(s, slot, s.rows[row][j])) break;
        if (s.slots[slot].kind === "box" && s.slots[s.rows[row][j]].kind === "box") passed++;
        this.trade(t, row, Math.min(i, j), log);
        if (!this.sound(s, row)) continue;
        count.settle();
        const here = { cross: count.cross, passed, rough: count.rough, step, moves };
        // a box passes another only to remove a crossing; anything else may move to run straighter
        const gain = here.cross < base.cross || (here.cross === base.cross && !passed && here.rough < base.rough - 0.5);
        if (gain && (here.cross - best.cross || here.passed - best.passed || here.rough - best.rough) < 0) best = here;
      }
      this.undo(log);
    }
    if (!best.moves) return false;
    for (let m = 0; m < best.moves; m++) this.trade(t, row, Math.min(s.at[slot], s.at[slot] + best.step), []);
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
    const flip = () => s.rows.forEach((row, k) => { row.reverse(); row.forEach((i, n) => { s.at[i] = n; }); count.touch(t, k); });
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
        s.rows.forEach((row, k) => {
          for (let i = 0; i + 1 < row.length; i++) {
            const a = s.slots[row[i]], b = s.slots[row[i + 1]];
            if (a.kind !== "box" || b.kind !== "box" || a.decl < b.decl || !this.free(s, a.i, b.i)) continue;
            count.settle();
            const was = count.cross, log: Swap[] = [];
            this.trade(t, k, i, log);
            count.settle();
            if (this.sound(s, k) && count.cross <= was) moved = true; else this.undo(log);
          }
        });
      }
    }
  }
}
