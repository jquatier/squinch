// A Squinch view → a `Problem` the engine can solve.
//
// This file is the only place that knows both vocabularies. It decides three
// things and nothing else: the tree (which boxes sit in which container), the
// hints (what `rows`/`cols`/`place`/`wrap`/`direction` mean for each
// container), and the sizes. There is no geometry here.
//
// One rule covers every container — root, zone, expanded frame: project the
// hints onto that container's direct children and hand the engine the result.
// (The engine this replaced needed a separate mechanism per kind of container
// and had none for a zone's inside — docs/notes/layout-engine.md.)

import type { Diagnostic, SModel, SView, RelPos } from "../model/types.js";
import { resolveView, type ViewGraph, type VNode, type VEdge } from "../view/resolve.js";
import { noteBox, pillDims, sizeOf, SHEET_BLEED, CHIP_H, NOTE_CLEAR, NOTE_GAP, MARK_REACH } from "./sizes.js";
import { measure } from "../metrics.js";
import { BADGE_GAP, badgeWidth } from "./annotate.js";
import type { ThemeFont } from "../themes/index.js";
import { rankGroup as assignRanks, dense, type Edge } from "./weft/rank.js";
import type { Box, Dir, Group, Problem, Wire } from "./weft/contract.js";

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
  /** box id → the container box that holds it ("" for the root) */
  parentOf: Map<string, string>;
  /** Room kept beside a node for the note anchored to it, by note index:
   *  where it is, from the node's top-left corner. */
  noteRoom: Map<number, { dx: number; dy: number; w: number; h: number }>;
  /** Edge id → the note that shares that wire's label reservation. */
  edgeNote: Map<string, number>;
  /** What the view asks for that cannot be drawn as asked. */
  diagnostics: Diagnostic[];
}

const SPACING = { compact: [32, 40], comfortable: [48, 56], spacious: [72, 80] } as const;
/** How far off its wire a note anchored to an edge stands, past a pill `pill` wide. */
export const noteOff = (pill: number) => (pill ? Math.round(pill / 2) + NOTE_CLEAR : 16);
const NOTE_SIDE = { "right-of": "east", "left-of": "west", above: "north", below: "south" } as const;
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
 * (Before weft, `wrap` folded exactly two shapes — one chain or one fan-out —
 * and warned on every other; docs/notes/wrap.md.)
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
    const shift = bands.map((b, i) => (i % 2 ? n - b.length : 0));
    return { bands, columns: columnsOf(bands, shift), bundle: () => undefined, band: () => undefined };
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
/** `shift[i]`: how many columns band `i` starts in from the low side — a
 *  short band running backwards stands under the end of the one above. */
const columnsOf = (bands: string[][], shift: number[] = []): string[][] =>
  Array.from({ length: Math.max(0, ...bands.map((b) => b.length)) }, (_, k) =>
    bands.flatMap((b, i) => (b[k - (shift[i] ?? 0)] ? [b[k - (shift[i] ?? 0)]] : []))).filter((c) => c.length > 1);

/** Zones must form a clean hierarchy — with each other and with expanded
 *  containers — for the picture to be a tree. What does not is said here
 *  (SPEC §Zones), never silently dropped. */
function zoneDiagnostics(
  model: SModel, view: SView, graph: ViewGraph, zones: readonly { z: SModel["zones"][number]; set: Set<string> }[],
): Diagnostic[] {
  const out: Diagnostic[] = [];
  const within = (path: string, member: string) => path === member || path.startsWith(member + ".");
  const frameUp = new Map(graph.frames.map((f) => [f.path, f.frame]));
  const outermost = (frame: string): string => (frameUp.get(frame) ? outermost(frameUp.get(frame)!) : frame);
  const visible = new Map(zones.map((x) => [x.z.id, x.set]));
  for (const z of model.zones) {
    const set = visible.get(z.id);
    // any enclosing frame in the zone keeps a node whole — under `expand *`
    // the outermost frame is the one membership must cover, and the one to name
    for (const n of graph.nodes) {
      if (!n.frame || set?.has(outermost(n.frame)) || !z.members.some((m) => within(n.path, m))) continue;
      out.push({
        severity: "error",
        message: `zone \`${z.id}\` cuts through expanded container \`${outermost(n.frame)}\` (member \`${n.path}\`)`,
        fix: `contain the whole container (\`contains ${outermost(n.frame)}\`), or don't expand it in this view`,
        loc: z.loc,
      });
    }
    // a zone follows visibility by design, but in a view the author wrote it
    // does not vanish in silence
    if (!set && !view.auto)
      out.push({
        severity: "warning",
        message: `zone \`${z.id}\` has no visible members in view \`${view.name}\``,
        fix: z.members.length
          ? `its members (${z.members.join(", ")}) are inside collapsed cards here — \`expand\` one, or scope the view to them`
          : "the zone contains nothing",
        loc: z.loc,
      });
  }
  for (let i = 0; i < zones.length; i++)
    for (let j = i + 1; j < zones.length; j++) {
      const A = zones[i], B = zones[j];
      const shared = [...A.set].filter((e) => B.set.has(e));
      if (!shared.length) continue;
      const aOnly = [...A.set].filter((e) => !B.set.has(e)), bOnly = [...B.set].filter((e) => !A.set.has(e));
      if (aOnly.length && bOnly.length)
        out.push({
          severity: "error",
          message: `zones \`${A.z.id}\` and \`${B.z.id}\` partially overlap — visible zones must nest or stay disjoint`,
          fix: `shared: ${shared.join(", ")} · only ${A.z.id}: ${aOnly.join(", ")} · only ${B.z.id}: ${bOnly.join(", ")}`,
          loc: view.loc,
        });
      // identical sets cannot nest either way: neither is the other's parent
      else if (!aOnly.length && !bOnly.length)
        out.push({
          severity: "error",
          message: `zones \`${A.z.id}\` and \`${B.z.id}\` contain exactly the same members`,
          fix: `one boundary cannot sit inside the other: merge them, or give one a narrower \`contains\``,
          loc: view.loc,
        });
    }
  return out;
}

type Route = SView["layout"]["routes"][number];
/** A `route` line as a diagnostic quotes it. */
export const routeSaid = (r: Route) => `route ${r.from} -> ${r.to}${r.label ? ` "${r.label}"` : ""}`;
/** The `route` lines of a view that name this edge as the view draws it. */
export const routesOf = (view: SView, e: { from: string; to: string; label?: string }): Route[] =>
  view.layout.routes.filter((r) => r.from === e.from && r.to === e.to && (!r.label || r.label === e.label));
/** The sides an edge is asked to use: each end's from the first line that asks
 *  it (two lines that ask one end for different sides are an error, below). */
export const routeSides = (view: SView, e: { from: string; to: string; label?: string }) => {
  const lines = routesOf(view, e);
  return { fromSide: lines.find((r) => r.fromSide)?.fromSide, toSide: lines.find((r) => r.toSide)?.toSide };
};

/** Hints about wires that name something this view does not draw. */
function wireDiagnostics(view: SView, graph: ViewGraph): Diagnostic[] {
  const out: Diagnostic[] = [];
  const visible = new Set([...graph.nodes.map((n) => n.path), ...graph.frames.map((f) => f.path)]);
  const between = (from: string, to: string) => graph.edges.filter((e) => e.from === from && e.to === to).length;
  const drawn = { open: new Set(graph.frames.map((f) => f.path)), node: new Set(graph.nodes.map((n) => n.path)) };
  const said = routeSaid;
  // the line to write instead: the edge as this view draws it, with its own arrow
  const arrow = (e: ViewGraph["edges"][number]) => (e.heads === "none" ? "--" : e.heads === "both" ? "<->" : e.async ? "~>" : "->");
  const sides = (r: Route, swap = false) => { const [f, t] = swap ? [r.toSide, r.fromSide] : [r.fromSide, r.toSide]; return `${f ? ` from ${f}` : ""}${t ? ` to ${t}` : ""}`; };
  // how a drawn end stands to the one written: the same, the container around it, or something inside it
  const rel = (written: string, at: string) => (at === written ? 0 : written.startsWith(`${at}.`) ? 1 : at.startsWith(`${written}.`) ? -1 : undefined);
  for (const r of view.layout.routes) {
    const between = graph.edges.filter((e) => e.from === r.from && e.to === r.to);
    if (!r.label && between.length > 1)
      out.push({
        severity: "error",
        message: `${between.length} edges match \`route ${r.from} -> ${r.to}\``,
        fix: "add the edge's label to the route statement to disambiguate",
        loc: r.loc,
      });
    // A route names an edge as this view draws it. With a container collapsed
    // the edge is drawn from its card, and opened, from the node inside — so
    // a line written for one view can name nothing in another, and said
    // nothing. It says which spelling this view needs.
    if (between.some((e) => !r.label || e.label === r.label)) continue;
    const miss = (fix: string) => out.push({ severity: "warning", message: `\`${said(r)}\` names no edge drawn in this view`, fix, loc: r.loc });
    if (!r.fromSide && !r.toSide) { miss("the line asks for no side, so it does nothing anywhere — drop it"); continue; }
    // the same pair, another label: several edges lifted into one carry a count, not a label
    if (between.length) {
      const named = between.filter((e) => e.count === 1 && e.label).map((e) => `"${e.label}"`);
      miss(between.length === 1
        ? `the one edge between them here ${between[0].count > 1 ? `stands for ${between[0].count} edges merged into one` : named.length ? `is labelled ${named[0]}` : "has no label"} — drop the label from this line`
        : `the edges between them here are labelled ${named.join(", ")} — name one of those`);
      continue;
    }
    // the same edge at another altitude: both ends as written or lifted, or both as written or opened
    // — and, where the line names a label, the edge that carries it
    const kin = graph.edges.filter((e) => {
      const a = rel(r.from, e.from), b = rel(r.to, e.to);
      return a !== undefined && b !== undefined && a * b >= 0 && (a !== 0 || b !== 0);
    });
    const best = r.label && kin.some((e) => e.label === r.label) ? kin.filter((e) => e.label === r.label) : kin;
    if (best.length) {
      const e = best[0], twins = graph.edges.filter((x) => x.from === e.from && x.to === e.to).length > 1;
      // why each end is drawn where it is, read off the view and not off the spelling
      const why = [[r.from, e.from], [r.to, e.to]].flatMap(([written, at]) => {
        const k = rel(written, at);
        if (!k) return [];
        if (k > 0) return [drawn.open.has(at) ? `\`${written}\` is not drawn in this view, so its edge runs from \`${at}\`` : `\`${at}\` is collapsed here`];
        return [drawn.open.has(written) ? `\`${written}\` is open here` : `\`${at}\` is drawn at its own depth here`];
      });
      const pairs = [...new Set(best.map((x) => `${x.from} -> ${x.to}`))];
      miss(`${[...new Set(why)].join(" and ")}, so ${pairs.length > 1 ? `${pairs.length} edges are drawn for it (\`${pairs.slice(0, 3).join("`, `")}\`${pairs.length > 3 ? ", …" : ""}); for the first, ` : `the edge is drawn as \`${pairs[0]}\` — `}write \`route ${e.from} ${arrow(e)} ${e.to}${twins && e.label ? ` "${e.label}"` : ""}${sides(r)}\``);
      continue;
    }
    // the edge as declared runs the other way (a route follows the edge's own direction)
    const back = graph.edges.filter((e) => e.from === r.to && e.to === r.from && (!r.label || e.label === r.label));
    if (back.length) { miss(`the edge between them runs from \`${r.to}\` to \`${r.from}\`, and a route names an edge in its own direction — write \`route ${r.to} ${arrow(back[0])} ${r.from}${r.label ? ` "${r.label}"` : ""}${sides(r, true)}\``); continue; }
    const seen = (path: string) => drawn.open.has(path) || drawn.node.has(path);
    miss(seen(r.from) && seen(r.to) ? "both ends are drawn here, but no edge runs between them — drop the line" : "no edge between them is drawn here — drop the line, or bring both ends into the view");
  }
  // two lines for one edge: fine when each asks a different end, a contradiction when they ask one end for two sides
  for (const e of graph.edges) for (const end of ["from", "to"] as const) {
    const asking = routesOf(view, e).filter((r) => (end === "from" ? r.fromSide : r.toSide));
    const asked = [...new Set(asking.map((r) => (end === "from" ? r.fromSide : r.toSide)))];
    if (asked.length > 1)
      out.push({
        severity: "error",
        message: `\`${said(asking[1])}\` asks \`${end === "from" ? e.from : e.to}\` for its ${asked[1]} side, and another \`route\` line asks it for its ${asked[0]}`,
        fix: "an end of an edge leaves or enters by one side — keep one of the two lines",
        loc: asking[1].loc,
      });
  }
  for (const ch of view.layout.channels) {
    const members = ch.sources.filter((src) => visible.has(src) && between(src, ch.target) > 0);
    if (visible.has(ch.target) && members.length >= 2) continue;
    out.push({
      severity: "warning",
      message: `channel into \`${ch.target}\`: ${!visible.has(ch.target) ? "the target is not visible here" : "fewer than two of its edges are"}`,
      fix: "channels only apply where every member edge is visible in the view",
      loc: ch.loc,
    });
  }
  return out;
}

export function plan(model: SModel, view: SView, font: Font): Plan {
  // a view standing inside a container inherits that container's own layout
  // block, unless it brings hints of its own (SPEC §6: all or nothing)
  const own = view.scope ? model.containers.get(view.scope)?.layout : undefined;
  const L = view.layout;
  if (own && !(L.rows || L.cols || L.place.length || L.direction || L.wrap))
    view = { ...view, layout: { ...L, rows: own.rows, cols: own.cols, place: own.place, direction: own.direction, wrap: own.wrap } };

  const graph = resolveView(model, view);
  const diagnostics: Diagnostic[] = [...graph.diagnostics];
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
  diagnostics.push(...zoneDiagnostics(model, view, graph, zones));
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
    // a hint may name a zone by its own id (`rows [edge] [core]`)
    const start = !parent.has(path) && parent.has(zoneBoxId(path)) ? zoneBoxId(path) : path;
    for (let cur: string | undefined = start; cur !== undefined && parent.has(cur); cur = parent.get(cur))
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
  // Each container folds its own direct children.
  const folds = new Map<string, Fold>();
  const foldOf = (container: string, members: readonly string[], edges: readonly Edge[]) => {
    // a container's own `wrap` follows it into every view; the view's reaches the rest
    const n = model.containers.get(container)?.layout?.wrap?.n ?? view.layout.wrap?.n;
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
  // ── room for the notes anchored to a node: beside the wall each stands off ──
  const noteRoom = new Map<number, { dx: number; dy: number; w: number; h: number }>();
  const roomOf = new Map<string, NonNullable<Box["room"]>>();
  (view.notes ?? []).forEach((note, i) => {
    const n = note.anchor.kind === "relpos" ? nodeAt.get(note.anchor.target) : undefined;
    if (!n || note.anchor.kind !== "relpos") return;
    const size = sizeOf(n, font), nt = noteBox(note.text, font), side = NOTE_SIDE[note.anchor.relpos];
    const deep = NOTE_GAP + (side === "north" || side === "south" ? nt.h : nt.w);
    const room = roomOf.get(n.path) ?? roomOf.set(n.path, {}).get(n.path)!;
    room[side] = Math.max(room[side] ?? 0, deep);
    noteRoom.set(i, side === "north" ? { dx: 0, dy: -deep, w: size.w, h: deep }
      : side === "south" ? { dx: 0, dy: size.h, w: size.w, h: deep }
      : side === "west" ? { dx: -deep, dy: 0, w: deep, h: size.h }
      : { dx: size.w, dy: 0, w: deep, h: size.h });
  });
  const leaf = (n: VNode): Box => {
    const { w, h } = sizeOf(n, font);
    return { id: n.path, w, h, face: n.fields ? 64 : undefined, bleed: n.kind === "card" ? SHEET_BLEED : undefined, room: roomOf.get(n.path) };
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

  /** `route a -> b from east to west`: the walls a wire is asked to use. */
  const sidesOf = (e: ViewGraph["edges"][number]) => routeSides(view, e);
  // What a wire keeps room for, as one rect on the wire: its pill; with it a
  // flow badge (the annotation pass carves it back out — an unlabelled wire's
  // badge is a bead on the wire and reserves nothing); and the note anchored
  // to the edge, which the dresser carves out the same way.
  const edgeNote = new Map<string, number>(); // edge id → the first note anchored to it
  (view.notes ?? []).forEach((note, i) => {
    if (note.anchor.kind !== "edge") return;
    const { from, to } = note.anchor;
    const e = graph.edges.find((x) => x.from === from && x.to === to);
    if (e && !edgeNote.has(e.id)) edgeNote.set(e.id, i);
  });
  const reserve = (e: ViewGraph["edges"][number]): Wire["label"] => {
    const badge = badgeWidth(graph.flow, e.id, font);
    const pill = e.label ? pillDims(e.label, font).w + (badge ? badge + BADGE_GAP : 0) : 0;
    const note = edgeNote.has(e.id) ? noteBox(view.notes![edgeNote.get(e.id)!].text, font) : undefined;
    // (a flow badge on an unlabelled wire is a bead that reserves nothing —
    // except on a marked wire, where it needs a place clear of both marks)
    if (!note) return pill ? { w: pill, h: 18 } : badge && e.marks && view.layout.lines !== "straight" ? { w: badge, h: 18 } : undefined;
    // The pill stays centred on the wire and the note stands off to one side
    // of it — so the reservation, which the engine centres on the wire, is
    // that much to both sides: across the wire where it runs down, along it
    // where it runs rightward.
    const off = noteOff(pill);
    return flowAt(e) === "down"
      ? { w: 2 * (off + note.w), h: Math.max(pill ? 18 : 0, note.h) }
      : { w: Math.max(pill, note.w), h: 2 * ((pill ? 9 : 0) + NOTE_CLEAR + note.h) };
  };
  /** The flow of the container a wire's two ends part in — where its label stands. */
  const flowAt = (e: ViewGraph["edges"][number]): Dir => {
    const up = (id: string) => { const chain: string[] = []; for (let c = parent.get(id); c !== undefined; c = parent.get(c)) chain.push(c); return chain; };
    const a = up(e.from), lca = up(e.to).find((c) => a.includes(c)) ?? "";
    return lca === "" ? rootDir : dirOf(lca);
  };
  const root = group(""); // before the wires: folding decides which of them are trunks
  diagnostics.push(...wireDiagnostics(view, graph));
  // a `wrap` that folded nothing, anywhere it reaches, is said — never silent
  if (view.layout.wrap && !view.layout.rows && !view.layout.cols && folds.size === 0)
    diagnostics.push({
      severity: "warning",
      message: `\`wrap ${view.layout.wrap.n}\` has no effect — no row here is wider than ${view.layout.wrap.n}`,
      fix: "lower the number, or drop the line",
      loc: view.layout.wrap.loc,
    });
  const wires: Wire[] = graph.edges.map((e) => ({
    id: e.id, from: e.from, to: e.to,
    label: reserve(e),
    bundle: bundleOf(e.from, e.to),
    ...sidesOf(e),
    ...(e.marks && view.layout.lines !== "straight" ? { tips: { from: MARK_REACH, to: MARK_REACH } } : {}),
  }));
  // Wires of one trunk share a drawn end, and that end carries one mark. If
  // the edges mark it differently there is no one mark to draw (SPEC §4).
  const trunks = new Map<string, VEdge[]>();
  for (const w of wires) if (w.bundle) (trunks.get(w.bundle) ?? trunks.set(w.bundle, []).get(w.bundle)!).push(graph.edges.find((e) => e.id === w.id)!);
  for (const [bundle, members] of trunks) {
    if (members.length < 2 || !members.some((e) => e.marks)) continue;
    // members that meet the same box share the drawn end there — all of them
    // at the trunk's one end, and two edges between the same pair at both
    for (const end of ["to", "from"] as const) {
      const at = new Map<string, VEdge[]>();
      for (const e of members) (at.get(e[end]) ?? at.set(e[end], []).get(e[end])!).push(e);
      for (const [node, sharing] of at) {
        const said = [...new Set(sharing.map((e) => e.marks?.[end] ?? "no mark"))];
        if (sharing.length < 2 || said.length < 2) continue;
        const ch = bundle.startsWith("channel:") ? view.layout.channels.find((c) => `channel:${c.target}` === bundle) : undefined;
        const container = bundle.includes("@") ? bundle.slice(bundle.indexOf("@") + 1) : "";
        const wrapLoc = model.containers.get(container)?.layout?.wrap?.loc ?? view.layout.wrap?.loc;
        const bare = sharing.some((e) => !e.marks);
        diagnostics.push({
          severity: "error",
          message: `${ch ? "this `channel`" : "`wrap`"} draws ${sharing.length} edges ${end === "to" ? "into" : "out of"} \`${node}\` as one wire, and they mark that end differently — ${said.map((x) => `\`${x}\``).join(", ")}`,
          fix: `one drawn end carries one mark: give every one of these edges the same \`${end}:\`${bare ? " (an edge that cannot carry marks — async, styled, or lifted here — cannot share the wire)" : ""}, or ${ch ? "drop the `channel`" : "arrange the row by hand with `rows` instead of `wrap`"}`,
          loc: ch?.loc ?? wrapLoc ?? view.loc,
        });
      }
    }
  }
  const depthOf = (id: string): number => (zoneParent.get(id) ? 1 + depthOf(zoneParent.get(id)!) : 0);
  return {
    problem: { root, wires }, graph, view, unitOf, parentOf: parent, noteRoom, edgeNote, diagnostics,
    zones: zones.map((x) => ({ id: x.z.id, box: zoneBoxId(x.z.id), depth: depthOf(x.z.id) })),
  };
}
