// The grid engine: boxes in ranks, wires in channels, containers bottom-up.
//
// It knows nothing about Squinch. A `Problem` is boxes (some holding boxes),
// wires between them, and per container a direction, a spacing and the ranks
// the author pinned. A `Solution` is a rectangle per box and a polyline per
// wire. Everything Squinch-specific — views, zones, cards, hints — is turned
// into a Problem by `problem.ts` and back into a picture by `layout.ts`.
//
// One container is laid out by five steps, each a plain function of the one
// before it, and a container holding containers is the same five steps run on
// the inside first:
//
//   rank    which band each box is in            rank.ts      (hard, not a hint)
//   order   where pass-through wires sit         `orderSlots`
//   place   positions along each band            isotonic.ts  (exact)
//   stack   positions of the bands themselves    `stack`
//   route   a track for every wire that turns    channel.ts
//
// Inside a container everything is computed on two abstract axes: `f` is the
// way the ranks advance (the flow), `l` is the way boxes sit side by side in
// a rank (the lane). `direction right` is the same layout with the axes
// swapped at the very end — nothing above `toScreen` knows which is x.

import { assignRanks, dense, type Edge } from "./rank.js";
import { spread } from "./isotonic.js";
import { assignTracks, type Run } from "./channel.js";

export type Dir = "down" | "right";
export type Side = "north" | "south" | "east" | "west";
export interface Pt { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }

export interface Box {
  id: string;
  /** Leaves say their size; a container's is computed from its inside. */
  w: number; h: number;
  /** How much of the east/west walls a wire may land on, from the top — a
   *  table's head, when its rows hang below. Default: the whole wall. */
  face?: number;
  /** Something drawn below the box that is not part of it (a card's sheets). */
  bleed?: number;
  /** A container is never narrower than this (its title has to fit). */
  minW?: number;
  group?: Group;
}
export interface Group {
  dir: Dir;
  pad: { top: number; right: number; bottom: number; left: number };
  gap: { lane: number; rank: number };
  /** In the order they sit within a rank. */
  boxes: Box[];
  pins: Map<string, number>;
}
export interface Wire { id: string; from: string; to: string; label?: { w: number; h: number } }
export interface Problem { root: Group; wires: Wire[] }
export interface Solution {
  width: number; height: number;
  boxes: Map<string, Rect>;
  /** Rank of each box within its own container. */
  ranks: Map<string, number>;
  wires: Map<string, { points: Pt[]; label?: Rect }>;
  /** Wires the engine does not draw: one end contains the other. */
  skipped: string[];
}

const ROOT = "";
const STUB = 16;        // a wire runs this far before it turns
const TRACK = 16;       // between two tracks in one channel
const WIRE_WIRE = 16;   // between two pass-through wires in a rank
const WIRE_BOX = 24;    // between a pass-through wire and a box
const LABEL_PAD = 10;   // between a label and anything beside it

type Role = "start" | "end" | "low" | "high"; // flow-start/-end wall, lane-low/-high wall
const ROLE: Record<Dir, Record<Side, Role>> = {
  down: { north: "start", south: "end", west: "low", east: "high" },
  right: { west: "start", east: "end", north: "low", south: "high" },
};
const SIDE: Record<Dir, Record<Role, Side>> = {
  down: { start: "north", end: "south", low: "west", high: "east" },
  right: { start: "west", end: "east", low: "north", high: "south" },
};

/** How a wire crosses the container that holds both its ends. */
interface Route {
  home: string;                 // that container
  a: string; b: string;         // its direct children holding `from` and `to`
  kind: "down" | "up" | "beside" | "around";
  sideFrom: Side; sideTo: Side; // the walls it leaves and enters by
  fromChain: string[]; toChain: string[]; // containers between each end and `home`, outermost first
}

interface Laid {
  w: number; h: number;
  rects: Map<string, Rect>;                          // children, local
  pieces: Map<string, Pt[]>;                         // wire → its run here, local, from → to
  labels: Map<string, Rect>;
  wall: Map<string, Pt>;                             // wire → where it meets this container's wall
}

export function solve(problem: Problem): Solution {
  // ── index the tree ────────────────────────────────────────────────────────
  const groups = new Map<string, Group>([[ROOT, problem.root]]);
  const chainOf = new Map<string, string[]>(); // box → containers holding it, outermost first, ROOT included
  const boxes = new Map<string, Box>();
  const index = (g: Group, chain: string[]) => {
    for (const b of g.boxes) {
      boxes.set(b.id, b);
      chainOf.set(b.id, chain);
      if (b.group) { groups.set(b.id, b.group); index(b.group, [...chain, b.id]); }
    }
  };
  index(problem.root, [ROOT]);

  // ── rank every container (needs only who is joined to whom) ───────────────
  const lifted = new Map<string, { wire: Wire; a: string; b: string; fromChain: string[]; toChain: string[] }[]>();
  const skipped: string[] = [];
  for (const wire of problem.wires) {
    const f = chainOf.get(wire.from), t = chainOf.get(wire.to);
    if (!f || !t) { skipped.push(wire.id); continue; }
    const fp = [...f, wire.from], tp = [...t, wire.to];
    let k = 0;
    while (k < fp.length && k < tp.length && fp[k] === tp[k]) k++;
    if (k >= fp.length || k >= tp.length) { skipped.push(wire.id); continue; } // one end holds the other
    const home = fp[k - 1];
    (lifted.get(home) ?? lifted.set(home, []).get(home)!).push({
      wire, a: fp[k], b: tp[k], fromChain: fp.slice(k, -1), toChain: tp.slice(k, -1),
    });
  }
  const ranks = new Map<string, number>();
  for (const [id, g] of groups) {
    const edges: Edge[] = (lifted.get(id) ?? []).map((x) => [x.a, x.b]);
    for (const [box, r] of dense(assignRanks(g.boxes.map((b) => b.id), edges, g.pins))) ranks.set(box, r);
  }

  // ── decide which wall each wire uses, where its ends part company ─────────
  const routes = new Map<string, Route>();
  for (const [home, list] of lifted) {
    const g = groups.get(home)!;
    const at = new Map(g.boxes.map((b, i) => [b.id, i]));
    for (const { wire, a, b, fromChain, toChain } of list) {
      const ra = ranks.get(a)!, rb = ranks.get(b)!;
      const side = (r: Role) => SIDE[g.dir][r];
      let kind: Route["kind"], sideFrom: Side, sideTo: Side;
      if (ra < rb) [kind, sideFrom, sideTo] = ["down", side("end"), side("start")];
      else if (ra > rb) [kind, sideFrom, sideTo] = ["up", side("start"), side("end")];
      else {
        const [lo, hi] = at.get(a)! < at.get(b)! ? [at.get(a)!, at.get(b)!] : [at.get(b)!, at.get(a)!];
        const blocked = g.boxes.some((x, i) => i > lo && i < hi && ranks.get(x.id) === ra);
        if (blocked) [kind, sideFrom, sideTo] = ["around", side("end"), side("end")];
        else if (at.get(a)! < at.get(b)!) [kind, sideFrom, sideTo] = ["beside", side("high"), side("low")];
        else [kind, sideFrom, sideTo] = ["beside", side("low"), side("high")];
      }
      routes.set(wire.id, { home, a, b, kind, sideFrom, sideTo, fromChain, toChain });
    }
  }

  // ── lay out, innermost first ──────────────────────────────────────────────
  const laid = new Map<string, Laid>();
  const layGroup = (id: string): Laid => {
    const g = groups.get(id)!;
    for (const b of g.boxes) if (b.group) {
      const inner = layGroup(b.id);
      b.w = inner.w; b.h = inner.h;
    }
    const out = layoutGroup(id, g, boxes.get(id)?.minW ?? 0, problem.wires, routes, ranks, laid);
    laid.set(id, out);
    return out;
  };
  const top = layGroup(ROOT);

  // ── absolute positions, and each wire stitched from its pieces ────────────
  const origin = new Map<string, Pt>([[ROOT, { x: 0, y: 0 }]]);
  const rects = new Map<string, Rect>();
  const settle = (id: string) => {
    const o = origin.get(id)!;
    for (const [child, r] of laid.get(id)!.rects) {
      rects.set(child, { x: o.x + r.x, y: o.y + r.y, w: r.w, h: r.h });
      if (groups.has(child)) { origin.set(child, { x: o.x + r.x, y: o.y + r.y }); settle(child); }
    }
  };
  settle(ROOT);

  const wires = new Map<string, { points: Pt[]; label?: Rect }>();
  for (const wire of problem.wires) {
    const r = routes.get(wire.id);
    if (!r) continue;
    const pts: Pt[] = [];
    let label: Rect | undefined;
    // innermost container on the `from` side, out to home, in to the `to` side
    for (const gid of [...[...r.fromChain].reverse(), r.home, ...r.toChain]) {
      const o = origin.get(gid)!, part = laid.get(gid)!;
      for (const p of part.pieces.get(wire.id) ?? []) pts.push({ x: o.x + p.x, y: o.y + p.y });
      const lr = part.labels.get(wire.id);
      if (lr) label = { x: o.x + lr.x, y: o.y + lr.y, w: lr.w, h: lr.h };
    }
    wires.set(wire.id, { points: simplify(pts), label });
  }
  return { width: top.w, height: top.h, boxes: rects, ranks, wires, skipped };
}

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

/** Drop repeated points and the middle of any three in a line. */
export function simplify(pts: readonly Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1], prev = out[out.length - 2];
    if (last && last.x === p.x && last.y === p.y) continue;
    if (last && prev && ((prev.x === last.x && last.x === p.x) || (prev.y === last.y && last.y === p.y))) out.pop();
    out.push(p);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// One container
// ─────────────────────────────────────────────────────────────────────────────

/** Something that occupies a place in a layer: a box, a wire passing through
 *  (optionally carrying its label), or a wire's port on the container wall. */
interface Slot {
  kind: "box" | "pass" | "port";
  id: string;                 // box id, or the wire's
  box?: Box;
  lsize: number; fsize: number;
  after: number;              // extra room on the lane-high side (a bleed, sideways)
  pos: number;                // lane start
  label?: boolean;
}
interface Layer { kind: "rank" | "label" | "wall"; slots: Slot[]; f: number; depth: number }

/** A wire's way through the layers, top to bottom. `flipped` when the wire
 *  itself runs bottom to top. */
interface Chain { wire: Wire; path: Slot[]; first: number; flipped: boolean }

function layoutGroup(
  gid: string, g: Group, minW: number, allWires: readonly Wire[],
  routes: ReadonlyMap<string, Route>, ranks: ReadonlyMap<string, number>, laid: ReadonlyMap<string, Laid>,
): Laid {
  const down = g.dir === "down";
  const role = (s: Side) => ROLE[g.dir][s];
  const lsize = (b: Box) => (down ? b.w : b.h);
  const fsize = (b: Box) => (down ? b.h : b.w);
  /** How much of a box's flow-facing walls (lane-wise) and side walls
   *  (flow-wise) a wire may use. */
  const flowFace = (b: Box) => (down ? b.w : b.face ?? b.h);
  const sideFace = (b: Box) => (down ? b.face ?? b.h : b.w);
  const labelL = (w: Wire) => (down ? w.label!.w : w.label!.h);
  const labelF = (w: Wire) => (down ? w.label!.h : w.label!.w);

  // ── what each wire does here ──────────────────────────────────────────────
  type Link =
    | { wire: Wire; type: "chain"; top: string | "wall"; bottom: string | "wall"; flipped: boolean }
    | { wire: Wire; type: "beside"; a: string; b: string }   // neighbours on one rank
    | { wire: Wire; type: "around"; a: string; b: string }   // one rank, something between
    | { wire: Wire; type: "side"; box: string; wall: "low" | "high"; outward: boolean };
  const links: Link[] = [];
  for (const wire of allWires) {
    const r = routes.get(wire.id);
    if (!r) continue;
    if (r.home === gid) {
      if (r.kind === "down") links.push({ wire, type: "chain", top: r.a, bottom: r.b, flipped: false });
      else if (r.kind === "up") links.push({ wire, type: "chain", top: r.b, bottom: r.a, flipped: true });
      else links.push({ wire, type: r.kind, a: r.a, b: r.b });
      continue;
    }
    // this container is on the way out from `from`, or on the way in to `to`
    const fi = r.fromChain.indexOf(gid), ti = r.toChain.indexOf(gid);
    if (fi < 0 && ti < 0) continue;
    const outward = fi >= 0;
    const child = outward ? r.fromChain[fi + 1] ?? wire.from : r.toChain[ti + 1] ?? wire.to;
    const wall = role(outward ? r.sideFrom : r.sideTo);
    if (wall === "end") links.push({ wire, type: "chain", top: child, bottom: "wall", flipped: !outward });
    else if (wall === "start") links.push({ wire, type: "chain", top: "wall", bottom: child, flipped: outward });
    else links.push({ wire, type: "side", box: child, wall, outward });
  }

  // ── layers: one per rank, one per labelled gap, one per used flow wall ────
  const rankCount = Math.max(0, ...g.boxes.map((b) => ranks.get(b.id)! + 1));
  const chains = links.filter((l): l is Extract<Link, { type: "chain" }> => l.type === "chain");
  const rankOf = (end: string | "wall", which: "top" | "bottom") =>
    end === "wall" ? (which === "top" ? -1 : rankCount) : ranks.get(end)!;
  /** Where a chain's label sits: half-way. That is a rank when it crosses an
   *  even number of gaps (the label stands in the row it passes through) and
   *  a gap of its own otherwise. */
  const labelSpot = (c: Extract<Link, { type: "chain" }>): { rank: number } | { gap: number } => {
    const a = rankOf(c.top, "top"), b = rankOf(c.bottom, "bottom");
    return (b - a) % 2 === 0 ? { rank: (a + b) / 2 } : { gap: a + (b - a - 1) / 2 };
  };
  const labelled = new Set(chains.filter((c) => c.wire.label).map(labelSpot).flatMap((s) => ("gap" in s ? [s.gap] : [])));
  const layers: Layer[] = [];
  const layerOfRank = new Map<number, number>(), layerOfLabel = new Map<number, number>();
  const add = (kind: Layer["kind"]) => layers.push({ kind, slots: [], f: 0, depth: 0 }) - 1;
  const usesStart = chains.some((c) => c.top === "wall"), usesEnd = chains.some((c) => c.bottom === "wall");
  if (usesStart) layerOfRank.set(-1, add("wall"));
  for (let r = 0; r < rankCount; r++) {
    layerOfRank.set(r, add("rank"));
    if (labelled.has(r)) layerOfLabel.set(r, add("label"));
  }
  if (usesEnd) layerOfRank.set(rankCount, add("wall"));

  const boxSlot = new Map<string, Slot>();
  for (const b of g.boxes) {
    const s: Slot = { kind: "box", id: b.id, box: b, lsize: lsize(b), fsize: fsize(b), after: down ? 0 : b.bleed ?? 0, pos: 0 };
    boxSlot.set(b.id, s);
    layers[layerOfRank.get(ranks.get(b.id)!)!].slots.push(s);
  }
  const layerIndex = new Map<Slot, number>();
  const laidChains: Chain[] = chains.map((c) => {
    const from = layerOfRank.get(rankOf(c.top, "top"))!, to = layerOfRank.get(rankOf(c.bottom, "bottom"))!;
    const spot = c.wire.label ? labelSpot(c) : undefined;
    const labelAt = !spot ? undefined : "gap" in spot ? layerOfLabel.get(spot.gap) : layerOfRank.get(spot.rank);
    const path: Slot[] = [];
    for (let i = from; i <= to; i++) {
      const end = i === from ? c.top : i === to ? c.bottom : undefined;
      if (end !== undefined && end !== "wall") { path.push(boxSlot.get(end)!); continue; }
      const isLabel = i === labelAt;
      const s: Slot = {
        kind: end === "wall" ? "port" : "pass", id: c.wire.id, pos: 0, after: 0, label: isLabel,
        lsize: isLabel ? labelL(c.wire) : 0, fsize: isLabel ? labelF(c.wire) : 0,
      };
      layers[i].slots.push(s);
      path.push(s);
    }
    return { wire: c.wire, path, first: from, flipped: c.flipped };
  });
  layers.forEach((layer, i) => layer.slots.forEach((s) => layerIndex.set(s, i)));

  orderSlots(layers, laidChains, links.filter((l) => l.type === "beside").map((l) => [l.a, l.b] as const));

  // ── ports: where on a box's wall each wire attaches ───────────────────────
  // A box inside a container already decided (the child's own layout put its
  // wall port somewhere); every other port is one of n evenly spaced.
  const at = new Map<Slot, number>();
  layers.forEach((layer) => layer.slots.forEach((s, i) => at.set(s, i)));
  const childPort = (box: Box, wire: Wire): Pt | undefined => (box.group ? laid.get(box.id)!.wall.get(wire.id) : undefined);
  const faceWires = new Map<string, { wire: Wire; key: number }[]>(); // `${box}|start` or `|end`
  const want = (box: string, face: "start" | "end", wire: Wire, key: number) => {
    if (childPort(boxSlot.get(box)!.box!, wire)) return;
    const k = `${box}|${face}`;
    (faceWires.get(k) ?? faceWires.set(k, []).get(k)!).push({ wire, key });
  };
  for (const c of laidChains) {
    const top = c.path[0], bottom = c.path[c.path.length - 1];
    if (top.kind === "box") want(top.id, "end", c.wire, at.get(c.path[1])!);
    if (bottom.kind === "box") want(bottom.id, "start", c.wire, at.get(c.path[c.path.length - 2])!);
  }
  const FAR = 1e6;
  for (const l of links) {
    if (l.type === "around") {
      // nearer partner takes the port nearer that side, so the runs nest
      const ia = at.get(boxSlot.get(l.a)!)!, ib = at.get(boxSlot.get(l.b)!)!;
      want(l.a, "end", l.wire, ib < ia ? -FAR - ib : FAR - ib);
      want(l.b, "end", l.wire, ia < ib ? -FAR - ia : FAR - ia);
    } else if (l.type === "side" && !outermost(l.box, l.wall)) {
      want(l.box, l.outward ? "end" : "start", l.wire, l.wall === "low" ? -2 * FAR : 2 * FAR);
    }
  }
  const portOffset = new Map<string, number>(); // `${box}|${face}|${wire}` → lane offset from the box's start
  for (const [k, list] of faceWires) {
    const box = boxSlot.get(k.split("|")[0])!.box!;
    const order = [...list].sort((p, q) => p.key - q.key || allWires.indexOf(p.wire) - allWires.indexOf(q.wire));
    order.forEach((p, i) => portOffset.set(`${k}|${p.wire.id}`, Math.round((flowFace(box) * (i + 1)) / (order.length + 1))));
  }
  /** Lane offset, from a slot's start, of where `wire` meets it. */
  const offsetOn = (s: Slot, wire: Wire, face: "start" | "end"): number => {
    if (s.kind !== "box") return Math.round(s.lsize / 2);
    const cp = childPort(s.box!, wire);
    if (cp) return down ? cp.x : cp.y;
    return portOffset.get(`${s.id}|${face}|${wire.id}`) ?? Math.round(flowFace(s.box!) / 2);
  };
  function outermost(box: string, wall: "low" | "high"): boolean {
    const row = layers[layerOfRank.get(ranks.get(box)!)!].slots.filter((s) => s.kind === "box");
    return (wall === "low" ? row[0] : row[row.length - 1]).id === box;
  }

  // ── flow offsets inside a rank: tops level beside a table, centred otherwise
  const startAligned = (layer: Layer) => !down || layer.slots.some((s) => s.box?.face !== undefined || s.box?.group);
  const tallest = (layer: Layer) => Math.max(0, ...layer.slots.map((s) => s.fsize));
  const inset = (s: Slot) => {
    const layer = layers[layerIndex.get(s)!];
    return startAligned(layer) ? 0 : Math.round((tallest(layer) - s.fsize) / 2);
  };

  // ── same-rank neighbours: the gutter between them is a channel on its side
  interface Gutter { left: Slot; right: Slot; runs: { link: Extract<Link, { type: "beside" }>; fa: number; fb: number }[]; tracks: Map<string, number>; count: number }
  const gutters = new Map<Slot, Gutter>(); // by the left box
  {
    const pairs = new Map<string, Extract<Link, { type: "beside" }>[]>();
    for (const l of links) {
      if (l.type !== "beside") continue;
      const [x, y] = at.get(boxSlot.get(l.a)!)! < at.get(boxSlot.get(l.b)!)! ? [l.a, l.b] : [l.b, l.a];
      const k = `${x}|${y}`;
      (pairs.get(k) ?? pairs.set(k, []).get(k)!).push(l);
    }
    for (const [k, list] of pairs) {
      const [x, y] = k.split("|");
      const left = boxSlot.get(x)!, right = boxSlot.get(y)!;
      // the stretch of flow both walls share; plain boxes split it evenly
      const lo = Math.max(inset(left), inset(right));
      const hi = Math.min(inset(left) + sideFace(left.box!), inset(right) + sideFace(right.box!));
      const clamp = (v: number, s: Slot) => Math.min(Math.max(v, inset(s) + 8), inset(s) + sideFace(s.box!) - 8);
      const runs = list.map((link, i) => {
        const shared = lo + Math.round(((hi - lo) * (i + 1)) / (list.length + 1));
        const pl = childPort(left.box!, link.wire), pr = childPort(right.box!, link.wire);
        const fl = pl ? inset(left) + (down ? pl.y : pl.x) : undefined;
        const fr = pr ? inset(right) + (down ? pr.y : pr.x) : undefined;
        // a container's port is where its inside put it; a plain box meets it if it can
        const fa = fl ?? (fr !== undefined ? clamp(fr, left) : shared);
        const fb = fr ?? (fl !== undefined ? clamp(fl, right) : shared);
        return { link, fa, fb };
      });
      const bent: Run[] = runs.filter((r) => r.fa !== r.fb).map((r) => ({ id: r.link.wire.id, a: { at: "lo", pos: r.fa }, b: { at: "hi", pos: r.fb } }));
      const tracks = assignTracks(bent);
      gutters.set(left, { left, right, runs, tracks, count: Math.max(0, ...[...tracks.values()].map((t) => t + 1)) });
    }
  }
  const gutterWidth = (gu: Gutter) => {
    const widest = Math.max(0, ...gu.runs.filter((r) => r.link.wire.label).map((r) => labelL(r.link.wire)));
    return Math.max(g.gap.lane, widest ? widest + 2 * STUB : 0, gu.count ? 2 * STUB + (gu.count - 1) * TRACK : 0);
  };

  // ── place: positions along every layer ────────────────────────────────────
  const gapAfter = (s: Slot, next: Slot): number => {
    if (s.kind === "box" && next.kind === "box") {
      const gu = gutters.get(s);
      return s.after + (gu && gu.right === next ? gutterWidth(gu) : g.gap.lane);
    }
    if (s.label || next.label) return s.after + LABEL_PAD;
    return s.after + (s.kind === "box" || next.kind === "box" ? WIRE_BOX : WIRE_WIRE);
  };
  // Each wire pulls its two ends toward a straight line. How hard depends on
  // what it joins — a wire passing through several ranks should not wobble —
  // and on how crowded the far wall is: one of eleven wires leaving a hub
  // cannot be straight anyway, so it gives way to the end it has to itself.
  const crowd = (s: Slot, face: "start" | "end") => (s.kind === "box" ? faceWires.get(`${s.id}|${face}`)?.length ?? 1 : 1);
  const pulls = new Map<Slot, { other: Slot; mine: number; theirs: number; weight: number }[]>();
  for (const c of laidChains)
    for (let i = 0; i + 1 < c.path.length; i++) {
      const u = c.path[i], v = c.path[i + 1];
      const ou = offsetOn(u, c.wire, "end"), ov = offsetOn(v, c.wire, "start");
      // a wall port has nowhere it needs to be: it follows, it does not lead
      const base = u.kind === "port" || v.kind === "port" ? 0.25
        : u.kind === "pass" && v.kind === "pass" ? 8 : u.kind === "pass" || v.kind === "pass" ? 2 : 1;
      (pulls.get(u) ?? pulls.set(u, []).get(u)!).push({ other: v, mine: ou, theirs: ov, weight: base / crowd(v, "start") });
      (pulls.get(v) ?? pulls.set(v, []).get(v)!).push({ other: u, mine: ov, theirs: ou, weight: base / crowd(u, "end") });
    }
  for (const layer of layers) {
    let x = 0;
    layer.slots.forEach((s, i) => { s.pos = x; x += s.lsize + (layer.slots[i + 1] ? gapAfter(s, layer.slots[i + 1]) : 0); });
  }
  const extent = (layer: Layer) => {
    const last = layer.slots[layer.slots.length - 1];
    return last ? [layer.slots[0].pos, last.pos + last.lsize] : undefined;
  };
  /** One layer, given the others: follow the wires from the layer above
   *  (`fromAbove`) or below. A slot with none on that side follows the other. */
  const settle = (layer: Layer, fromAbove: boolean) => {
    if (!layer.slots.length) return;
    const gaps = layer.slots.map((s, i) => s.lsize + (layer.slots[i + 1] ? gapAfter(s, layer.slots[i + 1]) : 0));
    // a slot nothing pulls on keeps its distance from the nearest one that is pulled
    const anchored = layer.slots.map((s) => !!pulls.get(s)?.length);
    let wantPos: number[], weight: number[];
    if (!anchored.some(Boolean)) {
      // a rank with no wire up or down: centre it on its neighbours
      const others = layers.filter((o) => o !== layer).map(extent).filter((e): e is number[] => !!e);
      const mine = extent(layer)!;
      const centre = others.length ? others.reduce((a, e) => a + (e[0] + e[1]) / 2, 0) / others.length : (mine[0] + mine[1]) / 2;
      const shift = centre - (mine[0] + mine[1]) / 2;
      wantPos = layer.slots.map((s) => s.pos + shift);
      weight = layer.slots.map(() => 1);
    } else {
      // the *median* of where its wires would run straight: one wire is
      // followed exactly, two are split evenly, three follow the middle one
      wantPos = layer.slots.map((s) => {
        const li = layerIndex.get(s)!;
        return median((pulls.get(s) ?? []).map((x) => ({
          value: x.other.pos + x.theirs - x.mine, weight: x.weight,
          // an even split between the two sides goes to the side this sweep follows
          side: (layerIndex.get(x.other)! < li) === fromAbove ? 0 : 1,
        })));
      });
      weight = layer.slots.map((s) => (pulls.get(s) ?? []).reduce((a, x) => a + x.weight, 0) || 1e-6);
      const offset = [0];
      for (let i = 0; i + 1 < gaps.length; i++) offset.push(offset[i] + gaps[i]);
      for (let i = 0; i < wantPos.length; i++) {
        if (!Number.isNaN(wantPos[i])) continue;
        // lean on the nearest anchored neighbour, at exactly the minimum gap
        let j = i - 1;
        while (j >= 0 && !anchored[j]) j--;
        if (j < 0) { j = i + 1; while (!anchored[j]) j++; }
        wantPos[i] = wantPos[j] + offset[i] - offset[j];
      }
    }
    spread(wantPos, weight, gaps).forEach((x, i) => { layer.slots[i].pos = x; });
  };
  // down, up, down: children under parents, parents over children, and the
  // last word to the direction the diagram reads in
  for (let pass = 0; pass < 5; pass++)
    for (const layer of pass % 2 ? [...layers].reverse() : layers) settle(layer, pass % 2 === 0);
  for (const layer of layers) {
    // whole pixels, and never closer than the gaps allow
    layer.slots.forEach((s, i) => {
      const prev = layer.slots[i - 1];
      s.pos = Math.max(Math.round(s.pos), prev ? prev.pos + prev.lsize + gapAfter(prev, s) : -Infinity);
    });
  }

  // ── straighten: a wire a few pixels off straight is slid onto the line ────
  // Rounding and half-pixel medians leave jogs too short to draw as a corner.
  // The lower end gives way: a port slides along its wall (staying clear of
  // its neighbours and the corners), a pass-through slot shifts in its row.
  const NEAR = 8;
  for (const c of laidChains)
    for (let i = 0; i + 1 < c.path.length; i++) {
      const u = c.path[i], v = c.path[i + 1];
      const d = laneOf(u, c.wire, "end") - laneOf(v, c.wire, "start");
      if (!d || Math.abs(d) > NEAR) continue;
      if (!slide(v, c.wire, "start", d)) slide(u, c.wire, "end", -d);
    }
  function laneOf(s: Slot, wire: Wire, face: "start" | "end") { return s.pos + offsetOn(s, wire, face); }
  function slide(s: Slot, wire: Wire, face: "start" | "end", d: number): boolean {
    if (s.kind === "box") {
      const key = `${s.id}|${face}|${wire.id}`;
      if (!portOffset.has(key)) return false; // a container's port is its inside's
      const to = portOffset.get(key)! + d;
      const others = (faceWires.get(`${s.id}|${face}`) ?? []).filter((p) => p.wire !== wire).map((p) => portOffset.get(`${s.id}|${face}|${p.wire.id}`)!);
      if (to < 8 || to > flowFace(s.box!) - 8 || others.some((o) => Math.abs(o - to) < 12)) return false;
      portOffset.set(key, to);
      return true;
    }
    const row = layers[layerIndex.get(s)!].slots, i = row.indexOf(s);
    const prev = row[i - 1], next = row[i + 1];
    if (prev && s.pos + d < prev.pos + prev.lsize + gapAfter(prev, s)) return false;
    if (next && next.pos < s.pos + d + s.lsize + gapAfter(s, next)) return false;
    s.pos += d;
    return true;
  }

  // ── channels: collect every run that turns ────────────────────────────────
  // channel i lies after layer i; channel -1 lies before the first layer
  const channelRuns = new Map<number, Run[]>();
  const thick = new Map<string, number>(); // run id → room its label needs across the track
  const runsIn = (i: number) => channelRuns.get(i) ?? channelRuns.set(i, []).get(i)!;
  const lane = (s: Slot, wire: Wire, face: "start" | "end") => s.pos + offsetOn(s, wire, face);
  for (const c of laidChains)
    for (let i = 0; i + 1 < c.path.length; i++) {
      const a = lane(c.path[i], c.wire, "end"), b = lane(c.path[i + 1], c.wire, "start");
      if (a !== b) runsIn(c.first + i).push({ id: `${c.wire.id}@${i}`, a: { at: "lo", pos: a }, b: { at: "hi", pos: b } });
    }
  for (const l of links) {
    if (l.type === "around") {
      const a = boxSlot.get(l.a)!, b = boxSlot.get(l.b)!;
      runsIn(layerIndex.get(a)!).push({ id: l.wire.id, a: { at: "lo", pos: lane(a, l.wire, "end") }, b: { at: "lo", pos: lane(b, l.wire, "end") } });
      if (l.wire.label) thick.set(l.wire.id, labelF(l.wire));
    } else if (l.type === "side" && !outermost(l.box, l.wall)) {
      const s = boxSlot.get(l.box)!, li = layerIndex.get(s)!;
      const out = { at: l.wall === "low" ? "start" : "end" } as const;
      if (l.outward) runsIn(li).push({ id: l.wire.id, a: { at: "lo", pos: lane(s, l.wire, "end") }, b: out });
      else runsIn(li - 1).push({ id: l.wire.id, a: out, b: { at: "hi", pos: lane(s, l.wire, "start") } });
    }
  }

  // ── stack: flow positions of layers and channels ──────────────────────────
  interface Channel { f: number; depth: number; trackF: Map<string, number> }
  const channels = new Map<number, Channel>();
  const padStart = down ? g.pad.top : g.pad.left, padEnd = down ? g.pad.bottom : g.pad.right;
  const padLow = down ? g.pad.left : g.pad.top, padHigh = down ? g.pad.right : g.pad.bottom;
  const halfLabelGap = Math.max(LABEL_PAD, Math.round((g.gap.rank - 18) / 2));
  const openChannel = (i: number, f: number, least: number): number => {
    const runs = channelRuns.get(i) ?? [];
    const track = assignTracks(runs);
    const count = Math.max(0, ...[...track.values()].map((t) => t + 1));
    // a track carrying a label is as thick as the label, plus a little air
    const half = Array.from({ length: count }, (_, t) =>
      Math.max(0, ...runs.filter((r) => track.get(r.id) === t).map((r) => (thick.has(r.id) ? thick.get(r.id)! / 2 + 4 : 0))));
    const centre: number[] = [];
    half.forEach((h, t) => centre.push(t ? centre[t - 1] + half[t - 1] + TRACK + h : h));
    const used = count ? centre[count - 1] + half[count - 1] : 0;
    const depth = Math.ceil(Math.max(least, count ? used + 2 * STUB : 0));
    const first = f + Math.round((depth - used) / 2);
    channels.set(i, { f, depth, trackF: new Map(runs.map((r) => [r.id, first + Math.round(centre[track.get(r.id)!])])) });
    return f + depth;
  };
  let f = 0;
  if (layers[0]?.kind !== "wall") {
    f = padStart;
    if (channelRuns.has(-1)) f = openChannel(-1, f, 0);
  }
  layers.forEach((layer, i) => {
    layer.f = f;
    layer.depth = layer.kind === "rank"
      ? Math.max(0, ...layer.slots.map((s) => inset(s) + s.fsize + (down ? s.box?.bleed ?? 0 : 0)))
      : tallest(layer);
    f += layer.depth;
    const next = layers[i + 1];
    if (!next) {
      if (layer.kind !== "wall") {
        if (channelRuns.has(i)) f = openChannel(i, f, 0) + 8;
        f += padEnd;
      }
      return;
    }
    const least = layer.kind === "wall" ? padStart : next.kind === "wall" ? padEnd
      : layer.kind === "label" || next.kind === "label" ? halfLabelGap : g.gap.rank;
    f = openChannel(i, f, least);
  });

  // ── lane extent: boxes one padding in from the wall, ports clear of corners
  const all = layers.flatMap((l) => l.slots);
  if (all.length) {
    const first = Math.min(...all.map((s) => s.pos - (s.kind === "port" ? 8 : padLow)));
    for (const s of all) s.pos -= first;
  }
  let L = Math.max(padLow, ...all.map((s) => s.pos + s.lsize + s.after)) + padHigh;
  let F = f;
  // a container is at least as wide as its title
  if (down) L = Math.max(L, minW);
  else if (layers[layers.length - 1]?.kind !== "wall") F = Math.max(F, minW);

  // ── emit, in (l, f); `toScreen` is the only place that knows about x and y
  const toScreen = (l: number, fl: number): Pt => (down ? { x: l, y: fl } : { x: fl, y: l });
  const rects = new Map<string, Rect>();
  const boxF = (s: Slot) => layers[layerIndex.get(s)!].f + inset(s);
  for (const b of g.boxes) {
    const s = boxSlot.get(b.id)!;
    const p = toScreen(s.pos, boxF(s));
    rects.set(b.id, { x: p.x, y: p.y, w: b.w, h: b.h });
  }
  const pieces = new Map<string, Pt[]>(), labels = new Map<string, Rect>(), wall = new Map<string, Pt>();
  const rectAt = (l: number, fl: number, ls: number, fs: number): Rect => {
    const p = toScreen(l, fl);
    return down ? { x: p.x, y: p.y, w: ls, h: fs } : { x: p.x, y: p.y, w: fs, h: ls };
  };
  const put = (wire: Wire, lf: [number, number][], reversed: boolean) => {
    const pts = lf.map(([l, fl]) => toScreen(l, fl));
    pieces.set(wire.id, reversed ? pts.reverse() : pts);
  };

  for (const c of laidChains) {
    const lf: [number, number][] = [];
    c.path.forEach((s, i) => {
      const layer = layers[layerIndex.get(s)!];
      const isTop = i === 0, isBottom = i === c.path.length - 1;
      if (isTop) {
        const l = lane(s, c.wire, "end");
        lf.push([l, s.kind === "box" ? boxF(s) + s.fsize : layer.f]);
        if (s.kind === "port") wall.set(c.wire.id, toScreen(l, layer.f));
      }
      if (s.label) {
        const fl = layer.f + Math.round((layer.depth - s.fsize) / 2);
        labels.set(c.wire.id, rectAt(s.pos, fl, s.lsize, s.fsize));
      }
      if (!isBottom) {
        const a = lane(s, c.wire, "end"), b = lane(c.path[i + 1], c.wire, "start");
        if (a !== b) {
          const tf = channels.get(c.first + i)!.trackF.get(`${c.wire.id}@${i}`)!;
          lf.push([a, tf], [b, tf]);
        }
      } else {
        const l = lane(s, c.wire, "start");
        lf.push([l, s.kind === "box" ? boxF(s) : layer.f]);
        if (s.kind === "port") wall.set(c.wire.id, toScreen(l, layer.f));
      }
    });
    put(c.wire, lf, c.flipped);
  }

  for (const gu of gutters.values()) {
    const lo = gu.left.pos + gu.left.lsize, hi = gu.right.pos;
    const base = layers[layerIndex.get(gu.left)!].f;
    const used = (gu.count - 1) * TRACK;
    for (const r of gu.runs) {
      const fa = base + r.fa, fb = base + r.fb;
      const mid = fa === fb ? Math.round((lo + hi) / 2) : lo + Math.round((hi - lo - used) / 2) + gu.tracks.get(r.link.wire.id)! * TRACK;
      put(r.link.wire, fa === fb ? [[lo, fa], [hi, fa]] : [[lo, fa], [mid, fa], [mid, fb], [hi, fb]], r.link.a !== gu.left.id);
      if (r.link.wire.label) {
        const ls = labelL(r.link.wire), fs = labelF(r.link.wire);
        labels.set(r.link.wire.id, rectAt(mid - Math.round(ls / 2), Math.round((fa + fb) / 2 - fs / 2), ls, fs));
      }
    }
  }

  for (const l of links) {
    if (l.type === "around") {
      const a = boxSlot.get(l.a)!, b = boxSlot.get(l.b)!;
      const tf = channels.get(layerIndex.get(a)!)!.trackF.get(l.wire.id)!;
      const la = lane(a, l.wire, "end"), lb = lane(b, l.wire, "end");
      put(l.wire, [[la, boxF(a) + a.fsize], [la, tf], [lb, tf], [lb, boxF(b) + b.fsize]], false);
      if (l.wire.label) {
        const ls = labelL(l.wire), fs = labelF(l.wire);
        labels.set(l.wire.id, rectAt(Math.round((la + lb) / 2 - ls / 2), Math.round(tf - fs / 2), ls, fs));
      }
    } else if (l.type === "side") {
      const s = boxSlot.get(l.box)!;
      const edge = l.wall === "low" ? 0 : L;
      if (outermost(l.box, l.wall)) {
        const cp = childPort(s.box!, l.wire);
        const mates = links.filter((o) => o.type === "side" && o.box === l.box && o.wall === l.wall && !childPort(s.box!, o.wire));
        const fl = boxF(s) + (cp ? (down ? cp.y : cp.x) : Math.round((sideFace(s.box!) * (mates.indexOf(l) + 1)) / (mates.length + 1)));
        put(l.wire, [[l.wall === "low" ? s.pos : s.pos + s.lsize, fl], [edge, fl]], !l.outward);
        wall.set(l.wire.id, toScreen(edge, fl));
      } else if (l.outward) {
        const tf = channels.get(layerIndex.get(s)!)!.trackF.get(l.wire.id)!;
        const pl = lane(s, l.wire, "end");
        put(l.wire, [[pl, boxF(s) + s.fsize], [pl, tf], [edge, tf]], false);
        wall.set(l.wire.id, toScreen(edge, tf));
      } else {
        const tf = channels.get(layerIndex.get(s)! - 1)!.trackF.get(l.wire.id)!;
        const pl = lane(s, l.wire, "start");
        put(l.wire, [[edge, tf], [pl, tf], [pl, boxF(s)]], false);
        wall.set(l.wire.id, toScreen(edge, tf));
      }
    }
  }

  const size = toScreen(L, F);
  return { w: size.x, h: size.y, rects, pieces, labels, wall };
}

// ─────────────────────────────────────────────────────────────────────────────
// Order: where pass-through wires and wall ports sit among the boxes
// ─────────────────────────────────────────────────────────────────────────────
// Boxes never move — their order is the author's. Each wire slot is put where
// it crosses the fewest other wires, nearest to straight on a tie.

function orderSlots(layers: Layer[], chains: readonly Chain[], neighbours: readonly (readonly [string, string])[]): void {
  const where = new Map<Slot, number>();
  const hops: [Slot, Slot][][] = layers.map(() => []); // hops[i]: between layer i and i+1
  chains.forEach((c) => c.path.forEach((s, i) => {
    where.set(s, c.first + i);
    if (i + 1 < c.path.length) hops[c.first + i].push([s, c.path[i + 1]]);
  }));
  const beside = new Set(neighbours.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]));

  const reinsert = (li: number, s: Slot, useAbove: boolean, useBelow: boolean) => {
    const layer = layers[li].slots;
    layer.splice(layer.indexOf(s), 1);
    const index = (other: Slot[]) => new Map(other.map((x, i) => [x, i]));
    const above = li > 0 ? index(layers[li - 1].slots) : new Map<Slot, number>();
    const below = li + 1 < layers.length ? index(layers[li + 1].slots) : new Map<Slot, number>();
    const here = index(layer);
    const up = useAbove && li > 0 ? hops[li - 1].find(([, v]) => v === s)?.[0] : undefined;
    const dn = useBelow ? hops[li]?.find(([u]) => u === s)?.[1] : undefined;
    let best = 0, bestCost = Infinity, bestOff = Infinity;
    for (let p = 0; p <= layer.length; p++) {
      let cost = 0;
      // an inserted slot at p sits left of here-index ≥ p
      const side = (x: Slot) => (here.get(x)! < p ? -1 : 1);
      if (up) for (const [u, v] of hops[li - 1]) {
        if (v === s || u === up || !here.has(v)) continue;
        if (Math.sign(above.get(u)! - above.get(up)!) !== side(v)) cost++;
      }
      if (dn) for (const [u, v] of hops[li]) {
        if (u === s || v === dn || !here.has(u)) continue;
        if (Math.sign(below.get(v)! - below.get(dn)!) !== side(u)) cost++;
      }
      // never between two boxes a same-rank wire joins directly
      const l = layer[p - 1], r = layer[p];
      if (l?.kind === "box" && r?.kind === "box" && beside.has(`${l.id}|${r.id}`)) cost += 100;
      // nearest to where its neighbours are, as a fraction of the row
      const fr = (m: Map<Slot, number>, x: Slot | undefined) => (x && m.size ? (m.get(x)! + 0.5) / m.size : undefined);
      const targets = [fr(above, up), fr(below, dn)].filter((x): x is number => x !== undefined);
      const target = targets.length ? targets.reduce((a, b) => a + b, 0) / targets.length : 0.5;
      const off = Math.abs(p / Math.max(1, layer.length) - target);
      if (cost < bestCost || (cost === bestCost && off < bestOff - 1e-9)) { best = p; bestCost = cost; bestOff = off; }
    }
    layer.splice(best, 0, s);
  };

  const free = (li: number) => layers[li].slots.filter((s) => s.kind !== "box");
  for (let li = 0; li < layers.length; li++) for (const s of free(li)) reinsert(li, s, true, li === 0);
  for (let li = layers.length - 1; li >= 0; li--) for (const s of free(li)) reinsert(li, s, true, true);
  for (let li = 0; li < layers.length; li++) for (const s of free(li)) reinsert(li, s, true, true);
}
