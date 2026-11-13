// The order of every row of every cell — the decision that fixes crossings
// (§5.2) — made for the whole picture at once.
//
// There is one state (the rows) and one judge (`score`): the exact number of
// crossings, then how many boxes stand out of their declared order, then how
// far from straight the wires lean. A candidate is kept only if the judge
// prefers it, so "declaration order is worth a tie, not a crossing" and
// "prefer the straighter among equals" are the judge's lexical order, not
// rules scattered through the moves.
//
// Two moves propose candidates:
//
//   rethread  lift one thread — every lane and port of a wire, in every cell
//             it passes — and put it back along the cheapest path, found
//             exactly (a shortest path through the gaps of the rows it
//             visits). The port on a wall, the lane inside and the lane
//             outside move together, which is the move that no sequence of
//             single swaps can make (§5.2, last rule but one).
//   shift     stand a box (with the rank-mates glued to it) somewhere else
//             in its row, and rethread the wires that end on it.
//
// To add a move: write a function that permutes rows and call `attempt`
// with it. It is judged by the same score as the rest.

import { chordsIn, cross, crossings, ring, sub as subOf, type Chord } from "./count.js";
import { bends, endX, gapX, lean, settle } from "./estimate.js";
import { reindex, wallIn, type Cell, type Item, type Plan, type Row, type Seg, type Thread } from "./plan.js";

export interface Score { crossings: number; moved: number; lean: number }
const better = (a: Score, b: Score) =>
  a.crossings !== b.crossings ? a.crossings < b.crossings : a.moved !== b.moved ? a.moved < b.moved : a.lean < b.lean - 1e-6;

/** Pairs of boxes in one rank standing the other way round from their declaration. */
function moved(plan: Plan): number {
  let n = 0;
  for (const cell of plan.cells)
    for (const row of cell.rows) {
      if (row.kind !== "rank") continue;
      const boxes = row.items.filter((i) => i.kind === "box");
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (boxes[i].declared > boxes[j].declared) n++;
    }
  return n;
}

export function score(plan: Plan): Score {
  settle(plan);
  return { crossings: crossings(plan), moved: moved(plan), lean: bends(plan) };
}

// ── rethread ─────────────────────────────────────────────────────────────────

/** One end of a seg, as the search sees it: fixed, or a free item of the thread being placed. */
type Slot =
  | { free: Item; outer?: Item }  // `outer`: the container whose wall the free port is on, seen from outside
  | { free?: undefined };

function slotOf(seg: Seg, which: "upper" | "lower", mine: Set<Item>): Slot {
  const end = seg[which], it = end.item;
  if (mine.has(it)) return { free: it };
  if (it.inner) {
    const wall = wallIn(it.inner, it.cell, end.wall);
    if (wall === "N" || wall === "S") {
      const port = it.inner.free.get(`${wall === "N" ? 0 : it.inner.rows.length - 1}|${seg.key}`);
      if (port && mine.has(port)) return { free: port, outer: it };
    }
  }
  return {};
}

/** Lift a thread's lanes and ports out of their rows and put each back where the whole thread costs least. */
export function rethread(thread: Thread): void {
  const mine = new Set(thread.items);
  if (!mine.size) return;
  const rows = new Set<Row>();
  for (const it of mine) rows.add(it.cell.rows[it.row]);
  for (const row of rows) { row.items = row.items.filter((i) => !mine.has(i)); reindex(row); }

  // the gaps each item may go back into: anywhere but between two glued rank-mates
  const gaps = new Map<Item, number[]>();
  for (const it of mine) {
    const items = it.cell.rows[it.row].items, gs: number[] = [];
    for (let g = 0; g <= items.length; g++) if (g === 0 || g === items.length || !items[g].chain || items[g].chain !== items[g - 1].chain) gs.push(g);
    gaps.set(it, gs);
  }

  // every seg with an end on the thread, each once
  const segs = new Set<Seg>();
  for (const p of thread.pieces) if (p.kind === "seg") segs.add(p);
  for (const it of mine) for (const s of it.touch) segs.add(s);

  const others = new Map<string, Chord[]>();
  const rest = (cell: Cell, ch: number) => {
    const id = `${cell.id}|${ch}`;
    return others.get(id) ?? others.set(id, chordsIn(cell, ch, thread.key)).get(id)!;
  };
  /** What a seg costs with its free ends in the given gaps. */
  const cost = (seg: Seg, up: Slot, gu: number, lo: Slot, gl: number): number => {
    const r = ring(seg.cell, seg.ch);
    const place = (slot: Slot, g: number, end: Seg["upper"]): [at: number, x: number | undefined] => {
      if (!slot.free) return [end.item.pos + subOf(end, seg.key), endX(end, seg.key)];
      if (slot.outer) {
        const n = slot.free.cell.rows[slot.free.row].items.length, f = (g + 0.5) / (n + 1);
        return [slot.outer.pos + f, slot.outer.ex + (f - 0.5) * slot.outer.ew * 0.6];
      }
      const items = slot.free.cell.rows[slot.free.row].items;
      // a port's own place along its wall is free: it will stand over what it leads to
      return [g, slot.free.kind === "port" ? undefined : gapX(items, g)];
    };
    const [a, xa] = place(up, gu, seg.upper), [b, xb] = place(lo, gl, seg.lower);
    const c: Chord = { lo: Math.min(r.top(a), r.bottom(b)), hi: Math.max(r.top(a), r.bottom(b)), key: thread.key };
    let n = 0;
    for (const o of rest(seg.cell, seg.ch)) if (cross(c, o)) n++;
    let run = xa === undefined || xb === undefined ? 0 : lean(xa - xb);
    // §5.7: a wire that has to turn comes into a titled cell clear of its title
    const cell = seg.cell;
    if (cell.title && seg.ch === 0 && lo.free && !lo.outer && xb !== undefined && xb < cell.title.w + 8 - cell.ew / 2) run += lean(cell.title.w + 8 - cell.ew / 2 - xb);
    return n * 1e7 + run;
  };

  // Shortest path over the thread, which is a tree (a wire is a chain; a
  // bundle is a trunk with branches): each free item's best cost for each of
  // its gaps, given the best its subtree can then do.
  const at = new Map<Item, { seg: Seg; me: Slot; other: Slot; meUpper: boolean }[]>();
  for (const it of mine) at.set(it, []);
  for (const seg of segs) {
    const up = slotOf(seg, "upper", mine), lo = slotOf(seg, "lower", mine);
    if (up.free) at.get(up.free)!.push({ seg, me: up, other: lo, meUpper: true });
    if (lo.free) at.get(lo.free)!.push({ seg, me: lo, other: up, meUpper: false });
  }
  const seen = new Set<Item>(), choice = new Map<Item, number>();
  const solve = (it: Item, via?: Seg): { best: number[]; pick: (g: number) => void } => {
    seen.add(it);
    const gs = gaps.get(it)!, total = gs.map(() => 0);
    const kids: { pick: (g: number) => void; arg: number[] }[] = [];
    for (const link of at.get(it)!) {
      if (link.seg === via) continue;
      const side = (g: number, og: number) => (link.meUpper ? cost(link.seg, link.me, g, link.other, og) : cost(link.seg, link.other, og, link.me, g));
      if (!link.other.free) { gs.forEach((g, i) => { total[i] += side(g, 0); }); continue; }
      if (seen.has(link.other.free)) continue; // not a tree after all: leave that seg out of the reckoning
      const sub = solve(link.other.free, link.seg), ogs = gaps.get(link.other.free)!;
      const arg = gs.map(() => 0);
      gs.forEach((g, i) => {
        let least = Infinity;
        ogs.forEach((og, j) => { const c = side(g, og) + sub.best[j]; if (c < least) { least = c; arg[i] = j; } });
        total[i] += least;
      });
      kids.push({ pick: sub.pick, arg });
    }
    return { best: total, pick: (i) => { choice.set(it, gs[i]); for (const k of kids) k.pick(k.arg[i]); } };
  };
  for (const it of thread.items) {
    if (seen.has(it)) continue;
    const { best, pick } = solve(it);
    let i = 0;
    for (let k = 1; k < best.length; k++) if (best[k] < best[i]) i = k;
    pick(i);
  }
  // put them back, last gap first so earlier gaps keep their numbers
  const back = [...mine].sort((p, q) => choice.get(q)! - choice.get(p)! || q.uid - p.uid);
  for (const it of back) it.cell.rows[it.row].items.splice(choice.get(it)!, 0, it);
  for (const row of rows) reindex(row);
}


// ── shift ────────────────────────────────────────────────────────────────────

/** A row as the things that move as one: a box with its glued rank-mates, or a single item. */
const units = (row: Row): Item[][] => {
  const out: Item[][] = [];
  for (const it of row.items) {
    const last = out[out.length - 1];
    if (last && it.chain && last[0].chain === it.chain) last.push(it); else out.push([it]);
  }
  return out;
};
/** May unit `u` change places with unit `v`? Not past a box the author also
 *  placed, not out of its column band, and never round a box no wire touches. */
const mayPass = (u: Item[], v: Item[]): boolean => {
  if (v.some((i) => i.idle)) return false;
  if (u.some((i) => i.held) && v.some((i) => i.held)) return false;
  const bu = u.find((i) => i.band >= 0)?.band, bv = v.find((i) => i.band >= 0)?.band;
  return bu === undefined || bv === undefined || bu === bv;
};

type Snapshot = Item[][];
const take = (plan: Plan): Snapshot => plan.cells.flatMap((c) => c.rows.map((r) => r.items));
const put = (plan: Plan, snap: Snapshot): void => {
  let k = 0;
  for (const c of plan.cells) for (const r of c.rows) { r.items = snap[k++]; reindex(r); }
};

export function order(plan: Plan): Score {
  const threads = [...plan.threads.values()];
  for (const t of threads) rethread(t); // the first placing of every lane and port
  let now = score(plan);

  /** Try a change; keep it if the judge prefers the result. */
  const attempt = (change: () => void): boolean => {
    const before = take(plan).map((r) => r.slice());
    change();
    const next = score(plan);
    if (better(next, now)) { now = next; return true; }
    put(plan, before);
    return false;
  };

  for (let round = 0; round < 8; round++) {
    let improved = false;
    for (const t of threads) if (t.items.length && attempt(() => rethread(t))) improved = true;
    // a box leaves its place only for a crossing — or to go back to where it was declared
    if (now.crossings || now.moved)
      for (const cell of plan.cells)
        for (const row of cell.rows) {
          if (row.kind !== "rank") continue;
          for (const first of row.items.filter((i) => i.kind === "box" && !i.idle && (!i.chain || i.chain[0] === i))) {
            const us = units(row), from = us.findIndex((u) => u[0] === first), unit = us[from];
            let best: { snap: Snapshot; score: Score } | undefined;
            const start = take(plan).map((r) => r.slice());
            for (let to = 0; to < us.length; to++) {
              if (to === from) continue;
              const passed = to < from ? us.slice(to, from) : us.slice(from + 1, to + 1);
              if (!passed.every((v) => mayPass(unit, v))) continue;
              if (!passed.some((v) => v[0].kind === "box")) continue; // only lanes passed: that is rethreading's job
              const rest = us.filter((u) => u !== unit);
              rest.splice(to, 0, unit);
              row.items = rest.flat();
              reindex(row);
              const keys = new Set<string>();
              for (const it of unit) for (const k of it.keys) keys.add(k);
              for (const k of keys) rethread(plan.threads.get(k)!);
              const s = score(plan);
              if (better(s, best?.score ?? now)) best = { snap: take(plan).map((r) => r.slice()), score: s };
              put(plan, start.map((r) => r.slice()));
            }
            if (best) { put(plan, best.snap); now = best.score; improved = true; }
          }
        }
    if (!improved) break;
  }
  settle(plan);
  return now;
}
