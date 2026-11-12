// Ports: where on a box's wall each wire attaches.
//
// A container's port is wherever its own inside put it. Every other port is
// one of n evenly spaced along the wall, in the order that keeps the wires
// leaving it from crossing each other.

import type { Sheet } from "./sheet.js";
import { CORNER, type Face, type Slot, type Wire } from "./types.js";

export interface Ports {
  /** Lane coordinate where `wire` meets `s` on its `face`. */
  lane(s: Slot, wire: Wire, face: Face): number;
  /** How many wires share that wall of `s`. */
  crowd(s: Slot, face: Face): number;
  /** Move a plain box's port by `d` along its wall, if it stays clear of the
   *  corners and of its neighbours. */
  slide(s: Slot, wire: Wire, face: Face, d: number): boolean;
}

const FAR = 1e6;
/** The port a wire uses: its own, or its bundle's. */
const portId = (w: Wire) => w.bundle ?? w.id;

export function assignPorts(sh: Sheet): Ports {
  const { ax, layers, chains, links, wires } = sh;
  const at = new Map<Slot, number>();
  layers.forEach((layer) => layer.slots.forEach((s, i) => at.set(s, i)));

  // who wants a port on which wall, and a key that sorts them along it
  const wanted = new Map<string, { wire: Wire; key: number }[]>(); // `${box}|${face}`
  const want = (box: string, face: Face, wire: Wire, key: number) => {
    if (sh.childPort(sh.slotOf(box).box!, wire)) return;
    const k = `${box}|${face}`;
    const list = wanted.get(k) ?? wanted.set(k, []).get(k)!;
    if (!list.some((p) => portId(p.wire) === portId(wire))) list.push({ wire, key });
  };
  for (const c of chains) {
    const top = c.path[0], bottom = c.path[c.path.length - 1];
    if (top.kind === "box") want(top.id, "end", c.wire, at.get(c.path[1])!);
    if (bottom.kind === "box") want(bottom.id, "start", c.wire, at.get(c.path[c.path.length - 2])!);
  }
  for (const l of links) {
    if (l.type === "around") {
      // nearer partner takes the port nearer that side, so the runs nest
      const ia = at.get(sh.slotOf(l.a))!, ib = at.get(sh.slotOf(l.b))!;
      want(l.a, "end", l.wire, ib < ia ? -FAR - ib : FAR - ib);
      want(l.b, "end", l.wire, ia < ib ? -FAR - ia : FAR - ia);
    } else if (l.type === "side" && !sh.outermost(l.box, l.wall)) {
      want(l.box, l.outward ? "end" : "start", l.wire, l.wall === "low" ? -2 * FAR : 2 * FAR);
    }
  }

  const offset = new Map<string, number>(); // `${box}|${face}|${port}` → lane offset from the box's start
  for (const [k, list] of wanted) {
    const box = sh.slotOf(k.split("|")[0]).box!;
    const order = [...list].sort((p, q) => p.key - q.key || wires.indexOf(p.wire) - wires.indexOf(q.wire));
    order.forEach((p, i) => offset.set(`${k}|${portId(p.wire)}`, Math.round((ax.flowFace(box) * (i + 1)) / (order.length + 1))));
  }
  const offsetOn = (s: Slot, wire: Wire, face: Face): number => {
    if (s.kind !== "box") return Math.round(s.lsize / 2);
    const cp = sh.childPort(s.box!, wire);
    if (cp) return ax.laneOf(cp);
    return offset.get(`${s.id}|${face}|${portId(wire)}`) ?? Math.round(ax.flowFace(s.box!) / 2);
  };

  return {
    lane: (s, wire, face) => s.pos + offsetOn(s, wire, face),
    crowd: (s, face) => (s.kind === "box" ? wanted.get(`${s.id}|${face}`)?.length ?? 1 : 1),
    slide: (s, wire, face, d) => {
      const key = `${s.id}|${face}|${portId(wire)}`;
      if (s.kind !== "box" || !offset.has(key)) return false; // a container's port is its inside's
      const to = offset.get(key)! + d;
      const others = (wanted.get(`${s.id}|${face}`) ?? []).filter((p) => portId(p.wire) !== portId(wire))
        .map((p) => offset.get(`${s.id}|${face}|${portId(p.wire)}`)!);
      if (to < CORNER || to > ax.flowFace(s.box!) - CORNER || others.some((o) => Math.abs(o - to) < 12)) return false;
      offset.set(key, to);
      return true;
    },
  };
}
