// ViewGraph → positioned diagram. Phase-0-proven architecture:
//   - declared ranks (rows/place) are ours, enforced via invisible scaffold edges
//   - same-rank ("coplanar") edges bypass ELK → our deterministic coplanar router
//   - one port per edge endpoint with FIXED_SIDE → ELK spreads ports + stubs
// ELK owns between-rank; we own within-rank. Keep that boundary crisp.
import ELK from "elkjs/lib/elk.bundled.js";
import { measure } from "../metrics.js";
import { resolveView } from "../view/resolve.js";
import type { VNode, VEdge } from "../view/resolve.js";
import type { SModel, SView, Side, Diagnostic } from "../model/types.js";

const LEAF_TIERS = [120, 160, 200, 240];
const CARD_TIERS = [200, 240, 280, 320];
const LEAF_H = 64;
const CARD_H = 88;
const PLATE = 40;
const PAD = 12;
const SIDE_UP: Record<string, string> = { north: "NORTH", south: "SOUTH", east: "EAST", west: "WEST" };
const SIDE_DOWN: Record<string, Side> = { NORTH: "north", SOUTH: "south", EAST: "east", WEST: "west" };

export interface PNode extends VNode {
  x: number; y: number; w: number; h: number;
  rank: number;
}
export interface PPort { edge: string; node: string; side: Side; x: number; y: number }
export interface PFrame { path: string; label: string; x: number; y: number; w: number; h: number }
export interface PEdge {
  id: string; from: string; to: string;
  label?: string; async: boolean; count: number;
  points: { x: number; y: number }[];
}
export interface Positioned {
  name: string;
  width: number; height: number;
  nodes: PNode[]; edges: PEdge[]; ports: PPort[]; frames: PFrame[];
  lines: "orthogonal" | "curved" | "straight";
}

function sizeOf(n: VNode): { w: number; h: number } {
  const isCard = n.kind === "card" || n.kind === "context-card";
  if (isCard) {
    const need = PAD + Math.max(measure(n.label, 15, "500"), measure(n.tagline ?? "", 11, "400")) + PAD + 28;
    return { w: CARD_TIERS.find((t) => t >= need) ?? CARD_TIERS[CARD_TIERS.length - 1], h: CARD_H };
  }
  const need = PAD + PLATE + PAD + measure(n.label, 13, "500") + PAD;
  return { w: LEAF_TIERS.find((t) => t >= need) ?? LEAF_TIERS[LEAF_TIERS.length - 1], h: LEAF_H };
}

export async function layoutView(
  model: SModel,
  view: SView,
): Promise<{ positioned: Positioned; diagnostics: Diagnostic[] }> {
  const graph = resolveView(model, view);
  const diagnostics = [...graph.diagnostics];
  const byPath = new Map(graph.nodes.map((n) => [n.path, n]));
  const memberPaths = graph.nodes.map((n) => n.path);
  const edges: VEdge[] = graph.edges;

  // Top "entities": frames count as one unit for ranking/order; framed nodes
  // project to their frame. Inside frames, ELK's natural layering rules.
  const entityOf = (p: string) => byPath.get(p)?.frame ?? p;
  const entities = [
    ...graph.frames.map((f) => f.path),
    ...graph.nodes.filter((n) => !n.frame).map((n) => n.path),
  ];
  const entitySet = new Set(entities);

  // ── ranks: declared (rows/place) + natural fill, at entity level ─────────
  const rank = new Map<string, number>();
  view.layout.rows?.forEach((row, i) =>
    row.forEach((p) => entitySet.has(entityOf(p)) && rank.set(entityOf(p), i)),
  );
  for (const pl of view.layout.place) {
    const t = rank.get(entityOf(pl.target));
    if (t !== undefined) rank.set(entityOf(pl.node), t);
  }
  const natAll = new Map(entities.map((p) => [p, 0]));
  for (let i = 0; i < entities.length; i++)
    for (const e of edges) {
      const ef = entityOf(e.from), et = entityOf(e.to);
      if (ef !== et) natAll.set(et, Math.max(natAll.get(et)!, natAll.get(ef)! + 1));
    }
  for (const p of entities) if (!rank.has(p)) rank.set(p, natAll.get(p)!);

  // model order over entities: rows first, placed after targets, rest in resolve order
  const order: string[] = [];
  for (const p of (view.layout.rows ?? []).flat().map(entityOf))
    if (entitySet.has(p) && !order.includes(p)) order.push(p);
  for (const pl of view.layout.place) {
    const i = order.indexOf(entityOf(pl.target));
    const n = entityOf(pl.node);
    if (i >= 0 && !order.includes(n)) order.splice(i + 1, 0, n);
  }
  for (const p of entities) if (!order.includes(p)) order.push(p);

  // ── edge classes: inner (same entity) | coplanar (same rank, both bare) |
  //    cross-rank (ELK's) ────────────────────────────────────────────────────
  const inner = (e: VEdge) => entityOf(e.from) === entityOf(e.to) && byPath.get(e.from)?.frame;
  const coplanar = edges.filter(
    (e) =>
      !inner(e) &&
      rank.get(entityOf(e.from)) === rank.get(entityOf(e.to)) &&
      !byPath.get(e.from)?.frame &&
      !byPath.get(e.to)?.frame,
  );
  const coplanarSet = new Set(coplanar.map((e) => e.id));
  for (const e of edges) {
    if (
      !inner(e) && !coplanarSet.has(e.id) &&
      rank.get(entityOf(e.from)) === rank.get(entityOf(e.to))
    )
      diagnostics.push({
        severity: "warning",
        message: `same-rank edge ${e.from} → ${e.to} crosses an expanded container — layout quality may degrade`,
        loc: view.loc,
      });
  }
  const elkEdges = edges.filter((e) => !coplanarSet.has(e.id));

  const natural = new Map(entities.map((p) => [p, 0]));
  for (let i = 0; i < entities.length; i++)
    for (const e of elkEdges) {
      const ef = entityOf(e.from), et = entityOf(e.to);
      if (ef !== et) natural.set(et, Math.max(natural.get(et)!, natural.get(ef)! + 1));
    }
  const scaffold: { id: string; from: string; to: string }[] = [];
  for (const p of order) {
    const declared = rank.get(p)!;
    const nat = natural.get(p)!;
    if (nat > declared)
      diagnostics.push({
        severity: "error",
        message: `hint conflict: \`${p}\` is declared in rank ${declared} but its edges force rank ${nat}`,
        fix: "move it down in `rows`, or reroute the conflicting edge",
        loc: view.loc,
      });
    if (nat < declared) {
      const feeder = order.find((f) => rank.get(f)! === declared - 1);
      if (feeder) scaffold.push({ id: `scaffold.${p}`, from: feeder, to: p });
    }
  }

  // route hints: exact (from|to|label) beats pairwise (from|to); a pairwise hint
  // on an ambiguous parallel pair is a check error per SPEC §4.
  const routeExact = new Map(
    view.layout.routes.filter((r) => r.label).map((r) => [`${r.from}|${r.to}|${r.label}`, r]),
  );
  const routePair = new Map(
    view.layout.routes.filter((r) => !r.label).map((r) => [`${r.from}|${r.to}`, r]),
  );
  const pairCount = new Map<string, number>();
  for (const e of edges) {
    const k = `${e.from}|${e.to}`;
    pairCount.set(k, (pairCount.get(k) ?? 0) + 1);
  }
  for (const r of view.layout.routes) {
    if (!r.label && (pairCount.get(`${r.from}|${r.to}`) ?? 0) > 1)
      diagnostics.push({
        severity: "error",
        message: `${pairCount.get(`${r.from}|${r.to}`)} edges match \`route ${r.from} -> ${r.to}\``,
        fix: "add the edge's label to the route statement to disambiguate",
        loc: r.loc,
      });
  }
  const sidesOf = (e: VEdge): { from: Side; to: Side } => {
    const hint =
      routeExact.get(`${e.from}|${e.to}|${e.label}`) ?? routePair.get(`${e.from}|${e.to}`);
    const down = rank.get(entityOf(e.from))! <= rank.get(entityOf(e.to))!;
    return {
      from: hint?.fromSide ?? (down ? "south" : "north"),
      to: hint?.toSide ?? (down ? "north" : "south"),
    };
  };

  const leafChild = (p: string) => {
    const n = byPath.get(p)!;
    const { w, h } = sizeOf(n);
    const ports = elkEdges.flatMap((e) => {
      const s = sidesOf(e);
      const out: any[] = [];
      if (e.from === p)
        out.push({ id: `${e.id}.src`, width: 0, height: 0, layoutOptions: { "elk.port.side": SIDE_UP[s.from] } });
      if (e.to === p)
        out.push({ id: `${e.id}.dst`, width: 0, height: 0, layoutOptions: { "elk.port.side": SIDE_UP[s.to] } });
      return out;
    });
    return { id: p, width: w, height: h, ports, layoutOptions: { "elk.portConstraints": "FIXED_SIDE" } };
  };

  const frameLabels = new Map(graph.frames.map((f) => [f.path, f.label]));
  const framedChildren = (framePath: string) =>
    graph.nodes.filter((n) => n.frame === framePath).map((n) => leafChild(n.path));

  const children = order.map((p) =>
    frameLabels.has(p)
      ? {
          id: p,
          layoutOptions: {
            "elk.padding": "[top=44,left=16,bottom=16,right=16]",
            "elk.spacing.nodeNode": "32",
            "elk.layered.spacing.nodeNodeBetweenLayers": "40",
          },
          children: framedChildren(p),
        }
      : leafChild(p),
  );

  const density = view.layout.density ?? "comfortable";
  const SP = { compact: [32, 40], comfortable: [48, 56], spacious: [72, 84] }[density];
  const elkGraph = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": view.layout.direction === "right" ? "RIGHT" : "DOWN",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.layered.crossingMinimization.forceNodeModelOrder": "true",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.nodeNode": String(SP[0]),
      "elk.layered.spacing.nodeNodeBetweenLayers": String(SP[1]),
      "elk.layered.spacing.edgeNodeBetweenLayers": "24",
      "elk.spacing.edgeNode": "24",
      "elk.spacing.edgeEdge": "16",
      "elk.padding": "[top=32,left=32,bottom=32,right=32]",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
    },
    children,
    edges: [
      ...elkEdges.map((e) => ({ id: e.id, sources: [`${e.id}.src`], targets: [`${e.id}.dst`] })),
      ...scaffold.map((s) => ({ id: s.id, sources: [s.from], targets: [s.to] })),
    ],
  };

  const out: any = await new ELK().layout(elkGraph as any);
  const q = Math.round;

  // recursive extraction: compound (frame) children carry parent-relative coords
  const nodes: PNode[] = [];
  const frames: PFrame[] = [];
  const ports: PPort[] = [];
  const walk = (c: any, ox: number, oy: number) => {
    const x = q(ox + c.x), y = q(oy + c.y);
    if (frameLabels.has(c.id)) {
      frames.push({ path: c.id, label: frameLabels.get(c.id)!, x, y, w: q(c.width), h: q(c.height) });
      for (const child of c.children ?? []) walk(child, x, y);
      return;
    }
    nodes.push({
      ...byPath.get(c.id)!,
      x, y, w: q(c.width), h: q(c.height),
      rank: rank.get(entityOf(c.id))!,
    });
    for (const p of c.ports ?? []) {
      if (p.id.startsWith("scaffold.")) continue;
      ports.push({
        edge: p.id.replace(/\.(src|dst)$/, ""),
        node: c.id,
        side: SIDE_DOWN[p.layoutOptions?.["elk.port.side"] ?? "SOUTH"],
        x: q(x + p.x),
        y: q(y + p.y),
      });
    }
  };
  for (const c of out.children) walk(c, 0, 0);
  const nodeById = new Map(nodes.map((n) => [n.path, n]));

  const elkPositioned = new Map<string, PEdge>(
    out.edges
      .filter((e: any) => !e.id.startsWith("scaffold."))
      .map((e: any) => {
        const s = e.sections[0];
        const pts = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map((p: any) => ({ x: q(p.x), y: q(p.y) }));
        const m = edges.find((me) => me.id === e.id)!;
        return [e.id, { id: e.id, from: m.from, to: m.to, label: m.label, async: m.async, count: m.count, points: pts }];
      }),
  );

  // ── coplanar router (ours): adjacent → straight; blocked → below-band ────
  const coplanarEdges: PEdge[] = coplanar.map((e) => {
    const a = nodeById.get(e.from)!;
    const b = nodeById.get(e.to)!;
    const [l, r] = a.x <= b.x ? [a, b] : [b, a];
    const blocked = nodes.some(
      (n) => n.path !== a.path && n.path !== b.path && n.rank === a.rank && n.x > l.x && n.x < r.x,
    );
    const midY = (n: PNode) => n.y + Math.round(n.h / 2);
    if (!blocked) {
      const y = midY(a);
      const pts = a.x <= b.x
        ? [{ x: a.x + a.w, y }, { x: b.x, y }]
        : [{ x: a.x, y }, { x: b.x + b.w, y }];
      ports.push(
        { edge: e.id, node: a.path, side: a.x <= b.x ? "east" : "west", x: pts[0].x, y },
        { edge: e.id, node: b.path, side: a.x <= b.x ? "west" : "east", x: pts[1].x, y },
      );
      return { id: e.id, from: e.from, to: e.to, label: e.label, async: e.async, count: e.count, points: pts };
    }
    const bandBottom = Math.max(...nodes.filter((n) => n.rank === a.rank).map((n) => n.y + n.h));
    const lane = bandBottom + 24;
    const ax = a.x + Math.round(a.w / 2);
    const bx = b.x + Math.round(b.w / 2);
    const pts = [
      { x: ax, y: a.y + a.h }, { x: ax, y: lane },
      { x: bx, y: lane }, { x: bx, y: b.y + b.h },
    ];
    ports.push(
      { edge: e.id, node: a.path, side: "south", x: ax, y: a.y + a.h },
      { edge: e.id, node: b.path, side: "south", x: bx, y: b.y + b.h },
    );
    return { id: e.id, from: e.from, to: e.to, label: e.label, async: e.async, count: e.count, points: pts };
  });

  const coplanarById = new Map(coplanarEdges.map((e) => [e.id, e]));
  const pEdges: PEdge[] = edges.map((e) => elkPositioned.get(e.id) ?? coplanarById.get(e.id)!);

  const height = Math.max(
    q(out.height),
    ...pEdges.flatMap((e) => e.points.map((p) => p.y + 32)),
  );

  return {
    positioned: {
      name: view.name, width: q(out.width), height, nodes, edges: pEdges, ports, frames,
      lines: view.layout.lines ?? "orthogonal",
    },
    diagnostics,
  };
}
