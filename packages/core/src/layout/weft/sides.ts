// Where wires stand along a wall, and the east and west walls of leaves
// (REQUIREMENTS §5.4).
//
// ── Along a wall ──────────────────────────────────────────────────────────
//
// Every wall of a box is shared by the wires that meet it, and they stand in
// one order along it: low to high (top to bottom of a side wall, west to
// east of a north or south one — the frame exchange keeps both, `frame.ts`).
// That order is a `Rank`, compared part by part: first which stretch of the
// wall — the start (−1), the run of wires that go on through (0), the end
// (1) — then where within it. Two kinds of wire make the ends:
//
//   a hook   a wire asked to use this wall, that turns along the row to a
//            lane beside the box (`Slot.beside`). It stands at the end of the
//            wall its lane is beside, and several there nest: the nearer
//            lane's wire nearer that end (`nest`). On a side wall the end is
//            the way its lane runs — up from the wall's level (a *tail*, at
//            the top) or on down (a *head*, at the bottom).
//   …the rest go on, and stand in the order of where they are going: the
//            far end of their link out there, or the next wall's order.
//
// In that order no two wires of a wall cross between it and where they go.
// It is read off the order of the rows alone, so it is known — and the same
// from either side of a container's wall — once the ordering stage is done.
// A container's inside reads it from the sheet outside (`comesAt`).
//
// ── A leaf's side wall ────────────────────────────────────────────────────
//
// One placer for every wire that meets it (`placeSideWall`), as `ports.ts`
// is for a north or south wall: the tails, then the wires straight out —
// across the gutter to a neighbour (placed there, `gutter.ts`, both walls at
// once) or on to the sheet's own wall — then the heads. A step apart, or,
// where the wall is too short for them all, an even share of it.
import { ceilTo, GRID, nearestFree, turn } from "./frame.js";
import { beyond, hookAfter, sideWay } from "./sheet.js";
import type { Sheet, Side, Wall } from "./types.js";

const STEP = 16;

// ── along a wall ──────────────────────────────────────────────────────────

/** Where a wire stands along a wall: compared part by part, low to high. */
export type Rank = readonly number[];
export const cmpRank = (a: Rank, b: Rank): number => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
  return 0;
};
/** A hook at one end of a wall (`end`: −1 the start, 1 the end), its lane
 *  `d` slots from its box: the nearer lane's wire nearer that end. */
const nest = (end: -1 | 1, d: number): Rank => [end, -end * d];

/** Where a wire hooked round its box out of this wall stands on it. */
export const hookRank = (s: Sheet, lane: number): Rank => nest(hookAfter(s, lane) ? 1 : -1, Math.abs(s.at[lane] - s.at[s.slots[lane].beside!.box]));

/** Does a hook's lane on a side wall run up from the wall's level (a tail)?
 *  A wire through the sheet says so when its hook is made (`beside.tail`);
 *  one round its row-mates to the sheet's own wall, by the way it goes —
 *  over the row is up. Undefined for a lane no wire is drawn along: made for
 *  a box that the ordering stage left last in its row after all. */
export function hookTail(s: Sheet, lane: number): boolean | undefined {
  const b = s.slots[lane].beside!;
  if (b.tail !== undefined) return b.tail;
  for (const [d, l] of sideLanes(s)) if (l === lane) return sideWay(s, d) === "over";
  return undefined;
}

/** Where the wire `key` stands among the wires through this sheet's wall
 *  `wall`, as the sheet outside has them, where that wall is a side wall out
 *  there — an east or west wall, or a north or south one of a sheet that
 *  flows the other way from its parent. Undefined at the root, and for a
 *  north or south wall that stays one outside (its order is the ordering
 *  stage's, `order.ts`).
 *
 *  Out there the wall lies along a row: the wire stands where its far end
 *  does in that row, or, hooked round the container, at the end its lane is
 *  beside. Or out there it is a side wall too, the container being the box:
 *  a hook, at the end its lane runs to (`hookTail`); a wire straight on
 *  through the next wall, where that wall has it; one straight across the
 *  gutter to a neighbour, by the order the wires across that gutter are
 *  declared in — which the neighbour's inside reads too, so the two agree. */
export function comesAt(s: Sheet, wall: Wall, key: string): Rank | undefined {
  const p = s.parent;
  if (!p) return undefined;
  const self = s.self!, row = p.slots[self].row, out = turn(wall, s.dir, p.dir);
  if (out === "n" || out === "s") {
    if (wall === "n" || wall === "s") return undefined;
    const north = out === "n";
    const link = p.chan[north ? row - 1 : row].find((l) => (north ? l.down : l.up) === self && l.key === key);
    if (link) return [0, p.at[north ? link.up : link.down]];
    const lane = p.slots.find((x) => x.beside?.box === self && x.key === key && x.beside.wall === out);
    return lane ? hookRank(p, lane.i) : undefined;
  }
  const round = p.sides.find((d) => d.x === self && d.key === key && d.wall === out);
  // (a lane round this container that a wire is drawn along — not one made for a wire to the sheet's wall
  // that the ordering stage then left straight: that has no way to run, `hookTail`)
  const lane = (round && sideLanes(p).get(round)) ?? p.slots.find((x) => x.beside?.box === self && x.key === key && x.beside.wall === out)?.i;
  const tail = lane === undefined ? undefined : hookTail(p, lane);
  if (tail !== undefined) return nest(tail ? -1 : 1, Math.abs(p.at[lane!] - p.at[self]));
  if (round) return sideWay(p, round) === "straight" ? [0, ...(comesAt(p, out, key) ?? [])] : [0];
  const flat = p.flats.findIndex((f) => f.key === key && f.straight && (out === "e" ? f.a === self : f.b === self));
  return [0, Math.max(0, flat)];
}

// ── settled once the order is final (`order.ts`), outermost sheet first ────

/** The lane each wire round its row-mates takes (`Side.hook`): `laneOrder`,
 *  kept on the sheet. Asked before that, it is an error — what it reads
 *  would not yet be settled. */
export function sideLanes(s: Sheet): Map<Side, number> {
  if (!s.lanes) throw new Error(`weft: the lanes of ${s.cell.id || "the root"} were asked before the order was final`);
  return s.lanes;
}

/** Which lane each wire round a row-mate takes. Several of one box, out of
 *  one wall and the same way round, have a lane each, and which wire has
 *  which is free: nothing else of the sheet reads it. So they take them in
 *  the order the wall outside has the wires — over the row, the one that
 *  stands highest out there has the nearest lane and the nearest track;
 *  under it, the lowest — and nest, crossing neither each other here nor on
 *  the way from the wall to their lanes outside. */
export function laneOrder(s: Sheet): Map<Side, number> {
  const out = new Map<Side, number>(), groups = new Map<string, Side[]>();
  for (const d of s.sides) {
    const way = sideWay(s, d);
    if (d.hook === undefined || way === "straight") continue;
    const id = `${d.x}|${d.wall}|${way}`;
    (groups.get(id) ?? groups.set(id, []).get(id)!).push(d);
  }
  for (const [id, group] of groups) {
    const box = group[0].x, near = group.map((d) => d.hook!).sort((a, b) => Math.abs(s.at[a] - s.at[box]) - Math.abs(s.at[b] - s.at[box]));
    const at = new Map(group.map((d) => [d, comesAt(s, d.wall, d.key) ?? [0]])), sign = id.endsWith("over") ? 1 : -1;
    [...group].sort((p, q) => sign * cmpRank(at.get(p)!, at.get(q)!)).forEach((d, i) => out.set(d, near[i]));
  }
  return out;
}

/** Which way round its row-mates each wire goes that has row-mates between
 *  its box and the sheet's side wall: over the row or under it. The sheet
 *  first chose by how busy each way is (`sideWay`), not knowing the wall
 *  outside; that order comes in at this sheet's wall as well, and a wire on
 *  the wrong side of another there crosses it between the wall and the sheet
 *  outside. So once the order is final the choice is made again, over the
 *  crossings of both: the wires each way would cross inside, and the wires
 *  of the same wall it would then stand out of order with. Where a wire
 *  meets the wall is known from the order alone: by row, then over the row,
 *  across it or under it, then — of two that go one way round — the one that
 *  turns nearer the wall nearer the row. A tie keeps the first choice; a
 *  container's way, set by its insides, is left as it is unless the wire
 *  was asked for that side. */
export function settleWays(s: Sheet): void {
  if (!s.parent) return;
  for (const wall of ["e", "w"] as const) {
    const all = s.sides.filter((d) => d.wall === wall);
    if (all.length < 2) continue;
    const at = new Map(all.map((d) => [d, comesAt(s, wall, d.key) ?? [0]]));
    /** how far along the row from the wall the wire turns: its lane beside the box, or the box */
    const far = (d: Side) => { const i = s.at[d.hook ?? d.x], n = s.rows[s.slots[d.x].row].length; return wall === "e" ? n - 1 - i : i; };
    const code = (way: string) => (way === "over" ? -1 : way === "under" ? 1 : 0);
    const pos = (d: Side, way: string): Rank => [s.slots[d.x].row, code(way), code(way) * far(d)];
    const disorder = (d: Side, way: string) => all.filter((w) => {
      const ww = sideWay(s, w);
      return w !== d && (ww !== "straight" || way !== "straight") && Math.sign(cmpRank(pos(d, way), pos(w, ww))) * Math.sign(cmpRank(at.get(d)!, at.get(w)!)) < 0;
    }).length;
    for (const d of all) {
      if (sideWay(s, d) === "straight" || (d.via !== "auto" && d.hook === undefined)) continue;
      const past = beyond(s, d);
      const cost = (way: "over" | "under") => past.reduce((n, b) => n + (way === "over" ? s.busy.up[b] : s.busy.down[b]), 0) + disorder(d, way);
      const over = cost("over"), under = cost("under");
      if (over !== under) d.via = over < under ? "over" : "under";
    }
  }
}

// ── a leaf's side wall ────────────────────────────────────────────────────

/** The hooks of one side wall of a box, each kind in the order it stands from the top. */
export interface Hooks { tails: number[]; heads: number[] }

/** Every leaf's side-wall hooks that a wire is drawn along, by `box|wall`. */
export function sideHooks(s: Sheet): Map<string, Hooks> {
  const out = new Map<string, Hooks>();
  for (const x of s.slots) {
    const b = x.beside;
    if (!b || (b.wall !== "e" && b.wall !== "w") || s.slots[b.box].kid?.sheet) continue;
    const tail = hookTail(s, x.i);
    if (tail === undefined) continue;
    const id = `${b.box}|${b.wall}`, at = out.get(id) ?? out.set(id, { tails: [], heads: [] }).get(id)!;
    (tail ? at.tails : at.heads).push(x.i);
  }
  for (const [id, at] of out) {
    const box = +id.split("|")[0], d = (lane: number) => Math.abs(s.at[lane] - s.at[box]);
    at.tails.sort((p, q) => cmpRank(nest(-1, d(p)), nest(-1, d(q))));
    at.heads.sort((p, q) => cmpRank(nest(1, d(p)), nest(1, d(q))));
  }
  return out;
}

/** How far apart a wall `span` long holds `n` wires: a step, or an even share of the wall. */
const share = (span: number, n: number) => Math.min(STEP, Math.max(0, span) / Math.max(1, n - 1));

/** The room a wall's hooks take above and below its `straight` wires, on a
 *  wall `span` long — what `gutter.ts` keeps free when it places the wires
 *  across. */
export function reserve(h: Hooks | undefined, span: number, straight: number): { above: number; below: number } {
  const tails = h?.tails.length ?? 0, heads = h?.heads.length ?? 0, step = share(span, tails + heads + straight);
  return { above: Math.floor(tails * step), below: Math.floor(heads * step) };
}

/** One side wall of a leaf: the stretch a wire may meet (`lo`..`hi`), the
 *  wires already placed across the gutter (`across`), the wires straight on
 *  to the sheet's own wall, in order (`out`, each with the room a label just
 *  outside the wall wants beside it), its hooks, and how deep a label across
 *  a straight wire stands (`deep`). */
export interface SideWall { lo: number; hi: number; across: number[]; out: { room?: number }[]; hooks?: Hooks; deep: number }

/** Every wire's place on a side wall: the wires out, about the middle of
 *  what the hooks leave free — a step apart, or wider beside a label just
 *  outside — then the hooks either side of all the straight wires. */
export function placeSideWall(w: SideWall): { out: number[]; tails: number[]; heads: number[] } {
  const keep = reserve(w.hooks, w.hi - w.lo, w.out.length);
  const lo = w.lo + keep.above, hi = w.hi - keep.below, mid = Math.round((lo + hi) / 2);
  const step = (w.out.length - 1) * STEP > hi - lo ? (hi - lo) / Math.max(1, w.out.length - 1) : STEP;
  const gaps = w.out.slice(1).map((d, i) => { const room = Math.max(d.room ?? 0, w.out[i].room ?? 0); return Math.max(step, room ? ceilTo(room / 2 + 4, GRID) : 0); });
  const wide = gaps.reduce((a, g) => a + g, 0) <= hi - lo ? gaps : gaps.map(() => step), span = wide.reduce((a, g) => a + g, 0);
  // (rounded each, and kept on the stretch: a shared step is fractional, and the last can round past its end)
  let at = mid - span / 2;
  const out = w.out.map((_, i) => { const v = Math.min(hi, Math.max(lo, Math.round(at))); at += wide[i] ?? 0; return v; });
  const n = { tails: w.hooks?.tails.length ?? 0, heads: w.hooks?.heads.length ?? 0 };
  if (!n.tails && !n.heads) return { out, tails: [], heads: [] };
  const clear = Math.max(STEP, ceilTo(w.deep / 2 + 4, GRID));
  return { out, ...stand(w.lo, w.hi, [...w.across, ...out], n, { top: clear, bottom: clear }) };
}

/**
 * Where a wall's hooks stand, given where its straight wires do: `tails`
 * upward from the highest of them, `heads` downward from the lowest — a step
 * apart, or an even share of what the wall has left on that side. `lo`..`hi`
 * is the stretch of the wall a wire may meet; `clear`: how far the nearest
 * hook keeps from the straight wires either side (a label standing across
 * one of them), where that side has room for it. With no straight wire the
 * hooks stand about the middle.
 */
export function stand(lo: number, hi: number, straight: number[], n: { tails: number; heads: number }, clear: { top: number; bottom: number } = { top: STEP, bottom: STEP }): { tails: number[]; heads: number[] } {
  const mid = Math.round((lo + hi) / 2);
  if (!straight.length) {
    // nothing straight: tails then heads, about the middle of the wall — a step apart, or as much of one as fits
    const count = n.tails + n.heads, step = share(hi - lo, count), first = mid - ((count - 1) * step) / 2;
    const all = Array.from({ length: count }, (_, i) => Math.round(first + i * step));
    return { tails: all.slice(0, n.tails), heads: all.slice(n.tails) };
  }
  // `count` places out from the straight wire at `from` toward the wall's end `end`: the first `gap` off it, the
  // rest a step apart — or the side's room shared evenly, the first no further off than `gap`
  const run = (count: number, from: number, end: number, gap: number, dir: 1 | -1): number[] => {
    if (!count) return [];
    const room = Math.max(0, (end - from) * dir), first = Math.min(gap, room / count), step = count > 1 ? Math.min(STEP, (room - first) / (count - 1)) : 0;
    return Array.from({ length: count }, (_, i) => Math.round(from + dir * (first + i * step)));
  };
  // (`run` counts outward from the straight wires; a tail's place in the list is from the top)
  const tails = run(n.tails, Math.min(...straight), lo, clear.top, -1).reverse(), heads = run(n.heads, Math.max(...straight), hi, clear.bottom, 1);
  // A wall too short to hold them in order — a straight wire at its very end,
  // fixed there by a container across the gutter — still gives every wire a
  // place of its own: the nearest free one, at the price of a crossing.
  const taken = [...straight];
  const own = (list: number[]) => list.forEach((v, i) => {
    if (!(taken.every((o) => Math.abs(o - v) >= 1) && v >= lo && v <= hi)) list[i] = nearestFree(taken, mid, lo, hi, [STEP, 8, 1]) ?? v;
    taken.push(list[i]);
  });
  own(tails); own(heads);
  return { tails, heads };
}
