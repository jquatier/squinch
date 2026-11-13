// A wire through a container's side wall, from a box that is not the last
// in its row: it has to get past the boxes between. It turns into the
// channel after its rank or the one before it — whichever fewer wires
// already use on that stretch — and runs along it to the wall.

import type { Ports } from "./ports.js";
import type { Sheet } from "./sheet.js";
import { STUB, type Face, type Link } from "./types.js";

export type SideLink = Extract<Link, { type: "side" }>;

export interface SideRun {
  /** Which channel: the one after the rank (`end`) or before it (`start`). */
  face: Face;
  /** The lane it runs along the flow on, from the box to that channel. */
  lane: number;
  /** Where it leaves a child container's own side wall, if it does: the
   *  wall's lane and the flow offset inside the child. */
  from?: { lane: number; flow: number };
}

/** Which channel a side link turns into. */
export function sideFace(sh: Sheet, l: SideLink): Face {
  const { layers, chains } = sh;
  const s = sh.slotOf(l.box), row = layers[sh.layerOf(s)].slots, i = row.indexOf(s);
  const between = new Set(l.wall === "low" ? row.slice(0, i) : row.slice(i + 1));
  let after = 0, before = 0;
  for (const c of chains)
    c.path.forEach((x, k) => {
      if (!between.has(x)) return;
      if (c.path[k + 1]) after++;
      if (c.path[k - 1]) before++;
    });
  // outward wires turn after the rank and inward ones before it, as the flow
  // runs — unless the other channel is strictly quieter
  return l.outward ? (before < after ? "start" : "end") : after < before ? "end" : "start";
}

export function sideRun(sh: Sheet, ports: Ports, l: SideLink): SideRun {
  const { ax } = sh;
  const s = sh.slotOf(l.box), face = sideFace(sh, l);
  const cp = sh.childPort(s.box!, l.wire);
  if (cp && (ax.laneOf(cp) <= 0 || ax.laneOf(cp) >= s.lsize)) {
    // out of the child's side wall: a stub into the gutter beside it, never along the wall
    const wall = ax.laneOf(cp) <= 0 ? s.pos : s.pos + s.lsize;
    return { face, lane: wall + (ax.laneOf(cp) <= 0 ? -STUB : STUB), from: { lane: wall, flow: ax.flowOf(cp) } };
  }
  return { face, lane: ports.lane(s, l.wire, face) };
}
