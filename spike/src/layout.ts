// Model → ELK graph → positioned diagram. The hint mapping under test:
//   rows          → elk partitions (one partition per rank) + model order within rank
//   place right-of→ same partition as target, model-ordered immediately after it
//   route sides   → explicit ports with FIXED_SIDE constraints
//   port spread   → one port per edge endpoint, ELK distributes along the side
import ELK from "elkjs/lib/elk.bundled.js";
import { measure, fit } from "./metrics.js";
import type { Model, Side } from "./model.js";

const TIERS = [120, 160, 200, 240];
const NODE_H = 64;
const PLATE = 40;
const PAD = 12;

export interface PNode {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  icon: string;
  partition: number;
}
export interface PPort {
  edge: string;
  node: string;
  side: Side;
  x: number; // absolute
  y: number;
}
export interface PEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  async?: boolean;
  points: { x: number; y: number }[]; // absolute polyline, start → end
}
export interface Positioned {
  name: string;
  width: number;
  height: number;
  nodes: PNode[];
  edges: PEdge[];
  ports: PPort[];
}

function nodeWidth(label: string): number {
  const need = PAD + PLATE + PAD + measure(label, 13, "500") + PAD;
  return TIERS.find((t) => t >= need) ?? TIERS[TIERS.length - 1];
}

/** Rank of each node: its rows index, or the rank of its place-target. */
export function ranks(model: Model): Map<string, number> {
  const r = new Map<string, number>();
  model.rows.forEach((row, i) => row.forEach((id) => r.set(id, i)));
  for (const p of model.place) {
    const t = r.get(p.rightOf);
    if (t === undefined) throw new Error(`place target not ranked: ${p.rightOf}`);
    r.set(p.node, t);
  }
  const missing = model.nodes.filter((n) => !r.has(n.id));
  if (missing.length) throw new Error(`unranked nodes: ${missing.map((n) => n.id)}`);
  return r;
}

/** Child order: row-major, with placed nodes inserted right after their target. */
function modelOrder(model: Model): string[] {
  const order: string[] = model.rows.flat();
  for (const p of model.place) order.splice(order.indexOf(p.rightOf) + 1, 0, p.node);
  return order;
}

/** Which side an edge endpoint uses, honoring route overrides. */
function sides(model: Model, r: Map<string, number>, e: Model["edges"][number]) {
  const down = r.get(e.from)! <= r.get(e.to)!;
  return {
    from: e.route?.fromSide ?? (down ? "SOUTH" : "NORTH"),
    to: e.route?.toSide ?? (down ? "NORTH" : "SOUTH"),
  } as { from: Side; to: Side };
}

/**
 * Spike finding: ELK layered CANNOT keep an edge's endpoints in one layer — any
 * in-layer edge forces the target down (verified minimal-case; layerChoiceConstraint
 * ignored too). Architecture that follows:
 *   - "coplanar" edges (rank(from) == rank(to)) are excluded from the ELK graph and
 *     routed by our own deterministic coplanar router afterwards;
 *   - rank pinning is enforced with invisible SCAFFOLD edges: any node whose natural
 *     (longest-path) layer is shallower than its declared rank gets a dummy edge
 *     from a node in the rank above; deeper than declared = a genuine hint conflict.
 */
export async function layoutModel(model: Model): Promise<Positioned> {
  const r = ranks(model);
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const order = modelOrder(model);

  const coplanar = model.edges.filter((e) => r.get(e.from)! === r.get(e.to)!);
  const elkEdges = model.edges.filter((e) => r.get(e.from)! !== r.get(e.to)!);

  // Natural layer = longest path over cross-rank edges only.
  const natural = new Map<string, number>(model.nodes.map((n) => [n.id, 0]));
  for (let pass = 0; pass < model.nodes.length; pass++)
    for (const e of elkEdges)
      natural.set(e.to, Math.max(natural.get(e.to)!, natural.get(e.from)! + 1));

  const scaffold: { id: string; from: string; to: string }[] = [];
  for (const id of order) {
    const declared = r.get(id)!;
    const nat = natural.get(id)!;
    if (nat > declared)
      throw new Error(`hint conflict: ${id} declared rank ${declared} but edges force rank ${nat}`);
    if (nat < declared) {
      const feeder = order.find((f) => r.get(f)! === declared - 1);
      if (!feeder) throw new Error(`no feeder rank for ${id}`);
      scaffold.push({ id: `scaffold.${id}`, from: feeder, to: id });
    }
  }

  const children = order.map((id) => {
    const n = byId.get(id)!;
    const ports = elkEdges.flatMap((e) => {
      const s = sides(model, r, e);
      const out: any[] = [];
      if (e.from === id)
        out.push({ id: `${e.id}.src`, width: 0, height: 0, layoutOptions: { "elk.port.side": s.from } });
      if (e.to === id)
        out.push({ id: `${e.id}.dst`, width: 0, height: 0, layoutOptions: { "elk.port.side": s.to } });
      return out;
    });
    return {
      id,
      width: nodeWidth(n.label),
      height: NODE_H,
      ports,
      layoutOptions: {
        "elk.portConstraints": "FIXED_SIDE",
      },
    };
  });

  const graph = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.layered.crossingMinimization.forceNodeModelOrder": "true",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.spacing.nodeNode": "48",
      "elk.layered.spacing.nodeNodeBetweenLayers": "56",
      "elk.layered.spacing.edgeNodeBetweenLayers": "24",
      "elk.spacing.edgeNode": "24",
      "elk.spacing.edgeEdge": "16",
      "elk.padding": "[top=32,left=32,bottom=32,right=32]",
    },
    children,
    edges: [
      ...elkEdges.map((e) => ({
        id: e.id,
        sources: [`${e.id}.src`],
        targets: [`${e.id}.dst`],
      })),
      // Scaffold edges: node-to-node (implicit ports), never rendered.
      ...scaffold.map((s) => ({ id: s.id, sources: [s.from], targets: [s.to] })),
    ],
  };

  const out: any = await new ELK().layout(graph as any);

  const q = Math.round; // grid quantization: integers everywhere after layout
  const nodes: PNode[] = out.children.map((c: any) => ({
    id: c.id,
    x: q(c.x),
    y: q(c.y),
    w: q(c.width),
    h: q(c.height),
    label: byId.get(c.id)!.label,
    icon: byId.get(c.id)!.icon,
    partition: r.get(c.id)!,
  }));

  const ports: PPort[] = out.children.flatMap((c: any) =>
    (c.ports ?? [])
      .filter((p: any) => !p.id.startsWith("scaffold."))
      .map((p: any) => ({
        edge: p.id.replace(/\.(src|dst)$/, ""),
        node: c.id,
        side: p.layoutOptions?.["elk.port.side"] ??
          sideOf(q(c.x), q(c.y), q(c.width), q(c.height), q(c.x + p.x), q(c.y + p.y)),
        x: q(c.x + p.x),
        y: q(c.y + p.y),
      })),
  );

  const elkPositioned = new Map<string, PEdge>(
    out.edges
      .filter((e: any) => !e.id.startsWith("scaffold."))
      .map((e: any) => {
        const s = e.sections[0];
        const pts = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map((p: any) => ({
          x: q(p.x),
          y: q(p.y),
        }));
        const m = model.edges.find((me) => me.id === e.id)!;
        return [e.id, { id: e.id, from: m.from, to: m.to, label: m.label, async: m.async, points: pts }];
      }),
  );

  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  // ── Coplanar router: deterministic routing for same-rank edges ────────────
  const coplanarEdges: PEdge[] = coplanar.map((e) => {
    const a = nodeById.get(e.from)!;
    const b = nodeById.get(e.to)!;
    const [l, rt] = a.x <= b.x ? [a, b] : [b, a];
    const blocked = nodes.some(
      (n) => n.id !== a.id && n.id !== b.id && n.y === a.y && n.x > l.x && n.x < rt.x,
    );
    if (!blocked) {
      // adjacent: straight run between facing sides (route east→west or default)
      const y = a.y + Math.round(a.h / 2);
      const pts =
        a.x <= b.x
          ? [{ x: a.x + a.w, y }, { x: b.x, y }]
          : [{ x: a.x, y }, { x: b.x + b.w, y }];
      ports.push(
        { edge: e.id, node: a.id, side: a.x <= b.x ? "EAST" : "WEST", x: pts[0].x, y },
        { edge: e.id, node: b.id, side: a.x <= b.x ? "WEST" : "EAST", x: pts[1].x, y },
      );
      return { id: e.id, from: e.from, to: e.to, label: e.label, async: e.async, points: pts };
    }
    // non-adjacent: dip below the band — south out, across, south in
    const bandBottom = Math.max(
      ...nodes.filter((n) => n.y === a.y).map((n) => n.y + n.h),
    );
    const lane = bandBottom + 24;
    const ax = a.x + Math.round(a.w / 2);
    const bx = b.x + Math.round(b.w / 2);
    const pts = [
      { x: ax, y: a.y + a.h },
      { x: ax, y: lane },
      { x: bx, y: lane },
      { x: bx, y: b.y + b.h },
    ];
    ports.push(
      { edge: e.id, node: a.id, side: "SOUTH", x: ax, y: a.y + a.h },
      { edge: e.id, node: b.id, side: "SOUTH", x: bx, y: b.y + b.h },
    );
    return { id: e.id, from: e.from, to: e.to, label: e.label, async: e.async, points: pts };
  });

  const coplanarById = new Map(coplanarEdges.map((e) => [e.id, e]));
  const edges: PEdge[] = model.edges.map(
    (e) => elkPositioned.get(e.id) ?? coplanarById.get(e.id)!,
  );

  // Canvas may need room for the below-band lane.
  const height = Math.max(q(out.height), ...edges.flatMap((e) => e.points.map((p) => p.y + 32)));

  return {
    name: model.name,
    width: q(out.width),
    height,
    nodes,
    edges,
    ports,
  };
}

function sideOf(nx: number, ny: number, nw: number, nh: number, px: number, py: number): Side {
  if (px <= nx) return "WEST";
  if (px >= nx + nw) return "EAST";
  if (py <= ny) return "NORTH";
  return "SOUTH";
}

export { fit, measure };
