// Pulls: how hard each wire draws its two ends toward a straight line.
//
// The weight depends on what the wire joins — a wire passing through several
// ranks should not wobble, a wall port only follows — on how crowded the far
// wall is — one of eleven wires leaving a hub cannot be straight anyway, so
// it gives way to the end it has to itself — and on whether the far end goes
// on anywhere: a stage with a successor and a side lookup stays in line with
// the successor, and the lookup hangs beside it. Two equal children still
// share their parent evenly.

import type { Ports } from "./ports.js";
import type { Sheet } from "./sheet.js";
import type { Slot } from "./types.js";

/** `other` draws this slot to where `mine` (an offset into it) meets `theirs`. */
export interface Pull {
  other: Slot; mine: number; theirs: number; weight: number;
  /** Not a wire: the author aligned the two (`align`). */
  aligned?: boolean;
}

const ALIGN = 24; // boxes the author aligned pull this hard on each other
const WEIGHT = { port: 0.25, passes: 8, pass: 2, boxes: 3 };

export function pullsOf(sh: Sheet, ports: Ports): Map<Slot, Pull[]> {
  const { ax, g, chains, links } = sh;
  const degree = new Map<string, number>();
  for (const l of links)
    for (const id of l.type === "chain" ? [l.top, l.bottom] : l.type === "side" ? [l.box] : [l.a, l.b])
      degree.set(id, (degree.get(id) ?? 0) + 1);
  const deadEnd = (s: Slot) => (s.kind === "box" && degree.get(s.id) === 1 ? 0.5 : 1);

  const pulls = new Map<Slot, Pull[]>();
  const on = (s: Slot) => pulls.get(s) ?? pulls.set(s, []).get(s)!;
  for (const c of chains)
    for (let i = 0; i + 1 < c.path.length; i++) {
      const u = c.path[i], v = c.path[i + 1];
      if (pulls.get(u)?.some((x) => x.other === v)) continue; // a bundle's shared stretch pulls once
      // Boxes line up on their centres; the ports then go to meet the wires
      // (`ports.meet`). Lining a box up on one of two evenly spaced ports
      // would set a chain a third of a wall off its own baseline. A
      // container's port is where its inside put it, and is followed as is.
      const centre = (s: Slot, face: "start" | "end") =>
        s.kind === "box" && !s.box!.group ? Math.round(ax.flowFace(s.box!) / 2) : ports.lane(s, c.wire, face) - s.pos;
      const ou = centre(u, "end"), ov = centre(v, "start");
      const base = u.kind === "port" || v.kind === "port" ? WEIGHT.port
        : u.kind === "pass" && v.kind === "pass" ? WEIGHT.passes : u.kind === "pass" || v.kind === "pass" ? WEIGHT.pass : WEIGHT.boxes;
      const boxes = u.kind === "box" && v.kind === "box";
      on(u).push({ other: v, mine: ou, theirs: ov, weight: (base * (boxes ? deadEnd(v) : 1)) / ports.crowd(v, "start") });
      on(v).push({ other: u, mine: ov, theirs: ou, weight: base / ports.crowd(u, "end") });
    }
  for (const set of g.aligned ?? [])
    for (let i = 0; i + 1 < set.length; i++) {
      const a = sh.slotOf(set[i]), b = sh.slotOf(set[i + 1]);
      on(a).push({ other: b, mine: a.lsize / 2, theirs: b.lsize / 2, weight: ALIGN, aligned: true });
      on(b).push({ other: a, mine: b.lsize / 2, theirs: a.lsize / 2, weight: ALIGN, aligned: true });
    }
  return pulls;
}
