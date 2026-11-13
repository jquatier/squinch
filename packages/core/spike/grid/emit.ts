// Emit: turn slots, tracks and gutters into rectangles and polylines, in the
// container's own screen coordinates. Nothing is decided here.

import type { Gutter } from "./gutters.js";
import type { Ports } from "./ports.js";
import type { Sheet } from "./sheet.js";
import { sideRun } from "./side.js";
import type { Stacked } from "./stack.js";
import { spread } from "./isotonic.js";
import { CORNER, LABEL_PAD, TRACK, type Laid, type Link, type Pt, type Rect, type Slot, type Wire } from "./types.js";

export function emit(
  sh: Sheet, ports: Ports, gutters: ReadonlyMap<Slot, Gutter>, st: Stacked,
  /** wire → the lane of its far end, where this container has been told */
  bound: ReadonlyMap<string, number> = new Map(),
  /** wire → where it arrives from outside: a lane, or for a wire through a
   *  side wall how far along the flow */
  arriving: ReadonlyMap<string, number> = new Map(),
): Laid {
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
    if (c.stubLabel) {
      // on the stub at the end that is this wire's alone, clear of the box
      const [l, f] = c.stubLabel === "bottom" ? lf[lf.length - 1] : lf[0];
      const away = LABEL_PAD + ax.labelF(c.wire) / 2;
      labelAt(c.wire, l, c.stubLabel === "bottom" ? f - away : f + away);
    }
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

  // Where each wire straight out of a plain box's side meets it: evenly
  // along the wall — except a wire arriving, which comes in level with
  // where it left the box outside, as far as the wall and its neighbours
  // allow. (Only the arriving end gives way, or the two would swap.)
  const sideF = new Map<Link, number>();
  const sharing = new Map<string, Extract<Link, { type: "side" }>[]>();
  for (const l of links)
    if (l.type === "side" && sh.outermost(l.box, l.wall) && !sh.childPort(sh.slotOf(l.box).box!, l.wire))
      (sharing.get(`${l.box}|${l.wall}`) ?? sharing.set(`${l.box}|${l.wall}`, []).get(`${l.box}|${l.wall}`)!).push(l);
  for (const mates of sharing.values()) {
    const s = sh.slotOf(mates[0].box), face = ax.sideFace(s.box!), n = mates.length;
    const want = mates.map((l, i) => {
      const from = l.outward ? undefined : arriving.get(l.wire.id);
      return from !== undefined ? from - boxF(s) : Math.round((face * (i + 1)) / (n + 1));
    });
    const order = mates.map((_, i) => i).sort((a, b) => want[a] - want[b] || a - b);
    const gap = Math.min(TRACK, n > 1 ? Math.floor((face - 2 * CORNER) / (n - 1)) : TRACK);
    spread(order.map((i) => want[i]), order.map(() => 1), order.map(() => gap)).forEach((v, k) =>
      sideF.set(mates[order[k]], Math.round(Math.min(Math.max(v, CORNER + k * gap), face - CORNER - (n - 1 - k) * gap))));
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
        const f = boxF(s) + (cp ? ax.flowOf(cp) : sideF.get(l)!);
        put(l.wire, [[l.wall === "low" ? s.pos : s.pos + s.lsize, f], [edge, f]], !l.outward);
        wall.set(l.wire.id, ax.toScreen(edge, f));
      } else {
        // past the boxes between: along the channel after its rank, or before it
        const run = sideRun(sh, ports, l), li = sh.layerOf(s);
        const tf = st.channels.get(run.face === "end" ? li : li - 1)!.trackF.get(l.wire.id)!;
        const leave: [number, number][] = run.from
          ? [[run.from.lane, boxF(s) + run.from.flow], [run.lane, boxF(s) + run.from.flow]]
          : [[run.lane, run.face === "end" ? boxF(s) + s.fsize : boxF(s)]];
        put(l.wire, [...leave, [run.lane, tf], [edge, tf]], !l.outward);
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
  // Where a wire is really going: through this container's own wall, to
  // wherever this container was told it ends; into a child container, to
  // the box inside it — not to the wall port, which only follows.
  const end = (s: Slot, wire: Wire, face: "start" | "end"): number => {
    const inner = s.box && sh.childReach(s.box, wire);
    // a plain box's middle, not its port: two wires to one box are headed the same way
    return inner !== undefined ? s.pos + inner : s.kind === "box" && !s.box!.group ? s.pos + s.lsize / 2 : ports.lane(s, wire, face);
  };
  const far = (s: Slot, wire: Wire, face: "start" | "end") => (s.kind === "port" ? bound.get(wire.id) : undefined) ?? end(s, wire, face);
  const reach = new Map<string, number>();
  // …and for a wire across a gutter, how far along the flow its other end is
  const level = (box: Slot, wire: Wire, f: number) => {
    if (!box.box?.group || box.box.group.dir !== g.dir) return;
    (approach.get(box.id) ?? approach.set(box.id, new Map()).get(box.id)!).set(wire.id, f - sh.inset(box));
  };
  for (const gu of gutters.values())
    for (const r of gu.runs) { level(gu.left, r.link.wire, r.fb); level(gu.right, r.link.wire, r.fa); }
  for (const c of chains) {
    const last = c.path.length - 1, top = c.path[0], bottom = c.path[last];
    note(approach, bottom, c.wire, ports.lane(c.path[last - 1], c.wire, "end"));
    note(approach, top, c.wire, ports.lane(c.path[1], c.wire, "start"));
    note(heading, bottom, c.wire, far(top, c.wire, "end"));
    note(heading, top, c.wire, far(bottom, c.wire, "start"));
    if (top.kind === "port" && bottom.kind === "box") reach.set(c.wire.id, end(bottom, c.wire, "start"));
    if (bottom.kind === "port" && top.kind === "box") reach.set(c.wire.id, end(top, c.wire, "end"));
  }

  const size = ax.toScreen(st.L, st.F);
  return { w: size.x, h: size.y, rects, pieces, labels, wall, reach, approach, heading };
}
