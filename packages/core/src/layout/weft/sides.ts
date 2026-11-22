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
// of any kind, as a north or south wall does — closer than a step apart only
// when the wall is too short for them all.
import type { Sheet } from "./types.js";

const STEP = 16;

/** A hook on a side wall: its lane, and whether that lane runs up from the
 *  wall's level (`tail`) or down from it. */
export interface Hooked { lane: number; tail: boolean }

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

/** The room a wall's hooks take above and below its straight wires. */
export const reserve = (h: Hooks | undefined): { above: number; below: number } => ({ above: (h?.tails.length ?? 0) * STEP, below: (h?.heads.length ?? 0) * STEP });

/**
 * Where a wall's hooks stand, given where its straight wires do: `tails`
 * upward from the highest of them, `heads` downward from the lowest — a step
 * apart, or as much of one as the wall has. `lo`..`hi` is the stretch of the
 * wall a wire may meet; `clear`: how far the nearest hook keeps from the
 * straight wires either side (a label standing across one of them). With no
 * straight wire the hooks stand about the middle.
 */
export function stand(lo: number, hi: number, straight: number[], n: { tails: number; heads: number }, clear: { top: number; bottom: number } = { top: STEP, bottom: STEP }): { tails: number[]; heads: number[] } {
  const mid = Math.round((lo + hi) / 2);
  if (!straight.length) {
    // nothing straight: tails then heads, about the middle of the wall — a step apart, or as much of one as fits
    const count = n.tails + n.heads, step = Math.min(STEP, (hi - lo) / Math.max(1, count - 1)), first = mid - ((count - 1) * step) / 2;
    const all = Array.from({ length: count }, (_, i) => Math.round(first + i * step));
    return { tails: all.slice(0, n.tails), heads: all.slice(n.tails) };
  }
  const top = Math.min(...straight) - clear.top, bottom = Math.max(...straight) + clear.bottom;
  // `count` places from `from`, away from the straight wires, a step apart — or closer, to stay on the wall
  const run = (count: number, from: number, end: number, dir: 1 | -1): number[] => {
    if (!count) return [];
    const room = (end - from) * dir;
    const step = (count - 1) * STEP <= room ? STEP : Math.max(0, room) / Math.max(1, count - 1);
    const start = room < 0 ? end : from; // no room at all on that side: every one at the wall's end
    return Array.from({ length: count }, (_, i) => Math.round(start + dir * i * step));
  };
  // (`run` counts outward from the straight wires; a tail's place in the list is from the top)
  const tails = run(n.tails, top, lo, -1).reverse(), heads = run(n.heads, bottom, hi, 1);
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
