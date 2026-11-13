// One container: how its slots are ordered, and — once they are — how it is
// laid out. Six stages after the order, each a function of the ones before:
//
//   ports    where on a wall each wire attaches
//   gutters  wires between neighbours on one rank
//   place    lane positions            (pulls, rows, isotonic; compact, tidy)
//   stack    flow positions, and a track per turning wire        (channel)
//   emit     rectangles and polylines

import { emit } from "./emit.js";
import { buildGutters } from "./gutters.js";
import { slotOrder, type SlotOrder } from "./order-one.js";
import { place } from "./place.js";
import { assignPorts } from "./ports.js";
import type { Sheet } from "./sheet.js";
import { stack } from "./stack.js";
import type { Box, Laid } from "./types.js";

/** How one container orders its slots, given the containers inside it. */
export function ordering(
  sheet: Sheet, box: Box | undefined, inner: (id: string) => Sheet | undefined,
  /** wire → where along this container's wall it ends up outside, 0 to 1, if a drawing has shown */
  headed: ReadonlyMap<string, number> = new Map(),
): SlotOrder {
  // how many wires leave each box straight out of its side, by wall
  const sideways = new Map<string, { low: number; high: number }>();
  for (const l of sheet.links)
    if (l.type === "side") (sideways.get(l.box) ?? sideways.set(l.box, { low: 0, high: 0 }).get(l.box)!)[l.wall]++;
  return slotOrder(
    sheet.layers, sheet.chains, sheet.links.flatMap((l) => (l.type === "beside" ? [[l.a, l.b] as const] : [])),
    // a child container's wall port, as a fraction of its wall
    (s, wire) => (s.box?.group ? inner(s.id)?.wallFraction(wire) ?? 0 : 0),
    (s) => headed.get(s.id),
    !!box?.title,
    sideways,
    sheet.g.gap.lane,
  );
}

/** Lay out one container whose slots are in order and whose children have their sizes. */
export function layOut(
  sheet: Sheet, box: Box | undefined,
  /** wire → where it arrives from outside, if an earlier round found out */
  approach: ReadonlyMap<string, number> = new Map(),
): Laid {
  sheet.resize();
  const ports = assignPorts(sheet);
  const gutters = buildGutters(sheet);
  place(sheet, ports, gutters, box?.title, approach);
  return emit(sheet, ports, gutters, stack(sheet, ports, box?.minW ?? 0, box?.title), approach);
}
