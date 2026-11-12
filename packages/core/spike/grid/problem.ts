// A Squinch view → a `Problem` the grid engine can solve.
//
// This file is the only place that knows both vocabularies. It decides three
// things and nothing else: the tree (which boxes sit in which container), the
// hints (what `rows`/`cols`/`place`/`wrap`/`direction` mean for each
// container), and the sizes. There is no geometry here.
//
// One rule covers every container — root, zone, expanded frame: project the
// hints onto that container's direct children and hand the engine the result.
// The ELK engine needed a separate mechanism per kind of container, and had
// none at all for a zone's inside.

import type { SModel, SView, RelPos } from "../../src/model/types.js";
import { resolveView, type ViewGraph, type VNode } from "../../src/view/resolve.js";
import { pillDims, sizeOf, SHEET_BLEED, CHIP_H } from "../../src/layout/layout.js";
import { measure } from "../../src/metrics.js";
import type { ThemeFont } from "../../src/themes/index.js";
import { assignRanks, dense, type Edge } from "./rank.js";
import type { Box, Dir, Group, Problem, Wire } from "./engine.js";

type Font = Pick<ThemeFont, "metrics" | "scale">;
export interface Hints { rows?: string[][]; cols?: string[][]; place: { node: string; relpos: RelPos; target: string }[] }
export interface PlannedZone { id: string; box: string; depth: number }
export interface Plan {
  problem: Problem;
  graph: ViewGraph;
  view: SView;
  zones: PlannedZone[];
  /** box id → the top-level box that holds it (itself when top-level) */
  unitOf: Map<string, string>;
}

const SPACING = { compact: [32, 40], comfortable: [48, 56], spacious: [72, 80] } as const;
const zoneBoxId = (id: string) => `zone:${id}`;

/** Rank pins and in-rank order for one container's direct children. */
export function arrange(
  members: readonly string[],
  hints: Hints,
  edges: readonly Edge[],
  down: boolean,
): { order: string[]; pins: Map<string, number> } {
  const pins = new Map<string, number>();
  hints.rows?.forEach((band, i) => band.forEach((m) => pins.set(m, i)));
  // `below`/`above` change band under a downward flow; `left-of`/`right-of`
  // do under a rightward one. The other pair orders within the band.
  const changesBand = (rp: RelPos) => (down ? rp === "above" || rp === "below" : rp === "left-of" || rp === "right-of");
  const towardsStart = (rp: RelPos) => rp === "above" || rp === "left-of";
  if (hints.place.length) {
    const natural = assignRanks(members, edges, pins);
    for (const pl of hints.place) {
      const t = pins.get(pl.target) ?? natural.get(pl.target);
      if (t === undefined) continue;
      // the target stays where it stands: "beside it" must not be answered
      // by moving the target away
      pins.set(pl.target, t);
      pins.set(pl.node, changesBand(pl.relpos) ? t + (towardsStart(pl.relpos) ? -1 : 1) : t);
    }
  }

  const order: string[] = [];
  for (const m of (hints.rows ?? []).flat()) if (!order.includes(m)) order.push(m);
  for (const m of members) if (!order.includes(m)) order.push(m);
  for (const pl of hints.place) {
    const from = order.indexOf(pl.node);
    if (from < 0 || !order.includes(pl.target)) continue;
    order.splice(from, 1);
    const i = order.indexOf(pl.target);
    order.splice(!changesBand(pl.relpos) && towardsStart(pl.relpos) ? i : i + 1, 0, pl.node);
  }
  if (hints.cols?.length) {
    const col = new Map<string, number>();
    hints.cols.forEach((c, i) => c.forEach((m) => col.set(m, i)));
    const slots = order.flatMap((m, i) => (col.has(m) ? [i] : []));
    const sorted = slots.map((i) => order[i]).sort((a, b) => col.get(a)! - col.get(b)! || order.indexOf(a) - order.indexOf(b));
    slots.forEach((slot, i) => { order[slot] = sorted[i]; });
  }
  return { order, pins };
}

/**
 * `wrap N` as the rows the author could have typed, for any graph: no row
 * holds more than N boxes.
 *
 * One chain folds as a serpentine — every other band runs backwards, so each
 * fold is a single step down. Anything else keeps its ranks and folds each
 * one that is too wide into bands of N; the wires from one source into the
 * later bands of a folded rank are a `bundle`, drawn as one trunk.
 *
 * (The ELK engine could fold exactly two shapes, one chain or one fan-out,
 * and warned on every other.)
 */
export function wrapRows(
  nodes: readonly string[], edges: readonly Edge[], n: number,
): Fold | undefined {
  const outs = new Map<string, string[]>(), ins = new Map<string, number>();
  for (const [a, b] of edges) { outs.set(a, [...(outs.get(a) ?? []), b]); ins.set(b, (ins.get(b) ?? 0) + 1); }
  const out = (p: string) => outs.get(p) ?? [];
  const heads = nodes.filter((p) => !ins.get(p));
  if (edges.length === nodes.length - 1 && heads.length === 1 && nodes.every((p) => out(p).length <= 1 && (ins.get(p) ?? 0) <= 1)) {
    const chain: string[] = [];
    for (let p: string | undefined = heads[0]; p && !chain.includes(p); p = out(p)[0]) chain.push(p);
    if (chain.length <= n) return undefined;
    const bands: string[][] = [];
    for (let i = 0; i * n < chain.length; i++) {
      const band = chain.slice(i * n, (i + 1) * n);
      bands.push(i % 2 ? band.reverse() : band);
    }
    return { bands, columns: columnsOf(bands), bundle: () => undefined, band: () => undefined };
  }

  const rank = dense(assignRanks(nodes, edges));
  const bands: string[][] = [];
  const fold = new Map<string, number>(); // box → which band of its folded rank
  const lastFold = new Map<number, number>(); // rank → its last band
  for (let r = 0; r <= Math.max(...rank.values()); r++) {
    const row = nodes.filter((p) => rank.get(p) === r);
    for (let i = 0; i * n < row.length; i++) {
      const band = row.slice(i * n, (i + 1) * n);
      band.forEach((p) => fold.set(p, i));
      lastFold.set(r, i);
      bands.push(band);
    }
  }
  if (bands.length === Math.max(...rank.values()) + 1) return undefined; // nothing was too wide
  const band = (id: string) => (fold.has(id) ? { rank: rank.get(id)!, index: fold.get(id)!, last: fold.get(id) === lastFold.get(rank.get(id)!) } : undefined);
  return {
    bands, band,
    columns: [...new Set(rank.values())].flatMap((r) => columnsOf(bands.filter((b) => rank.get(b[0]) === r))),
    // one trunk from a source into the later bands of a folded rank, and one
    // from its earlier bands on to a shared target
    bundle: (from, to) => {
      if (rank.get(from)! >= rank.get(to)!) return undefined;
      if (fold.get(to)! >= 1) return `wrap:${from}>${rank.get(to)}`;
      return fold.get(from)! < lastFold.get(rank.get(from)!)! ? `wrap:${rank.get(from)}>${to}` : undefined;
    },
  };
}

/** What `wrap` made of one container. */
export interface Fold {
  bands: string[][];
  /** The boxes that stand one under another across the bands of one rank. */
  columns: string[][];
  /** The trunk a wire between two members belongs to, if any. */
  bundle(from: string, to: string): string | undefined;
  /** Where a member sits in its folded rank. */
  band(id: string): { rank: number; index: number; last: boolean } | undefined;
}
const columnsOf = (bands: string[][]): string[][] =>
  Array.from({ length: Math.max(0, ...bands.map((b) => b.length)) }, (_, k) => bands.flatMap((b) => (b[k] ? [b[k]] : []))).filter((c) => c.length > 1);

export interface PlanOptions {
  /** `wrap N` for one container's inside, by container path — what a
   *  `wrap` line in that container's own `layout { }` would say. The grammar
   *  refuses the line there today, so the spike takes it from here. */
  wrap?: Record<string, number>;
}

export function plan(model: SModel, view: SView, font: Font, options: PlanOptions = {}): Plan {
  // a view standing inside a container inherits that container's own layout
  // block, unless it brings hints of its own (SPEC §6: all or nothing)
  const own = view.scope ? model.containers.get(view.scope)?.layout : undefined;
  const L = view.layout;
  if (own && !(L.rows || L.cols || L.place.length || L.direction || L.wrap))
    view = { ...view, layout: { ...L, rows: own.rows, cols: own.cols, place: own.place, direction: own.direction } };

  const graph = resolveView(model, view);
  const fx = (px: number) => Math.round(px * font.scale);
  const nodeAt = new Map(graph.nodes.map((n) => [n.path, n]));
  const frameAt = new Map(graph.frames.map((f) => [f.path, f]));
  const frameParent = (p: string) => nodeAt.get(p)?.frame ?? frameAt.get(p)?.frame;

  // ── the tree: root ⊃ zones ⊃ frames ⊃ leaves ──────────────────────────────
  const entities = [...graph.frames.filter((f) => !f.frame).map((f) => f.path), ...graph.nodes.filter((n) => !n.frame).map((n) => n.path)];
  const within = (path: string, member: string) => path === member || path.startsWith(member + ".");
  const zones = model.zones
    .map((z) => ({ z, set: new Set(entities.filter((e) => z.members.some((m) => within(e, m)))) }))
    .filter((x) => x.set.size > 0);
  /** The smallest zone that satisfies `covers` — a zone's parent, an entity's home. */
  const smallest = (covers: (set: Set<string>) => boolean) =>
    zones.filter((c) => covers(c.set)).sort((a, b) => a.set.size - b.set.size)[0]?.z.id;
  const zoneParent = new Map(zones.map((x) => [x.z.id,
    smallest((set) => set.size > x.set.size && [...x.set].every((e) => set.has(e)))]));
  const entityZone = new Map(entities.map((e) => [e, smallest((set) => set.has(e))]));

  const parent = new Map<string, string>(); // box id → container box id ("" = root)
  for (const e of entities) parent.set(e, entityZone.get(e) ? zoneBoxId(entityZone.get(e)!) : "");
  for (const x of zones) parent.set(zoneBoxId(x.z.id), zoneParent.get(x.z.id) ? zoneBoxId(zoneParent.get(x.z.id)!) : "");
  for (const p of [...nodeAt.keys(), ...frameAt.keys()]) if (frameParent(p)) parent.set(p, frameParent(p)!);
  const childrenOf = (container: string): string[] => [
    ...zones.filter((x) => parent.get(zoneBoxId(x.z.id)) === container).map((x) => zoneBoxId(x.z.id)),
    ...graph.frames.filter((f) => parent.get(f.path) === container).map((f) => f.path),
    ...graph.nodes.filter((n) => parent.get(n.path) === container).map((n) => n.path),
  ];
  /** The direct child of `container` that holds `path`. */
  const memberOf = (container: string, path: string): string | undefined => {
    for (let cur: string | undefined = path; cur !== undefined && parent.has(cur); cur = parent.get(cur))
      if (parent.get(cur) === container) return cur;
    return undefined;
  };
  const unitOf = new Map([...parent.keys()].map((p) => [p, memberOf("", p)!]));

  // ── hints, projected onto one container ───────────────────────────────────
  const project = (container: string, h: Hints): Hints & { named: number } => {
    const band = (paths: string[][] | undefined) =>
      paths?.map((b) => b.map((p) => memberOf(container, p)).filter((m): m is string => !!m)).filter((b) => b.length);
    const place = h.place.flatMap((pl) => {
      const node = memberOf(container, pl.node), target = memberOf(container, pl.target);
      return node && target && node !== target ? [{ node, relpos: pl.relpos, target }] : [];
    });
    const rows = band(h.rows), cols = band(h.cols);
    const named = new Set([...(rows ?? []).flat(), ...(cols ?? []).flat(), ...place.flatMap((p) => [p.node, p.target])]).size;
    return { rows: rows?.length ? rows : undefined, cols: cols?.length ? cols : undefined, place, named };
  };
  const liftedEdges = (container: string): Edge[] => graph.edges.flatMap((e) => {
    const a = memberOf(container, e.from), b = memberOf(container, e.to);
    return a && b && a !== b ? [[a, b] as const] : [];
  });
  const rootDir: Dir = view.layout.direction ?? "down";
  const dirOf = (container: string): Dir => {
    for (let c: string | undefined = container; c; c = parent.get(c)) {
      const d = model.containers.get(c)?.layout?.direction;
      if (d) return d;
    }
    return rootDir;
  };
  const viewHints: Hints = { rows: view.layout.rows, cols: view.layout.cols, place: view.layout.place };
  // `wrap N` folds whatever it is asked of: the view's reaches every
  // container the view opens, a container's own reaches that container.
  // (Under ELK a view holding an expanded container or a zone could not be
  // folded at all.) Each container folds its own direct children.
  const folds = new Map<string, Fold>();
  const foldOf = (container: string, members: readonly string[], edges: readonly Edge[]) => {
    const n = options.wrap?.[container] ?? view.layout.wrap?.n;
    const fold = n ? wrapRows(members, edges, n) : undefined;
    if (fold) folds.set(container, fold);
    return fold;
  };
  /** Wires drawn as one trunk: every `channel a, b -> c`, and those a fold
   *  bundled in the container where the wire's two ends part company. */
  const bundleOf = (from: string, to: string): string | undefined => {
    const ch = view.layout.channels.find((c) => c.target === to && c.sources.includes(from));
    if (ch) return `channel:${ch.target}`;
    for (const [container, fold] of folds) {
      const a = memberOf(container, from), b = memberOf(container, to);
      // between two members; out of an earlier band to one place outside;
      // into a later band from one place outside
      const bundle = a && b ? (a !== b ? fold.bundle(a, b) : undefined)
        : a ? (fold.band(a)?.last === false ? `wrap:${fold.band(a)!.rank}>${to}` : undefined)
        : b ? ((fold.band(b)?.index ?? 0) >= 1 ? `wrap:${from}>${fold.band(b)!.rank}` : undefined) : undefined;
      if (bundle) return `${bundle}@${container}`;
    }
    return undefined;
  };

  const [gapLane, gapRank] = SPACING[view.layout.density ?? "comfortable"];
  const group = (container: string): Group => {
    const dir = container === "" ? rootDir : dirOf(container);
    const fromView = project(container, viewHints);
    // a container's own block applies unless the view relates two of its members
    const block = model.containers.get(container)?.layout;
    const hints: Hints = container === "" || fromView.named >= 2 ? fromView : block ? project(container, block) : { place: [] };
    const members = childrenOf(container);
    // a fold is the rows line the author did not have to write
    const fold = !hints.rows && !hints.cols ? foldOf(container, members, liftedEdges(container)) : undefined;
    if (fold) hints.rows = fold.bands;
    const { order, pins } = arrange(members, hints, liftedEdges(container), dir === "down");
    const isFrame = frameAt.has(container), isZone = container.startsWith("zone:");
    const held = [...new Set([...(hints.rows ?? []).flat(), ...(hints.cols ?? []).flat(), ...hints.place.flatMap((pl) => [pl.node, pl.target])])];
    // `align a b c` and, under a downward flow, each `cols` column: one axis.
    // Only what lands in different ranks can share a lane.
    const sets = [
      ...view.layout.align.map((a) => a.nodes.map((p) => memberOf(container, p)).filter((m): m is string => !!m)),
      ...(dir === "down" ? hints.cols ?? [] : []),
      ...(fold?.columns ?? []), // the bands of a fold stand in columns
    ].map((set) => [...new Set(set)]).filter((set) => set.length > 1);
    return {
      dir, pins, held, aligned: sets, columns: dir === "down" && hints.cols && hints.cols.length > 1 ? hints.cols : undefined,
      boxes: order.map(box),
      pad: isFrame ? { top: 44, right: 16, bottom: 16, left: 16 }
        : isZone ? { top: 28, right: 20, bottom: 20, left: 20 }
        : { top: 32, right: 32, bottom: 32, left: 32 },
      gap: isFrame ? { lane: 32, rank: 40 } : { lane: gapLane, rank: gapRank },
    };
  };
  const leaf = (n: VNode): Box => {
    const { w, h } = sizeOf(n, font);
    return { id: n.path, w, h, face: n.fields ? 64 : undefined, bleed: n.kind === "card" ? SHEET_BLEED : undefined };
  };
  const box = (id: string): Box => {
    const n = nodeAt.get(id);
    if (n) return leaf(n);
    const f = frameAt.get(id);
    const z = zones.find((x) => zoneBoxId(x.z.id) === id)?.z;
    if (f) {
      // the header, as the renderer draws it: a 24px chip then the name, 34 deep
      const w = (f.icon ? 12 + 24 + 8 : 14) + Math.ceil(measure(f.label, fx(13), "500", font.metrics));
      return { id, w: 0, h: 0, minW: w + 16, title: { w, h: 34 }, group: group(id) };
    }
    const chip = 24 + (z!.icon ? CHIP_H : 0) + Math.ceil(measure(z!.label ?? z!.id, fx(11), "500", font.metrics)) + 16 + 24;
    return { id, w: 0, h: 0, minW: chip, group: group(id) };
  };

  const root = group(""); // before the wires: folding decides which of them are trunks
  const wires: Wire[] = graph.edges.map((e) => ({
    id: e.id, from: e.from, to: e.to,
    label: e.label ? { w: pillDims(e.label, font).w, h: 18 } : undefined,
    bundle: bundleOf(e.from, e.to),
  }));
  const depthOf = (id: string): number => (zoneParent.get(id) ? 1 + depthOf(zoneParent.get(id)!) : 0);
  return {
    problem: { root, wires }, graph, view, unitOf,
    zones: zones.map((x) => ({ id: x.z.id, box: zoneBoxId(x.z.id), depth: depthOf(x.z.id) })),
  };
}
