// One container, laid out: the stages after its slots are in order
// (`sheet.ts` drafts them, `order-all.ts` orders every container's together).
//
//   ports    where on a wall each wire attaches
//   gutters  wires between neighbours on one rank
//   place    lane positions            (pulls, rows, isotonic; then tidy)
//   stack    flow positions, and a track per turning wire        (channel)
//   emit     rectangles and polylines

import { emit } from "./emit.js";
import { buildGutters } from "./gutters.js";
import { slotOrder, type SlotOrder } from "./order-slots.js";
import { place } from "./place.js";
import { assignPorts } from "./ports.js";
import type { Sheet } from "./sheet.js";
import { stack } from "./stack.js";
import type { Box, Laid } from "./types.js";

/** How many wires leave each box straight out of its side, by wall. */
function sideways(sh: Sheet): Map<string, { low: number; high: number }> {
  const out = new Map<string, { low: number; high: number }>();
  for (const l of sh.links)
    if (l.type === "side") (out.get(l.box) ?? out.set(l.box, { low: 0, high: 0 }).get(l.box)!)[l.wall]++;
  return out;
}

/** How one container orders its slots, given the containers inside it. */
export function ordering(
  sheet: Sheet, box: Box | undefined, inner: (id: string) => Sheet | undefined,
  /** wire → the lane of its far end, if an earlier pass found out */
  heading: ReadonlyMap<string, number> = new Map(),
  /** this container's size along its lane axis on that pass */
  extent = 0,
): SlotOrder {
  return slotOrder(
    sheet.layers, sheet.chains, sheet.links.flatMap((l) => (l.type === "beside" ? [[l.a, l.b] as const] : [])),
    // a child container's wall port, as a fraction of its wall
    (s, wire) => (s.box?.group ? inner(s.id)?.wallFraction(wire) ?? 0 : 0),
    // where a wire through the wall ends up, as a fraction along the wall —
    // for its port and for every rank it passes on the way there
    (s) => (s.kind !== "box" && heading.has(s.id) && extent ? heading.get(s.id)! / extent : undefined),
    !!box?.title,
    sideways(sheet),
  );
}

/** Lay out one container whose slots are already in order. */
export function layoutGroup(
  sheet: Sheet, box: Box | undefined,
  /** wire → the lane it arrives on from outside, if a first pass found out */
  approach: ReadonlyMap<string, number> = new Map(),
  /** wire → the lane of its far end, likewise */
  heading: ReadonlyMap<string, number> = new Map(),
): Laid {
  sheet.resize();
  const ports = assignPorts(sheet);
  const gutters = buildGutters(sheet);
  place(sheet, ports, gutters, box?.title, approach);
  return emit(sheet, ports, gutters, stack(sheet, ports, box?.minW ?? 0, box?.title), heading, approach);
}
