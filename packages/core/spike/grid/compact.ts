// Compact: close gaps nothing is holding open.
//
// Settling leaves every wire as straight as its neighbours allow — and two
// slots that only follow each other wherever the first sweep happened to
// leave them, however far from the rest of their row. Here a box and whatever
// its straight wires tie it to move as one toward a row-mate they stand
// further from than they need to, as far as makes the wires out of the group
// shorter in sum and no less balanced. The sweeps that follow put parents
// back over the children that moved.

import type { Ports } from "./ports.js";
import type { Rows } from "./rows.js";
import type { Sheet } from "./sheet.js";
import type { Slot, Wire } from "./types.js";

export function compact(sh: Sheet, ports: Ports, rows: Rows): void {
  interface Hop { u: Slot; v: Slot; wire: Wire }
  const hopsOf = new Map<Slot, Hop[]>();
  for (const c of sh.chains)
    c.path.slice(1).forEach((v, i) => {
      const hop = { u: c.path[i], v, wire: c.wire };
      for (const s of [hop.u, hop.v]) (hopsOf.get(s) ?? hopsOf.set(s, []).get(s)!).push(hop);
    });
  // Straight as settling means it: a plain box counts by its middle, since
  // its ports have not yet gone to meet their wires (`pulls.ts`).
  const lane = (s: Slot, wire: Wire, face: "start" | "end") =>
    s.kind === "box" && !s.box!.group ? s.pos + Math.round(sh.ax.flowFace(s.box!) / 2) : ports.lane(s, wire, face);
  const off = (h: Hop) => lane(h.u, h.wire, "end") - lane(h.v, h.wire, "start");
  const fixed = new Set([...(sh.g.aligned ?? []), ...(sh.g.columns ?? [])].flat().map((id) => sh.slotOf(id)));

  /** How far `m` could move that way before it crowds a neighbour outside the group. */
  const reach = (m: Slot, dir: 1 | -1, group: ReadonlySet<Slot>): number => {
    const row = rows.of(m), n = row[row.indexOf(m) + dir];
    if (!n || group.has(n)) return Infinity;
    return dir < 0 ? m.pos - (n.pos + n.lsize + rows.gapAfter(n, m)) : n.pos - (m.pos + m.lsize + rows.gapAfter(m, n));
  };
  for (const dir of [-1, 1] as const)
    for (const { slots: row } of sh.layers)
      for (const s of dir < 0 ? row : [...row].reverse()) {
        if (s.kind !== "box") continue;
        const group = new Set<Slot>([s]);
        for (const x of group)
          for (const h of hopsOf.get(x) ?? []) if (Math.abs(off(h)) <= 1) group.add(h.u === x ? h.v : h.u); // straight, to the pixel settling rounds to
        const members = [...group];
        if (members.some((m) => fixed.has(m))) continue;
        const room = Math.min(...members.map((m) => reach(m, dir, group)));
        if (!(reach(s, dir, group) > 0) || !(room > 0) || room === Infinity) continue;
        // each wire out of the group, as how far the group is from running it straight
        const out = members.flatMap((m) => (hopsOf.get(m) ?? []).filter((h) => !group.has(h.u === m ? h.v : h.u)).map((h) => (h.u === m ? off(h) : -off(h))));
        const strain = (d: number) => out.reduce((a, o) => a + Math.abs(o + dir * d), 0);
        const lean = (d: number) => out.reduce((a, o) => a + (o + dir * d) ** 2, 0);
        const stops = [room, ...out.map((o) => -dir * o).filter((d) => d > 0 && d < room)];
        const d = stops.reduce((best, x) => (strain(x) < strain(best) || (strain(x) === strain(best) && x > best) ? x : best));
        // a group no wire leaves has nothing to say about where it stands: it closes up, toward the low side
        if ((strain(d) < strain(0) && lean(d) <= lean(0)) || (!out.length && dir < 0)) for (const m of members) m.pos += dir * d;
      }
}
