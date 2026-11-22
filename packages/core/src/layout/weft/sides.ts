// Ports on a leaf's east or west wall (REQUIREMENTS §5.4): one allocator for
// every wire that meets it, as `ports.ts` is for a north or south wall.
//
// Three kinds of wire meet a side wall, and they stand in this order from
// the top of it:
//
//   tails     a hook whose lane comes down to the wall's level from the row
//             above — the wire arrives along the lane and turns in. The
//             nearest lane highest.
//   straight  a wire straight out: across the gutter to a neighbour, or on
//             to the sheet's own wall.
//   heads     a hook whose lane goes on down from the wall's level — the
//             wire turns out and leaves along the lane. The nearest lane
//             lowest.
//
// In that order no wire of the wall crosses another: a lane that comes down
// stops above every wire below it, a lane that goes down starts below every
// wire above it, and of two hooks of one kind the nearer lane is nested
// inside the further one's stretch. So a side wall takes any number of wires
// of any kind, as a north or south wall does — a step apart, or, when the
// wall is too short for them all, sharing it out evenly as `ports.ts` does.
import { turn } from "./frame.js";
import { beyond, hookRank, sideWay } from "./sheet.js";
import type { Sheet, Side, Wall } from "./types.js";

const STEP = 16;

/** The hooks of one side wall of a box, each kind in the order it stands from the top. */
export interface Hooks { tails: number[]; heads: number[] }

/** Every leaf's side-wall hooks, by `box|wall`. */
export function sideHooks(s: Sheet, hooks: { box: number; wall: string; lane: number; tail: boolean }[]): Map<string, Hooks> {
  const out = new Map<string, Hooks>();
  const far = (h: { box: number; lane: number }) => Math.abs(s.at[h.lane] - s.at[h.box]);
  for (const h of hooks) {
    if ((h.wall !== "e" && h.wall !== "w") || s.slots[h.box].kid?.sheet) continue;
    const at = out.get(`${h.box}|${h.wall}`) ?? out.set(`${h.box}|${h.wall}`, { tails: [], heads: [] }).get(`${h.box}|${h.wall}`)!;
    (h.tail ? at.tails : at.heads).push(h.lane);
  }
  for (const [id, at] of out) {
    const box = +id.split("|")[0];
    at.tails.sort((p, q) => far({ box, lane: p }) - far({ box, lane: q }) || p - q);
    at.heads.sort((p, q) => far({ box, lane: q }) - far({ box, lane: p }) || p - q);
  }
  return out;
}

/** How far apart a wall `span` long holds `n` wires: a step, or an even share of the wall. */
const share = (span: number, n: number) => Math.min(STEP, Math.max(0, span) / Math.max(1, n - 1));

/** The room a wall's hooks take above and below its `straight` wires, on a wall `span` long. */
export function reserve(h: Hooks | undefined, span: number, straight: number): { above: number; below: number } {
  const tails = h?.tails.length ?? 0, heads = h?.heads.length ?? 0, step = share(span, tails + heads + straight);
  return { above: Math.floor(tails * step), below: Math.floor(heads * step) };
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
    const count = n.tails + n.heads, step = Math.min(STEP, (hi - lo) / Math.max(1, count - 1)), first = mid - ((count - 1) * step) / 2;
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
    if (taken.every((o) => Math.abs(o - v) >= 1) && v >= lo && v <= hi) { taken.push(v); return; }
    for (const gap of [STEP, 8, 1]) {
      let found: number | undefined;
      for (let d = 0; d <= hi - lo && found === undefined; d += gap === 1 ? 1 : 8) found = [mid - d, mid + d].find((c) => c >= lo && c <= hi && taken.every((o) => Math.abs(o - c) >= gap));
      if (found !== undefined) { list[i] = found; break; }
    }
    taken.push(list[i]);
  });
  own(tails); own(heads);
  return { tails, heads };
}

/** Where the wire `key` stands among the wires through this sheet's wall
 *  `wall`, where that wall is a side wall outside — top to bottom, as the
 *  sheet outside has it. A wall the inside has to order this way is an east
 *  or west one, or, where the sheet flows the other way from its parent, a
 *  north or south one (its ports, ordered last by `order.ts`). Read off the
 *  order of the rows alone, so it is good once that order is final.
 *
 *  Where the wall lies along a row out there, the wire stands where its far
 *  end does in that row. Where it is a side wall out there too, the wire
 *  either goes straight on (across a gutter, or through the next wall) or is
 *  hooked round this container to a lane beside it — and then the order is
 *  this file's, the container being the box: lanes that come down to the
 *  wall first, the nearest highest; lanes that go on down last, the nearest
 *  lowest. A wire that goes straight on through the wall out there stands
 *  where the wall beyond that one has it; one straight across the gutter to
 *  a neighbour, by the order the wires across that gutter are declared in —
 *  which the neighbour's inside reads too, so the two walls agree. Undefined
 *  at the root, and for a north or south wall that stays one outside. */
/** past every place a wire can have in a row (a lane round the end of the wall, out there) */
const BEYOND = 1e7;
export function comesAt(s: Sheet, wall: Wall, key: string): number | undefined {
  const p = s.parent;
  if (!p) return undefined;
  const self = s.self!, row = p.slots[self].row, out = turn(wall, s.dir, p.dir);
  if (out === "n" || out === "s") {
    if (wall === "n" || wall === "s") return undefined;
    const north = out === "n";
    const link = p.chan[north ? row - 1 : row].find((l) => (north ? l.down : l.up) === self && l.key === key);
    if (link) return p.at[north ? link.up : link.down];
    // …or hooked round the container out there: at the end of the wall its lane stands beside
    const lane = p.slots.find((x) => x.beside?.box === self && x.key === key && x.beside.wall === out);
    return lane ? hookRank(p, lane.i, BEYOND) : undefined;
  }
  // hooked round this container out there: by a lane of its own (a hook), or by one of those beside it that
  // take its wires over or under the row (`sideLanes`)
  const round = p.sides.find((d) => d.x === self && d.key === key && d.wall === out), mine = round && sideLanes(p).get(round);
  const lane = mine ?? p.slots.find((x) => x.beside?.box === self && x.key === key && x.beside.wall === out)?.i;
  // straight on through the wall out there too: where it stands is the next wall's to say
  if (lane === undefined && round) return sideWay(p, round) === "straight" ? comesAt(p, out, key) ?? 0 : 0;
  // straight across the gutter to a neighbour: whose inside orders its facing wall by this same rule, so
  // the two agree on the one thing both know — the order the wires are declared in out there
  if (lane === undefined) { const i = p.flats.findIndex((f) => f.key === key && f.straight && (out === "e" ? f.a === self : f.b === self)); return i < 0 ? 0 : i; }
  const tail = mine !== undefined ? sideWay(p, round!) === "over" : !!p.slots[lane].beside!.tail;
  const far = Math.abs(p.at[lane] - p.at[self]);
  return tail ? -1e6 + far : 1e6 - far;
}

/** The lane each wire takes that leaves its box by a side wall and goes over
 *  or under the row from beside it (`Side.hook`): `laneOrder`, kept on the
 *  sheet by `order.ts` once the order is final, outermost first. Asked
 *  before that, it is an error — what it reads would not yet be settled. */
export function sideLanes(s: Sheet): Map<Side, number> {
  if (!s.lanes) throw new Error(`weft: the lanes of ${s.cell.id || "the root"} were asked before the order was final`);
  return s.lanes;
}

/** Which lane each wire round a row-mate takes. Several such wires of one
 *  box, out of one wall and the same way round, have a lane each, and which
 *  wire has which is free: nothing else of the sheet reads it. So they take
 *  them in the order the sheet outside has the wires (`comesAt`), which is
 *  the order they then leave this sheet's wall in — over the row, the wire
 *  that stands highest out there has the nearest lane and the nearest track;
 *  under it, the lowest. Nested like that they cross neither each other here
 *  nor on the way from the wall to their lanes outside.
 * Read off the order of this sheet and the sheets outside it, so worked out
 *  when they are all final (`order.ts`). */
export function laneOrder(s: Sheet): Map<Side, number> {
  const out = new Map<Side, number>(), groups = new Map<string, Side[]>();
  for (const d of s.sides) {
    const way = sideWay(s, d);
    if (d.hook === undefined || way === "straight") continue;
    const id = `${d.x}|${d.wall}|${way}`;
    (groups.get(id) ?? groups.set(id, []).get(id)!).push(d);
  }
  for (const [id, group] of groups) {
    const near = group.map((d) => d.hook!).sort((a, b) => Math.abs(s.at[a] - s.at[group[0].x]) - Math.abs(s.at[b] - s.at[group[0].x]));
    const at = new Map(group.map((d) => [d, comesAt(s, d.wall, d.key) ?? 0])), over = id.endsWith("over");
    [...group].sort((p, q) => (over ? at.get(p)! - at.get(q)! : at.get(q)! - at.get(p)!)).forEach((d, i) => out.set(d, near[i]));
  }
  return out;
}

/** Which way round its row-mates each wire goes that has row-mates between
 *  its box and the sheet's side wall: over the row or under it. The sheet
 *  first chose by how busy each way is (`sideWay`), not knowing the wall
 *  outside; that order comes in at this sheet's wall as well, and a wire on
 *  the wrong side of another there crosses it between the wall and the
 *  sheet outside. So once the order is final the choice is made again, over
 *  the crossings of both: the wires each way would cross inside, and the
 *  wires of the same wall it would then stand out of order with. Where it
 *  stands is known from the order alone: over the row above it and under it
 *  below, and of two that go one way round, the one that turns nearer the
 *  wall nearer the row (it nests inside the other). A tie keeps the first
 *  choice; a container's way, set by its insides, is left as it is unless
 *  the wire was asked for that side. Asked of every sheet outermost first,
 *  before anything reads `sideLanes`. */
export function settleWays(s: Sheet): void {
  if (!s.parent) return;
  for (const wall of ["e", "w"] as const) {
    const all = s.sides.filter((d) => d.wall === wall);
    if (all.length < 2) continue;
    const at = new Map(all.map((d) => [d, comesAt(s, wall, d.key) ?? 0]));
    /** how far along the row from the wall the wire turns: its lane beside the box, or the box */
    const far = (d: Side) => { const i = s.at[d.hook ?? d.x], n = s.rows[s.slots[d.x].row].length; return wall === "e" ? n - 1 - i : i; };
    /** where the wire meets the wall, top to bottom: by row, then over, across or under it, then nested */
    const pos = (d: Side, way: string) => 4 * s.slots[d.x].row + (way === "over" ? -1 - far(d) / 1e4 : way === "under" ? 1 + far(d) / 1e4 : 0);
    const out = (d: Side, way: string) => all.filter((w) => {
      if (w === d) return false;
      const ww = sideWay(s, w);
      return ww !== "straight" || way !== "straight" ? (pos(d, way) - pos(w, ww)) * (at.get(d)! - at.get(w)!) < 0 : false;
    }).length;
    for (const d of all) {
      if (sideWay(s, d) === "straight" || (d.via !== "auto" && d.hook === undefined)) continue;
      const past = beyond(s, d);
      const cost = (way: "over" | "under") => past.reduce((n, b) => n + (way === "over" ? s.busy.up[b] : s.busy.down[b]), 0) + out(d, way);
      const over = cost("over"), under = cost("under");
      if (over !== under) d.via = over < under ? "over" : "under";
    }
  }
}
