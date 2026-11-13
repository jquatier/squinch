// Emit: turn slots, tracks and gutters into rectangles and polylines, in the
// container's own screen coordinates. Nothing is decided here.

import type { Gutter } from "./gutters.js";
import type { Ports } from "./ports.js";
import type { Sheet } from "./sheet.js";
import type { Stacked } from "./stack.js";
import type { Laid, Pt, Rect, Slot, Wire } from "./types.js";

export function emit(sh: Sheet, ports: Ports, gutters: ReadonlyMap<Slot, Gutter>, st: Stacked): Laid {
  const { ax, g, layers, chains, links } = sh;
  const boxF = (s: Slot) => layers[sh.layerOf(s)].f + sh.inset(s);

  const rects = new Map<string, Rect>();
  for (const b of g.boxes) {
    const s = sh.slotOf(b.id);
    rects.set(b.id, { ...ax.toScreen(s.pos, boxF(s)), w: b.w, h: b.h });
  }
  const pieces = new Map<string, Pt[]>(), labels = new Map<string, Rect>(), wall = new Map<string, Pt>();
  /** A wire's points as [lane, flow] pairs, top to bottom or left to right. */
  const put = (wire: Wire, lf: [number, number][], reversed: boolean) => {
    const pts = lf.map(([l, f]) => ax.toScreen(l, f));
    pieces.set(wire.id, reversed ? pts.reverse() : pts);
  };
  /** A label centred on (lane, flow). */
  const labelAt = (wire: Wire, l: number, f: number) => {
    const ls = ax.labelL(wire), fs = ax.labelF(wire);
    labels.set(wire.id, ax.rect(Math.round(l - ls / 2), Math.round(f - fs / 2), ls, fs));
  };

  // through the layers
  for (const c of chains) {
    const lf: [number, number][] = [];
    c.path.forEach((s, i) => {
      const layer = layers[sh.layerOf(s)];
      if (i === 0) {
        const l = ports.lane(s, c.wire, "end");
        lf.push([l, s.kind === "box" ? boxF(s) + s.fsize : layer.f]);
        if (s.kind === "port") wall.set(c.wire.id, ax.toScreen(l, layer.f));
      }
      if (s.label) labels.set(c.wire.id, ax.rect(s.pos, layer.f + Math.round((layer.depth - s.fsize) / 2), s.lsize, s.fsize));
      if (i + 1 < c.path.length) {
        const a = ports.lane(s, c.wire, "end"), b = ports.lane(c.path[i + 1], c.wire, "start");
        if (a !== b) {
          const tf = st.channels.get(c.first + i)!.trackF.get(`${c.wire.id}@${i}`)!;
          lf.push([a, tf], [b, tf]);
        }
      } else {
        const l = ports.lane(s, c.wire, "start");
        lf.push([l, s.kind === "box" ? boxF(s) : layer.f]);
        if (s.kind === "port") wall.set(c.wire.id, ax.toScreen(l, layer.f));
      }
    });
    put(c.wire, lf, c.flipped);
  }

  // across a gutter
  for (const gu of gutters.values()) {
    const lo = gu.left.pos + gu.left.lsize, hi = gu.right.pos;
    const base = layers[sh.layerOf(gu.left)].f;
    const at = gu.lanes(lo, hi);
    for (const r of gu.runs) {
      const wire = r.link.wire, fa = base + r.fa, fb = base + r.fb;
      const turn = at.turn(wire.id);
      put(wire, fa === fb ? [[lo, fa], [hi, fa]] : [[lo, fa], [turn, fa], [turn, fb], [hi, fb]], r.link.a !== gu.left.id);
      if (wire.label) {
        const spot = at.label(wire.id);
        labelAt(wire, spot.lane, spot.onLeft ? fa : fb);
      }
    }
  }

  // round a blocker, and out through a side wall
  for (const l of links) {
    if (l.type === "around") {
      const a = sh.slotOf(l.a), b = sh.slotOf(l.b);
      const tf = st.channels.get(sh.layerOf(a))!.trackF.get(l.wire.id)!;
      const la = ports.lane(a, l.wire, "end"), lb = ports.lane(b, l.wire, "end");
      put(l.wire, [[la, boxF(a) + a.fsize], [la, tf], [lb, tf], [lb, boxF(b) + b.fsize]], false);
      if (l.wire.label) labelAt(l.wire, (la + lb) / 2, tf);
    } else if (l.type === "side") {
      const s = sh.slotOf(l.box);
      const edge = l.wall === "low" ? 0 : st.L;
      if (sh.outermost(l.box, l.wall)) {
        // nothing between it and the wall: straight out of the box's side
        const cp = sh.childPort(s.box!, l.wire);
        const mates = links.filter((o) => o.type === "side" && o.box === l.box && o.wall === l.wall && !sh.childPort(s.box!, o.wire));
        const f = boxF(s) + (cp ? ax.flowOf(cp) : Math.round((ax.sideFace(s.box!) * (mates.indexOf(l) + 1)) / (mates.length + 1)));
        put(l.wire, [[l.wall === "low" ? s.pos : s.pos + s.lsize, f], [edge, f]], !l.outward);
        wall.set(l.wire.id, ax.toScreen(edge, f));
      } else if (l.outward) {
        const tf = st.channels.get(sh.layerOf(s))!.trackF.get(l.wire.id)!;
        const pl = ports.lane(s, l.wire, "end");
        put(l.wire, [[pl, boxF(s) + s.fsize], [pl, tf], [edge, tf]], false);
        wall.set(l.wire.id, ax.toScreen(edge, tf));
      } else {
        const tf = st.channels.get(sh.layerOf(s) - 1)!.trackF.get(l.wire.id)!;
        const pl = ports.lane(s, l.wire, "start");
        put(l.wire, [[edge, tf], [pl, tf], [pl, boxF(s)]], false);
        wall.set(l.wire.id, ax.toScreen(edge, tf));
      }
    }
  }

  // What each child container should know for its next pass about the wires
  // through its walls: the lane each arrives on from the slot next to it
  // (`approach`), and the lane of its far end (`heading`). The second is for
  // ordering the ports wires leave by — the slots between were placed to
  // suit the child's ports, and following them back would only confirm
  // whatever order came first.
  const approach = new Map<string, Map<string, number>>(), heading = new Map<string, Map<string, number>>();
  const note = (into: Map<string, Map<string, number>>, box: Slot, wire: Wire, lane: number) => {
    if (!box.box?.group || box.box.group.dir !== g.dir) return; // only where the two share a lane axis
    (into.get(box.id) ?? into.set(box.id, new Map()).get(box.id)!).set(wire.id, lane - box.pos);
  };
  for (const c of chains) {
    const last = c.path.length - 1, top = c.path[0], bottom = c.path[last];
    note(approach, bottom, c.wire, ports.lane(c.path[last - 1], c.wire, "end"));
    note(approach, top, c.wire, ports.lane(c.path[1], c.wire, "start"));
    note(heading, bottom, c.wire, ports.lane(top, c.wire, "end"));
    note(heading, top, c.wire, ports.lane(bottom, c.wire, "start"));
  }

  const size = ax.toScreen(st.L, st.F);
  return { w: size.x, h: size.y, rects, pieces, labels, wall, approach, heading };
}
