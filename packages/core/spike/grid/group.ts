// One container, laid out: seven stages, each a function of the ones before.
//
//   draft    what each wire does here, the layers, each wire's way through
//   order    where pass-through wires sit among the boxes
//   ports    where on a wall each wire attaches
//   gutters  wires between neighbours on one rank
//   place    lane positions                                (isotonic.ts)
//   stack    flow positions, and a track per turning wire  (channel.ts)
//   emit     rectangles and polylines

import { emit } from "./emit.js";
import { buildGutters } from "./gutters.js";
import { orderSlots } from "./order-slots.js";
import { place } from "./place.js";
import { assignPorts } from "./ports.js";
import { draft } from "./sheet.js";
import { stack } from "./stack.js";
import type { Box, Group, Laid, Route, Wire } from "./types.js";

export function layoutGroup(
  gid: string, g: Group, box: Box | undefined, wires: readonly Wire[],
  routes: ReadonlyMap<string, Route>, ranks: ReadonlyMap<string, number>, laid: ReadonlyMap<string, Laid>,
  /** wire → the lane it arrives on from outside, if a first pass found out */
  approach: ReadonlyMap<string, number> = new Map(),
): Laid {
  const sheet = draft(gid, g, wires, routes, ranks, laid);
  orderSlots(
    sheet.layers, sheet.chains, sheet.links.flatMap((l) => (l.type === "beside" ? [[l.a, l.b] as const] : [])),
    // a child container's wall port, as a fraction of its wall
    (s, wire) => {
      const port = s.box && sheet.childPort(s.box, wire);
      return port ? sheet.ax.laneOf(port) / (sheet.ax.lsize(s.box!) + 1) : 0;
    },
  );
  const ports = assignPorts(sheet);
  const gutters = buildGutters(sheet);
  place(sheet, ports, gutters, box?.title, approach);
  return emit(sheet, ports, gutters, stack(sheet, ports, box?.minW ?? 0, box?.title));
}
