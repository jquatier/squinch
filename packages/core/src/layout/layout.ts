// SModel + SView → positioned diagram. Phase-0-proven architecture:
//   - declared ranks (rows/place) are ours, enforced via invisible scaffold edges
//   - same-rank ("coplanar") edges bypass ELK → our deterministic coplanar router
//   - one port per edge endpoint with FIXED_SIDE → ELK spreads ports + stubs
// ELK owns between-rank; we own within-rank. Keep that boundary crisp.
import ELK from "elkjs/lib/elk.bundled.js";
import { measure } from "../metrics.js";
import type { SModel, SEdge, SView, Side, Diagnostic } from "../model/types.js";

const TIERS = [120, 160, 200, 240];
const NODE_H = 64;
const PLATE = 40;
const PAD = 12;
const SIDE_UP: Record<string, string> = { north: "NORTH", south: "SOUTH", east: "EAST", west: "WEST" };

export interface PNode {
  path: string;
  x: number; y: number; w: number; h: number;
  label: string;
  icon?: { pack: string; id: string };
  tags: string[];
}
export interface PPort { edge: string; node: string; side: Side; x: number; y: number }
export interface PEdge {
  id: string; from: string; to: string;
  label?: string; async: boolean;
  points: { x: number; y: number }[];
}
export interface Positioned {
  name: string;
  width: number; height: number;
  nodes: PNode[]; edges: PEdge[]; ports: PPort[];
}

function nodeWidth(label: string): number {
  const need = PAD + PLATE + PAD + measure(label, 13, "500") + PAD;
  return TIERS.find((t) => t >= need) ?? TIERS[TIERS.length - 1];
}

export async function layoutView(
  model: SModel,
  view: SView,
): Promise<{ positioned: Positioned; diagnostics: Diagnostic[] }> {
  const diagnostics: Diagnostic[] = [];
  const scope = view.scope ?? "";
  const container = scope ? model.containers.get(scope) : undefined;

  // v1 slice: leaf nodes of the scope (nested containers land with system cards)
  const memberPaths = (container?.children ?? [...model.nodes.keys()]).filter((p) => {
    if (model.containers.has(p)) {
      diagnostics.push({
        severity: "warning",
        message: `nested container \`${p}\` not rendered yet (v1 slice)`,
        loc: view.loc,
      });
      return false;
    }
    return true;
  });
  const members = new Set(memberPaths);
  const edges = model.edges.filter((e) => members.has(e.from) && members.has(e.to));

  // ── ranks: declared (rows/place) + natural fill for unhinted nodes ────────
  const rank = new Map<string, number>();
  view.layout.rows?.forEach((row, i) => row.forEach((p) => rank.set(p, i)));
  for (const pl of view.layout.place) {
    const t = rank.get(pl.target);
    if (t !== undefined) rank.set(pl.node, t);
  }
  // natural rank for anything unhinted (longest path over scope edges)
  const natAll = new Map(memberPaths.map((p) => [p, 0]));
  for (let i = 0; i < memberPaths.length; i++)
    for (const e of edges)
      if (e.arrow !== "--")
        natAll.set(e.to, Math.max(natAll.get(e.to)!, natAll.get(e.from)! + 1));
  for (const p of memberPaths) if (!rank.has(p)) rank.set(p, natAll.get(p)!);

  // model order: rows order first, placed nodes after their targets, rest appended
  const order: string[] = view.layout.rows ? view.layout.rows.flat() : [];
  for (const pl of view.layout.place) {
    const i = order.indexOf(pl.target);
    if (i >= 0 && !order.includes(pl.node)) order.splice(i + 1, 0, pl.node);
  }
  for (const p of memberPaths) if (!order.includes(p)) order.push(p);

  // ── split edges: coplanar (same rank) vs cross-rank (ELK's) ──────────────
  const coplanar = edges.filter((e) => rank.get(e.from) === rank.get(e.to));
  const elkEdges = edges.filter((e) => rank.get(e.from) !== rank.get(e.to));

  // natural layer over ELK edges only → scaffold where too shallow
  const natural = new Map(memberPaths.map((p) => [p, 0]));
  for (let i = 0; i < memberPaths.length; i++)
    for (const e of elkEdges)
      natural.set(e.to, Math.max(natural.get(e.to)!, natural.get(e.from)! + 1));
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

  // route hints keyed by from|to
  const routeOf = new Map(view.layout.routes.map((r) => [`${r.from}|${r.to}`, r]));
  const sidesOf = (e: SEdge): { from: Side; to: Side } => {
    const hint = routeOf.get(`${e.from}|${e.to}`);
    const down = rank.get(e.from)! <= rank.get(e.to)!;
    return {
      from: hint?.fromSide ?? (down ? "south" : "north"),
      to: hint?.toSide ?? (down ? "north" : "south"),
    };
  };

  const children = order.map((p) => {
    const n = model.nodes.get(p)!;
    const ports = elkEdges.flatMap((e) => {
      const s = sidesOf(e);
      const out: any[] = [];
      if (e.from === p)
        out.push({ id: `${e.id}.src`, width: 0, height: 0, layoutOptions: { "elk.port.side": SIDE_UP[s.from] } });
      if (e.to === p)
        out.push({ id: `${e.id}.dst`, width: 0, height: 0, layoutOptions: { "elk.port.side": SIDE_UP[s.to] } });
      return out;
    });
    return {
      id: p,
      width: nodeWidth(n.label),
      height: NODE_H,
      ports,
      layoutOptions: { "elk.portConstraints": "FIXED_SIDE" },
    };
  });

  const graph = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": view.layout.direction === "right" ? "RIGHT" : "DOWN",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.layered.crossingMinimization.forceNodeModelOrder": "true",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.nodeNode": "48",
      "elk.layered.spacing.nodeNodeBetweenLayers": "56",
      "elk.layered.spacing.edgeNodeBetweenLayers": "24",
      "elk.spacing.edgeNode": "24",
      "elk.spacing.edgeEdge": "16",
      "elk.padding": "[top=32,left=32,bottom=32,right=32]",
    },
    children,
    edges: [
      ...elkEdges.map((e) => ({ id: e.id, sources: [`${e.id}.src`], targets: [`${e.id}.dst`] })),
      ...scaffold.map((s) => ({ id: s.id, sources: [s.from], targets: [s.to] })),
    ],
  };

  const out: any = await new ELK().layout(graph as any);
  const q = Math.round;

  const nodes: PNode[] = out.children.map((c: any) => {
    const n = model.nodes.get(c.id)!;
    return {
      path: c.id, x: q(c.x), y: q(c.y), w: q(c.width), h: q(c.height),
      label: n.label, icon: n.icon, tags: n.tags,
    };
  });
  const nodeById = new Map(nodes.map((n) => [n.path, n]));

  const SIDE_DOWN: Record<string, Side> = { NORTH: "north", SOUTH: "south", EAST: "east", WEST: "west" };
  const ports: PPort[] = out.children.flatMap((c: any) =>
    (c.ports ?? [])
      .filter((p: any) => !p.id.startsWith("scaffold."))
      .map((p: any) => ({
        edge: p.id.replace(/\.(src|dst)$/, ""),
        node: c.id,
        side: SIDE_DOWN[p.layoutOptions?.["elk.port.side"] ?? "SOUTH"],
        x: q(c.x + p.x),
        y: q(c.y + p.y),
      })),
  );

  const elkPositioned = new Map<string, PEdge>(
    out.edges
      .filter((e: any) => !e.id.startsWith("scaffold."))
      .map((e: any) => {
        const s = e.sections[0];
        const pts = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map((p: any) => ({ x: q(p.x), y: q(p.y) }));
        const m = edges.find((me) => me.id === e.id)!;
        return [e.id, { id: e.id, from: m.from, to: m.to, label: m.label, async: m.arrow === "~>", points: pts }];
      }),
  );

  // ── coplanar router (ours): adjacent → straight; blocked → below-band ────
  const coplanarEdges: PEdge[] = coplanar.map((e) => {
    const a = nodeById.get(e.from)!;
    const b = nodeById.get(e.to)!;
    const [l, r] = a.x <= b.x ? [a, b] : [b, a];
    const blocked = nodes.some(
      (n) => n.path !== a.path && n.path !== b.path && n.y === a.y && n.x > l.x && n.x < r.x,
    );
    if (!blocked) {
      const y = a.y + Math.round(a.h / 2);
      const pts = a.x <= b.x
        ? [{ x: a.x + a.w, y }, { x: b.x, y }]
        : [{ x: a.x, y }, { x: b.x + b.w, y }];
      ports.push(
        { edge: e.id, node: a.path, side: a.x <= b.x ? "east" : "west", x: pts[0].x, y },
        { edge: e.id, node: b.path, side: a.x <= b.x ? "west" : "east", x: pts[1].x, y },
      );
      return { id: e.id, from: e.from, to: e.to, label: e.label, async: e.arrow === "~>", points: pts };
    }
    const bandBottom = Math.max(...nodes.filter((n) => n.y === a.y).map((n) => n.y + n.h));
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
    return { id: e.id, from: e.from, to: e.to, label: e.label, async: e.arrow === "~>", points: pts };
  });

  const coplanarById = new Map(coplanarEdges.map((e) => [e.id, e]));
  const pEdges: PEdge[] = edges.map((e) => elkPositioned.get(e.id) ?? coplanarById.get(e.id)!);

  const height = Math.max(q(out.height), ...pEdges.flatMap((e) => e.points.map((p) => p.y + 32)));

  return {
    positioned: { name: view.name, width: q(out.width), height, nodes, edges: pEdges, ports },
    diagnostics,
  };
}
