// Ports: where on a box's wall each wire attaches.
//
// A container's port is wherever its own inside put it. Every other port is
// one of n evenly spaced along the wall, in the order that keeps the wires
// leaving it from crossing each other.

import type { Sheet } from "./sheet.js";
import { spread } from "./isotonic.js";
import { CORNER, type Face, type Slot, type Wire } from "./types.js";

const PORT_GAP = 16; // two ports on one wall keep this far apart

export interface Ports {
  /** Lane coordinate where `wire` meets `s` on its `face`. */
  lane(s: Slot, wire: Wire, face: Face): number;
  /** How many wires share that wall of `s`. */
  crowd(s: Slot, face: Face): number;
  /** Ports go to meet their wires. `target` says which lane each wire comes
   *  in on; a port whose wire could run straight into this wall moves to
   *  where it would, the others keep their even spacing, none changes
   *  places with a neighbour and none comes within PORT_GAP of one. */
  meet(target: (s: Slot, face: Face, wire: Wire) => number | undefined): void;
  /** Move a plain box's port by `d` along its wall: alone if it stays clear
   *  of its neighbours, else together with every port on that wall. Never
   *  into a corner. */
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
  const even = new Map<string, number>();   // the same, as first dealt out: evenly along the wall
  const ordered = new Map<string, Wire[]>(); // `${box}|${face}` → its wires, in order along the wall
  for (const [k, list] of wanted) {
    const box = sh.slotOf(k.split("|")[0]).box!;
    const order = [...list].sort((p, q) => p.key - q.key || wires.indexOf(p.wire) - wires.indexOf(q.wire));
    ordered.set(k, order.map((p) => p.wire));
    order.forEach((p, i) => even.set(`${k}|${portId(p.wire)}`, Math.round((ax.flowFace(box) * (i + 1)) / (order.length + 1))));
  }
  for (const [k, v] of even) offset.set(k, v);
  const offsetOn = (s: Slot, wire: Wire, face: Face): number => {
    if (s.kind !== "box") return Math.round(s.lsize / 2);
    const cp = sh.childPort(s.box!, wire);
    if (cp) return ax.laneOf(cp);
    return offset.get(`${s.id}|${face}|${portId(wire)}`) ?? Math.round(ax.flowFace(s.box!) / 2);
  };

  return {
    lane: (s, wire, face) => s.pos + offsetOn(s, wire, face),
    crowd: (s, face) => (s.kind === "box" ? wanted.get(`${s.id}|${face}`)?.length ?? 1 : 1),
    meet: (target) => {
      for (const [k, list] of ordered) {
        const [id, face] = k.split("|") as [string, Face];
        const s = sh.slotOf(id), len = ax.flowFace(s.box!);
        const room = len - 2 * CORNER;
        if ((list.length - 1) * PORT_GAP > room) continue; // too crowded to move anything
        const key = (w: Wire) => `${k}|${portId(w)}`;
        // where each wire would run straight in, if that is on this wall
        const straight = list.map((w) => {
          const lane = target(s, face, w);
          const rel = lane === undefined ? NaN : lane - s.pos;
          return rel >= CORNER && rel <= len - CORNER ? rel : NaN;
        });
        const want = list.map((w, i) => (Number.isNaN(straight[i]) ? even.get(key(w))! : straight[i]));
        const placed = spread(want, straight.map((x) => (Number.isNaN(x) ? 1 : 1e6)), list.map(() => PORT_GAP));
        // back inside the corners, pushing neighbours along from each end
        const at = placed.map(Math.round);
        for (let i = 0; i < at.length; i++) at[i] = Math.max(at[i], i ? at[i - 1] + PORT_GAP : CORNER);
        for (let i = at.length - 1; i >= 0; i--) at[i] = Math.min(at[i], i + 1 < at.length ? at[i + 1] - PORT_GAP : len - CORNER);
        list.forEach((w, i) => offset.set(key(w), at[i]));
      }
    },
    slide: (s, wire, face, d) => {
      const key = `${s.id}|${face}|${portId(wire)}`;
      if (s.kind !== "box" || !offset.has(key)) return false; // a container's port is its inside's
      const keys = (wanted.get(`${s.id}|${face}`) ?? []).map((p) => `${s.id}|${face}|${portId(p.wire)}`);
      const inside = (v: number) => v >= CORNER && v <= ax.flowFace(s.box!) - CORNER;
      const to = offset.get(key)! + d;
      // on its own, if it stays clear of its neighbours…
      if (inside(to) && keys.every((k) => k === key || Math.abs(offset.get(k)! - to) >= 12)) {
        offset.set(key, to);
        return true;
      }
      // …otherwise every port on the wall moves with it, spacing kept
      if (!keys.every((k) => inside(offset.get(k)! + d))) return false;
      for (const k of keys) offset.set(k, offset.get(k)! + d);
      return true;
    },
  };
}
