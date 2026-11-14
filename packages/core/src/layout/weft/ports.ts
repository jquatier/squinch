// Where each wire meets a leaf's north or south wall (REQUIREMENTS §5.4).
//
// Boxes are placed first, on their centres; ports then go to meet the wires.
// On one wall the ports stand in the order that keeps their wires from
// crossing — the order of their far ends — and evenly about the middle,
// except that a port slides along the wall to where its wire runs straight:
// level with a lane or a container's port, or, between two leaves, at the
// middle of whichever wall has fewer wires to place. Sliding never changes
// the order and never brings two ports closer than 16 px where the wall has
// room, or nearer than 8 px to a corner.
//
// One channel at a time: the south walls of the row above it and the north
// walls of the row below.
import { ceilTo, floorTo, GRID, snap } from "./frame.js";
import { project } from "./project.js";
import type { Sheet } from "./types.js";

/** An end of a wire on a leaf's wall. */
export interface End {
  /** `slot|wall|key` — wires of one bundle share the port */
  id: string;
  slot: number; wall: "n" | "s";
  /** the far end, for the order along the wall */
  far: number;
  /** the other end of a link between two walls, if that end is a leaf's too */
  mate?: End;
  /** where the port would let the wire run straight, if anywhere */
  meet?: number;
  at: number;
}

export interface Wallspace { lo: number; hi: number; mid: number }

/** The stretch of a leaf's north or south wall a wire may land on, on the grid. */
export function wallspace(s: Sheet, slot: number, u: number, w: number): Wallspace {
  const kid = s.slots[slot].kid!, left = u - w / 2, face = Math.min(w, kid.faceU ?? w);
  const lo = ceilTo(left + 8, GRID), hi = floorTo(left + face - 8, GRID), mid = snap(left + face / 2);
  return lo <= hi ? { lo, hi, mid: Math.max(lo, Math.min(hi, mid)) } : { lo: mid, hi: mid, mid };
}

/** Even places for `n` ports about the middle of a wall. */
function even(n: number, space: Wallspace): number[] {
  const room = space.hi - space.lo;
  const step = (n - 1) * 16 > room ? room / Math.max(1, n - 1) : Math.max(16, Math.min(48, floorTo(room / n, 16)));
  return Array.from({ length: n }, (_, i) => space.mid + (i - (n - 1) / 2) * step);
}

/** Place the ports of one wall: `ends` in wall order, each at its `meet` or its even place. */
export function settle(ends: End[], space: Wallspace): void {
  const n = ends.length, spread = even(n, space);
  const tight = (n - 1) * 16 > space.hi - space.lo;
  const gap = tight ? (space.hi - space.lo) / Math.max(1, n - 1) : 16;
  const at = project(ends.map((e, i) => e.meet ?? spread[i]), ends.map((e) => (e.meet === undefined ? 1 : 4)),
    ends.slice(1).map((_, i) => ({ left: i, right: i + 1, gap })));
  // within the wall: push in from the low corner, then from the high one
  for (let i = 0; i < n; i++) at[i] = Math.max(at[i], i ? at[i - 1] + gap : space.lo);
  for (let i = n - 1; i >= 0; i--) at[i] = Math.min(at[i], i < n - 1 ? at[i + 1] - gap : space.hi);
  // a port that reached the place its wire runs straight stands exactly there, on the grid or not
  ends.forEach((e, i) => { e.at = e.meet !== undefined && Math.abs(at[i] - e.meet) < 0.5 ? e.meet : tight ? Math.round(at[i]) : snap(at[i]); });
}

/** Ports for the walls facing one channel. `walls`: each leaf wall's ends,
 *  unsorted. Ends whose `mate` is on another leaf's wall are brought level
 *  where both walls allow. */
export function meetAcross(walls: Map<string, { ends: End[]; space: Wallspace }>): void {
  const sorted = [...walls.values()];
  for (const w of sorted) w.ends.sort((p, q) => p.far - q.far);
  const solve = () => { for (const w of sorted) settle(w.ends, w.space); };
  const spaceOf = (e: End) => walls.get(`${e.slot}|${e.wall}`)!.space;
  // a link between two leaves runs straight where their walls overlap: at
  // the middle of the wall with fewer wires, so that one stays centred
  for (const w of sorted)
    for (const e of w.ends) {
      if (!e.mate || e.wall !== "s") continue;
      const a = spaceOf(e), b = spaceOf(e.mate), lo = Math.max(a.lo, b.lo), hi = Math.min(a.hi, b.hi);
      if (lo > hi) continue;
      const mine = w.ends.length, theirs = walls.get(`${e.mate.slot}|${e.mate.wall}`)!.ends.length;
      e.meet = e.mate.meet = Math.max(lo, Math.min(hi, theirs <= mine ? b.mid : a.mid));
    }
  solve();
  // where crowding kept two ends apart, let each in turn come to where the other landed
  for (const from of ["s", "n"] as const) {
    let again = false;
    for (const w of sorted)
      for (const e of w.ends)
        if (e.mate && e.wall === from && e.at !== e.mate.at && e.mate.at >= spaceOf(e).lo && e.mate.at <= spaceOf(e).hi) { e.meet = e.mate.at; again = true; }
    if (again) solve();
  }
}
