// Place: a lane position for every slot in every layer.
//
// Each wire pulls its two ends toward a straight line. A layer is settled by
// asking every slot where its wires would run straight (a weighted median),
// then resolving the overlaps exactly (`spread`). Sweeping down and up a few
// times lets children settle under parents and parents over children. What is
// left — a wire through several ranks that wobbles, a jog a few pixels long —
// is tidied by two small passes at the end.

import type { Gutter } from "./gutters.js";
import { spread } from "./isotonic.js";
import type { Ports } from "./ports.js";
import type { Sheet } from "./sheet.js";
import { CORNER, LABEL_PAD, WIRE_BOX, WIRE_WIRE, type Layer, type Slot, type Wire } from "./types.js";

/** Weighted median. When the weight splits evenly between two values: their
 *  midpoint if they are on the same `side` (a parent centres over two
 *  children), otherwise whichever is on side 0. NaN when empty. */
export function median(items: { value: number; weight: number; side?: number }[]): number {
  if (!items.length) return NaN;
  const sorted = [...items].sort((a, b) => a.value - b.value);
  const half = sorted.reduce((a, x) => a + x.weight, 0) / 2;
  let acc = 0;
  for (let i = 0; i < sorted.length; i++) {
    acc += sorted[i].weight;
    if (acc > half + 1e-9) return sorted[i].value;
    if (Math.abs(acc - half) <= 1e-9) {
      const a = sorted[i], b = sorted[i + 1];
      if ((a.side ?? 0) === (b.side ?? 0)) return (a.value + b.value) / 2;
      return (a.side ?? 0) === 0 ? a.value : b.value;
    }
  }
  return sorted[sorted.length - 1].value;
}

const SWEEPS = 5;  // down, up, down, up, down — the last word to the reading direction
const NEAR = 15;   // a jog shorter than two corner radii is slid straight rather than drawn

export function place(
  sh: Sheet, ports: Ports, gutters: ReadonlyMap<Slot, Gutter>,
  title?: { w: number; h: number }, approach: ReadonlyMap<string, number> = new Map(),
): void {
  const { layers, chains, g, ax } = sh;

  /** The least distance from the end of `s` to the start of `next`. */
  const gapAfter = (s: Slot, next: Slot): number => {
    if (s.kind === "box" && next.kind === "box") {
      const gu = gutters.get(s);
      return s.after + (gu && gu.right === next ? gu.width : g.gap.lane);
    }
    if (s.label || next.label) return s.after + LABEL_PAD;
    return s.after + (s.kind === "box" || next.kind === "box" ? WIRE_BOX : WIRE_WIRE);
  };
  const stride = (row: Slot[], i: number) => row[i].lsize + (row[i + 1] ? gapAfter(row[i], row[i + 1]) : 0);

  // How hard a wire pulls depends on what it joins — a wire passing through
  // several ranks should not wobble, a wall port only follows — and on how
  // crowded the far wall is: one of eleven wires leaving a hub cannot be
  // straight anyway, so it gives way to the end it has to itself.
  // …and on whether the far end goes on anywhere: a stage with a successor
  // and a side lookup stays in line with the successor, and the lookup hangs
  // beside it. Two equal children still share their parent evenly.
  const degree = new Map<string, number>();
  for (const l of sh.links)
    for (const id of l.type === "chain" ? [l.top, l.bottom] : l.type === "side" ? [l.box] : [l.a, l.b])
      degree.set(id, (degree.get(id) ?? 0) + 1);
  const deadEnd = (s: Slot) => (s.kind === "box" && degree.get(s.id) === 1 ? 0.5 : 1);
  interface Pull { other: Slot; mine: number; theirs: number; weight: number }
  const pulls = new Map<Slot, Pull[]>();
  const pullsOn = (s: Slot) => pulls.get(s) ?? pulls.set(s, []).get(s)!;
  for (const c of chains)
    for (let i = 0; i + 1 < c.path.length; i++) {
      const u = c.path[i], v = c.path[i + 1];
      if (pulls.get(u)?.some((x) => x.other === v)) continue; // a bundle's shared stretch pulls once
      const ou = ports.lane(u, c.wire, "end") - u.pos, ov = ports.lane(v, c.wire, "start") - v.pos;
      const base = u.kind === "port" || v.kind === "port" ? 0.25
        : u.kind === "pass" && v.kind === "pass" ? 8 : u.kind === "pass" || v.kind === "pass" ? 2 : 3;
      const boxes = u.kind === "box" && v.kind === "box";
      pullsOn(u).push({ other: v, mine: ou, theirs: ov, weight: (base * (boxes ? deadEnd(v) : 1)) / ports.crowd(v, "start") });
      pullsOn(v).push({ other: u, mine: ov, theirs: ou, weight: base / ports.crowd(u, "end") });
    }

  // boxes the author aligned pull hard on each other, centre to centre
  const ALIGN = 24;
  for (const set of g.aligned ?? [])
    for (let i = 0; i + 1 < set.length; i++) {
      const a = sh.slotOf(set[i]), b = sh.slotOf(set[i + 1]);
      pullsOn(a).push({ other: b, mine: a.lsize / 2, theirs: b.lsize / 2, weight: ALIGN });
      pullsOn(b).push({ other: a, mine: b.lsize / 2, theirs: a.lsize / 2, weight: ALIGN });
    }

  // start packed
  for (const layer of layers) {
    let x = 0;
    layer.slots.forEach((s, i) => { s.pos = x; x += stride(layer.slots, i); });
  }
  const extent = (layer: Layer) => {
    const last = layer.slots[layer.slots.length - 1];
    return last ? [layer.slots[0].pos, last.pos + last.lsize] : undefined;
  };

  /** One layer, given the others: follow the wires from the layer above
   *  (`fromAbove`) or below. */
  const settle = (layer: Layer, fromAbove: boolean) => {
    const row = layer.slots;
    if (!row.length) return;
    const gaps = row.map((_, i) => stride(row, i));
    const anchored = row.map((s) => !!pulls.get(s)?.length);
    let want: number[], weight: number[];
    if (!anchored.some(Boolean)) {
      // a rank with no wire up or down: centre it on its neighbours
      const others = layers.filter((o) => o !== layer).map(extent).filter((e): e is number[] => !!e);
      const mine = extent(layer)!;
      const centre = others.length ? others.reduce((a, e) => a + (e[0] + e[1]) / 2, 0) / others.length : (mine[0] + mine[1]) / 2;
      const shift = centre - (mine[0] + mine[1]) / 2;
      want = row.map((s) => s.pos + shift);
      weight = row.map(() => 1);
    } else {
      // the median of where its wires would run straight: one wire is
      // followed exactly, two are split evenly, three follow the middle one
      want = row.map((s) => {
        const li = sh.layerOf(s);
        return median((pulls.get(s) ?? []).map((x) => ({
          value: x.other.pos + x.theirs - x.mine, weight: x.weight,
          // an even split between the two sides goes to the side this sweep follows
          side: (sh.layerOf(x.other) < li) === fromAbove ? 0 : 1,
        })));
      });
      weight = row.map((s) => (pulls.get(s) ?? []).reduce((a, x) => a + x.weight, 0) || 1e-6);
      // a slot nothing pulls on leans on the nearest one that is pulled
      const offset = [0];
      for (let i = 0; i + 1 < gaps.length; i++) offset.push(offset[i] + gaps[i]);
      for (let i = 0; i < want.length; i++) {
        if (!Number.isNaN(want[i])) continue;
        let j = i - 1;
        while (j >= 0 && !anchored[j]) j--;
        if (j < 0) { j = i + 1; while (!anchored[j]) j++; }
        want[i] = want[j] + offset[i] - offset[j];
      }
    }
    spread(want, weight, gaps).forEach((x, i) => { row[i].pos = x; });
  };
  for (let pass = 0; pass < SWEEPS; pass++)
    for (const layer of pass % 2 ? [...layers].reverse() : layers) settle(layer, pass % 2 === 0);

  // whole pixels, and never closer than the gaps allow
  for (const { slots: row } of layers)
    row.forEach((s, i) => {
      const prev = row[i - 1];
      s.pos = Math.max(Math.round(s.pos), prev ? prev.pos + prev.lsize + gapAfter(prev, s) : -Infinity);
    });

  /** May `s` start at `pos` without crowding its neighbours? */
  const fits = (s: Slot, pos: number) => {
    const row = layers[sh.layerOf(s)].slots, i = row.indexOf(s);
    const prev = row[i - 1], next = row[i + 1];
    return (!prev || pos >= prev.pos + prev.lsize + gapAfter(prev, s)) && (!next || next.pos >= pos + s.lsize + gapAfter(s, next));
  };

  // Aligned boxes share a centre exactly. Take a centre every member's row
  // has room for; failing that, the first-named member's, and its row-mates
  // make way.
  const force = (s: Slot, pos: number) => {
    const row = layers[sh.layerOf(s)].slots, i = row.indexOf(s);
    s.pos = pos;
    for (let k = i - 1; k >= 0; k--) row[k].pos = Math.min(row[k].pos, row[k + 1].pos - gapAfter(row[k], row[k + 1]) - row[k].lsize);
    for (let k = i + 1; k < row.length; k++) row[k].pos = Math.max(row[k].pos, row[k - 1].pos + row[k - 1].lsize + gapAfter(row[k - 1], row[k]));
  };
  for (const set of g.aligned ?? []) {
    const members = set.map((id) => sh.slotOf(id));
    const at = (s: Slot, centre: number) => Math.round(centre - s.lsize / 2);
    const centres = members.map((s) => s.pos + s.lsize / 2);
    const centre = centres.find((c) => members.every((s) => fits(s, at(s, c)))) ?? centres[0];
    for (const s of members) force(s, at(s, centre));
  }

  // Lanes are measured from the container's low wall from here on: boxes one
  // padding in, ports clear of the corners.
  const all = layers.flatMap((l) => l.slots);
  const clear = (s: Slot) => (s.kind === "port" ? CORNER : ax.pad.low);
  const settleWall = () => {
    if (!all.length) return;
    const first = Math.min(...all.map((s) => s.pos - clear(s)));
    for (const s of all) s.pos -= first;
  };
  settleWall();

  // Columns are bands across the ranks: each begins past the end of the one
  // before, in every rank at once.
  let edge = -Infinity;
  for (const column of g.columns ?? []) {
    const members = column.map((id) => sh.slotOf(id));
    for (const s of members) if (s.pos < edge) force(s, edge);
    edge = Math.max(edge, ...members.map((s) => s.pos + s.lsize + s.after)) + g.gap.lane;
  }

  // A wire through several ranks runs in one line if it can. Each of its
  // slots was placed in its own row, among its own neighbours; where one lane
  // is free in every row, take it — preferring one that meets a box head-on.
  for (const c of chains) {
    const run = c.path.filter((s) => s.kind !== "box");
    if (!run.length) continue;
    const centre = (s: Slot) => s.pos + s.lsize / 2;
    const top = c.path[0], bottom = c.path[c.path.length - 1];
    const mid = [...run].sort((a, b) => centre(a) - centre(b))[run.length >> 1];
    const lanes = [
      ...(bottom.kind === "box" ? [ports.lane(bottom, c.wire, "start")] : []),
      ...(top.kind === "box" ? [ports.lane(top, c.wire, "end")] : []),
      // failing a straight run to the box, the lane it arrives on from outside
      ...(approach.has(c.wire.id) && run.some((s) => s.kind === "port") ? [approach.get(c.wire.id)!] : []),
      ...[...run].sort((a, b) => Math.abs(centre(a) - centre(mid)) - Math.abs(centre(b) - centre(mid))).map(centre),
    ].map(Math.round);
    const lane = lanes.find((l) => run.every((s) => fits(s, l - Math.round(s.lsize / 2))));
    if (lane !== undefined) for (const s of run) s.pos = lane - Math.round(s.lsize / 2);
  }

  // No wire enters through the title. Under a downward flow the title lies
  // along the start wall, so a port there keeps to its right; under a
  // rightward flow it lies along the low wall, and a port keeps below it.
  settleWall();
  if (title) {
    const wallRow = layers[0]?.kind === "wall" ? layers[0].slots : [];
    if (ax.down) {
      let least = title.w + CORNER;
      for (const s of wallRow) { s.pos = Math.max(s.pos, least); least = s.pos + WIRE_WIRE; }
    } else {
      for (const s of all) if (s.kind === "port") s.pos = Math.max(s.pos, title.h + CORNER);
    }
  }

  // Settling splits a disagreement evenly, which leaves both sides a little
  // bent. Where a slot — with whatever it pushes along — can move the whole
  // way and put a wire dead straight without bending one that already is,
  // it does. Box-to-box wires first: they are the lines the eye follows.
  const hopsOf = new Map<Slot, { u: Slot; v: Slot; wire: Wire }[]>();
  for (const c of chains)
    for (let i = 0; i + 1 < c.path.length; i++) {
      const hop = { u: c.path[i], v: c.path[i + 1], wire: c.wire };
      for (const s of [hop.u, hop.v]) (hopsOf.get(s) ?? hopsOf.set(s, []).get(s)!).push(hop);
    }
  const off = (h: { u: Slot; v: Slot; wire: Wire }) => ports.lane(h.u, h.wire, "end") - ports.lane(h.v, h.wire, "start");
  const onAxis = new Set([...(g.aligned ?? []), ...(g.columns ?? [])].flat().map((id) => sh.slotOf(id))); // the author's alignment stands
  const anchoredElsewhere = (s: Slot, except?: object) => onAxis.has(s) || (hopsOf.get(s) ?? []).some((h) => h !== except && off(h) === 0);
  /** Move `s` by `d`, pushing row-mates ahead of it; false if that would
   *  bend a straight wire. */
  const carry = (s: Slot, d: number, hop: object): boolean => {
    const row = layers[sh.layerOf(s)].slots, step = d > 0 ? 1 : -1;
    const moves: [Slot, number][] = [[s, d]];
    for (let i = row.indexOf(s), by = d; row[i + step]; i += step) {
      const [a, b] = step > 0 ? [row[i], row[i + step]] : [row[i + step], row[i]];
      const slack = b.pos - (a.pos + a.lsize + gapAfter(a, b));
      by = step * Math.max(0, Math.abs(by) - slack);
      if (!by) break;
      moves.push([row[i + step], by]);
    }
    if (anchoredElsewhere(s, hop) || moves.slice(1).some(([m]) => anchoredElsewhere(m))) return false;
    for (const [m, by] of moves) m.pos += by;
    return true;
  };
  for (const boxesOnly of [true, false])
    for (const c of chains)
      for (let i = 0; i + 1 < c.path.length; i++) {
        const hop = hopsOf.get(c.path[i])!.find((h) => h.v === c.path[i + 1] && h.wire === c.wire)!;
        if (boxesOnly !== (hop.u.kind === "box" && hop.v.kind === "box")) continue;
        const d = off(hop);
        if (d) carry(hop.v, d, hop) || carry(hop.u, -d, hop);
      }
  settleWall();

  // A wire a few pixels off straight is slid onto the line: the lower end
  // gives way — a port along its wall, a pass-through slot along its row.
  const shift = (s: Slot, d: number) => {
    if (s.kind === "box" || !fits(s, s.pos + d)) return false;
    s.pos += d;
    return true;
  };
  // twice: sliding one wire's port can leave its neighbour a few pixels off
  for (let round = 0; round < 2; round++)
    for (const c of chains)
      for (let i = 0; i + 1 < c.path.length; i++) {
        const u = c.path[i], v = c.path[i + 1];
        const d = ports.lane(u, c.wire, "end") - ports.lane(v, c.wire, "start");
        if (!d || Math.abs(d) > NEAR) continue;
        if (!(ports.slide(v, c.wire, "start", d) || shift(v, d))) ports.slide(u, c.wire, "end", -d) || shift(u, -d);
      }
}
