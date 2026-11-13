// Place: a lane position for every slot in every layer.
//
// Each wire pulls its two ends toward a straight line (`pulls.ts`). A layer
// is settled by asking every slot where its wires would run straight (a
// weighted median), then resolving the overlaps exactly (`spread`). Sweeping
// down and up a few times lets children settle under parents and parents
// over children. The author's alignments are then made exact, and what is
// left — a wire that wobbles, a jog a few pixels long — is `tidy.ts`'s.

import { compact } from "./compact.js";
import type { Gutter } from "./gutters.js";
import { spread } from "./isotonic.js";
import type { Ports } from "./ports.js";
import { pullsOf, type Pull } from "./pulls.js";
import { rowsOf, type Rows } from "./rows.js";
import type { Sheet } from "./sheet.js";
import { tidy } from "./tidy.js";
import { CORNER, WIRE_WIRE, type Layer, type Slot } from "./types.js";

const HOLD = 1e4; // a box holds its lane outright against a wire passing it
const SWEEPS = 5; // down, up, down, up, down — the last word to the reading direction

export function place(
  sh: Sheet, ports: Ports, gutters: ReadonlyMap<Slot, Gutter>,
  title?: { w: number; h: number }, approach: ReadonlyMap<string, number> = new Map(),
): void {
  const rows = rowsOf(sh, gutters);
  pack(sh, rows);
  const pulls = pullsOf(sh, ports);
  for (let pass = 0; pass < SWEEPS; pass++)
    for (const layer of pass % 2 ? [...sh.layers].reverse() : sh.layers) settle(sh, rows, pulls, layer, pass % 2 === 0, pass === 0);
  wholePixels(sh, rows);
  // close what settling left open, then let parents find their children again
  compact(sh, ports, rows);
  for (const fromAbove of [false, true])
    for (const layer of fromAbove ? sh.layers : [...sh.layers].reverse()) settle(sh, rows, pulls, layer, fromAbove);
  wholePixels(sh, rows);
  alignExactly(sh, rows);
  rows.settleWall();
  separateColumns(sh, rows);
  ports.meet();
  straightenRuns(sh, ports, rows, approach);
  rows.settleWall();
  if (title) clearTitle(sh, ports, rows, title);
  tidy(sh, ports, rows);
}

/** Weighted median; the midpoint when the weight splits evenly between two
 *  values (a parent centres over two children). NaN when empty. */
export function median(items: { value: number; weight: number }[]): number {
  if (!items.length) return NaN;
  const sorted = [...items].sort((a, b) => a.value - b.value);
  const half = sorted.reduce((a, x) => a + x.weight, 0) / 2;
  let acc = 0;
  for (let i = 0; i < sorted.length; i++) {
    acc += sorted[i].weight;
    if (acc > half + 1e-9) return sorted[i].value;
    if (Math.abs(acc - half) <= 1e-9) return (sorted[i].value + sorted[i + 1].value) / 2;
  }
  return sorted[sorted.length - 1].value;
}

/** Start with every row packed against the low wall. */
function pack(sh: Sheet, rows: Rows): void {
  for (const { slots } of sh.layers) {
    let x = 0;
    slots.forEach((s, i) => { s.pos = x; x += rows.stride(slots, i); });
  }
}

const extent = (layer: Layer) => {
  const last = layer.slots[layer.slots.length - 1];
  return last ? [layer.slots[0].pos, last.pos + last.lsize] : undefined;
};

/** One layer, given the others: follow the wires from the layer above
 *  (`fromAbove`) or below. `cold`: nothing below it has been placed yet. */
function settle(sh: Sheet, rows: Rows, pulls: ReadonlyMap<Slot, Pull[]>, layer: Layer, fromAbove: boolean, cold = false): void {
  const row = layer.slots;
  if (!row.length) return;
  const gaps = row.map((_, i) => rows.stride(row, i));
  const anchored = row.map((s) => !!pulls.get(s)?.length);
  let want: number[], weight: number[];
  if (!anchored.some(Boolean)) {
    // a rank with no wire up or down: centre it on its neighbours
    const others = sh.layers.filter((o) => o !== layer).map(extent).filter((e): e is number[] => !!e);
    const mine = extent(layer)!;
    const centre = others.length ? others.reduce((a, e) => a + (e[0] + e[1]) / 2, 0) / others.length : (mine[0] + mine[1]) / 2;
    const shift = centre - (mine[0] + mine[1]) / 2;
    want = row.map((s) => s.pos + shift);
    weight = row.map(() => 1);
  } else {
    // Each side has a say: the median of where the wires above would run
    // straight, and of those below — one wire followed exactly, two split
    // evenly, three following the middle one. The side with more pull
    // wins: a parent sits centred over its children whatever feeds it from
    // above, and a label stands over the one box it leads to rather than
    // under one of a hub's many ports. Level, the sweep's own side wins.
    const li = sh.layerOf(row[0]);
    want = row.map((s) => {
      const side = (above: boolean) => (pulls.get(s) ?? []).filter((x) => !x.aligned && (sh.layerOf(x.other) < li) === above)
        .map((x) => ({ value: x.other.pos + x.theirs - x.mine, weight: x.weight }));
      const [first, second] = fromAbove ? [side(true), side(false)] : [side(false), side(true)];
      const pull = (xs: { weight: number }[]) => xs.reduce((a, x) => a + x.weight, 0);
      // On the very first sweep the rows below have not been placed: a slot
      // follows what is above it and nothing else, and with nothing above
      // keeps its packed place — or row-mates that began side by side would
      // part to chase them, and nothing afterwards would bring them back.
      if (cold) return first.length ? median(first) : s.pos;
      const wired = median(pull(second) > pull(first) + 1e-9 ? second : first.length ? first : second);
      // Boxes the author aligned stand where the wires of all of them
      // together would put their shared centre line — were each simply to
      // follow the other they would agree at once, wherever they started.
      const set = sh.g.aligned?.find((ids) => s.kind === "box" && ids.includes(s.id));
      if (!set) return wired;
      const centre = median(set.map((id) => sh.slotOf(id)).flatMap((m) => (pulls.get(m) ?? []).filter((x) => !x.aligned)
        .map((x) => ({ value: x.other.pos + x.theirs - x.mine + m.lsize / 2, weight: x.weight }))));
      return Number.isNaN(centre) ? s.pos : centre - s.lsize / 2;
    });
    // where a box and a passing wire want the same lane, the wire goes
    // round: a box off its line is seen, a wire a little longer is not
    weight = row.map((s) => ((pulls.get(s) ?? []).reduce((a, x) => a + x.weight, 0) || 1e-6) * (s.kind === "box" ? HOLD : 1));
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
}

/** Whole pixels, and never closer than the gaps allow. */
function wholePixels(sh: Sheet, rows: Rows): void {
  for (const { slots: row } of sh.layers)
    row.forEach((s, i) => {
      const prev = row[i - 1];
      s.pos = Math.max(Math.round(s.pos), prev ? prev.pos + prev.lsize + rows.gapAfter(prev, s) : -Infinity);
    });
}

/** Aligned boxes share a centre exactly. Take a centre every member's row
 *  has room for; failing that, the first-named member's, and its row-mates
 *  make way. */
function alignExactly(sh: Sheet, rows: Rows): void {
  for (const set of sh.g.aligned ?? []) {
    const members = set.map((id) => sh.slotOf(id));
    const at = (s: Slot, centre: number) => Math.round(centre - s.lsize / 2);
    const centres = members.map((s) => s.pos + s.lsize / 2);
    const centre = centres.find((c) => members.every((s) => rows.fits(s, at(s, c)))) ?? centres[0];
    for (const s of members) rows.force(s, at(s, centre));
  }
}

/** Columns are bands across the ranks: each begins past the end of the one
 *  before, in every rank at once. */
function separateColumns(sh: Sheet, rows: Rows): void {
  let edge = -Infinity;
  for (const column of sh.g.columns ?? []) {
    const members = column.map((id) => sh.slotOf(id));
    for (const s of members) if (s.pos < edge) rows.force(s, edge);
    edge = Math.max(edge, ...members.map((s) => s.pos + s.lsize + s.after)) + sh.g.gap.lane;
  }
}

/** A wire through several ranks runs in one line if it can. Each of its
 *  slots was placed in its own row, among its own neighbours; where one lane
 *  is free in every row, take it — preferring one that meets a box head-on. */
function straightenRuns(sh: Sheet, ports: Ports, rows: Rows, approach: ReadonlyMap<string, number>): void {
  const boxes = rows.all.filter((s) => s.kind === "box");
  const lo = Math.min(...boxes.map((s) => s.pos), Infinity), hi = Math.max(...boxes.map((s) => s.pos + s.lsize), -Infinity);
  const centre = (s: Slot) => s.pos + s.lsize / 2;
  for (const c of sh.chains) {
    const run = c.path.filter((s) => s.kind !== "box");
    if (!run.length) continue;
    const top = c.path[0], bottom = c.path[c.path.length - 1];
    const mid = [...run].sort((a, b) => centre(a) - centre(b))[run.length >> 1];
    // failing a straight run to the box, the lane it arrives on from outside
    // — never one that would stretch the container to reach it
    const arrival = approach.get(c.wire.id);
    const lanes = [
      ...(bottom.kind === "box" ? [ports.lane(bottom, c.wire, "start")] : []),
      ...(top.kind === "box" ? [ports.lane(top, c.wire, "end")] : []),
      ...(arrival !== undefined && run.some((s) => s.kind === "port") && arrival >= lo && arrival <= hi ? [arrival] : []),
      ...[...run].sort((a, b) => Math.abs(centre(a) - centre(mid)) - Math.abs(centre(b) - centre(mid))).map(centre),
    ].map(Math.round);
    const lane = lanes.find((l) => run.every((s) => rows.fits(s, l - Math.round(s.lsize / 2))));
    if (lane !== undefined) for (const s of run) s.pos = lane - Math.round(s.lsize / 2);
  }
}

/** No wire that has to turn anyway enters through the title. Under a downward flow the title lies
 *  along the start wall, so a port there keeps to its right; under a
 *  rightward flow it lies along the low wall, and a port keeps below it. */
function clearTitle(sh: Sheet, ports: Ports, rows: Rows, title: { w: number; h: number }): void {
  if (sh.ax.down) {
    // …unless it runs straight on into the box below: a straight wire past
    // the end of the title (drawn behind it, on the title's halo) reads
    // better than one that steps sideways to avoid it.
    const straight = (s: Slot) => sh.chains.some((c) => c.path[0] === s && c.path[1].kind === "box" && ports.lane(c.path[1], c.wire, "start") === s.pos);
    let least = title.w + CORNER;
    for (const s of sh.layers[0]?.kind === "wall" ? sh.layers[0].slots : []) {
      if (s.pos < least && straight(s)) continue;
      s.least = least; s.pos = Math.max(s.pos, least); least = s.pos + WIRE_WIRE;
    }
  } else {
    for (const s of rows.all) if (s.kind === "port") { s.least = title.h + CORNER; s.pos = Math.max(s.pos, s.least); }
  }
}
