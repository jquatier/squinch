// `layoutViewGrid` — the spike's drop-in for `layoutView`.
//
// plan (Squinch → Problem) · solve (the engine) · dress (Solution →
// `Positioned`, the type the renderer and the invariant sweep already
// consume). The spike draws zone chips and nothing else from the annotation
// pass: notes and flow badges are placed *after* layout from nodes, wires and
// pills, so they do not depend on which engine produced those.

import type { SModel, SView, Side } from "../../src/model/types.js";
import type { Positioned, PEdge, PPort } from "../../src/layout/layout.js";
import { CHIP_H } from "../../src/layout/layout.js";
import { measure } from "../../src/metrics.js";
import type { ThemeFont } from "../../src/themes/index.js";
import { plan } from "./problem.js";
import { solve, type Rect, type Pt } from "./engine.js";

type Font = Pick<ThemeFont, "metrics" | "scale">;
const INTER: Font = { metrics: "inter", scale: 1 };

export function layoutViewGrid(model: SModel, view: SView, font: Font = INTER): { positioned: Positioned; skipped: string[] } {
  const p = plan(model, view, font);
  const sol = solve(p.problem);
  const rect = (id: string) => sol.boxes.get(id)!;

  const nodes = p.graph.nodes.map((n) => ({ ...n, ...rect(n.path), rank: sol.ranks.get(p.unitOf.get(n.path)!)! }));
  const frameDepth = (path: string): number => {
    const up = p.graph.frames.find((f) => f.path === path)?.frame;
    return up ? 1 + frameDepth(up) : 0;
  };
  const frames = p.graph.frames.map((f) => ({ path: f.path, label: f.label, ...rect(f.path), depth: frameDepth(f.path), color: f.color, icon: f.icon }));
  const zones = p.zones.map((pz) => {
    const z = model.zones.find((x) => x.id === pz.id)!;
    return { id: z.id, label: z.label ?? z.id, kind: z.kind, icon: z.icon, labelPos: z.labelPos, color: z.color, detail: z.detail, ...rect(pz.box), depth: pz.depth };
  });

  const ports: PPort[] = [];
  const edges: PEdge[] = p.graph.edges.filter((e) => sol.wires.has(e.id)).map((e) => {
    const w = sol.wires.get(e.id)!;
    for (const [node, pt] of [[e.from, w.points[0]], [e.to, w.points[w.points.length - 1]]] as const)
      ports.push({ edge: e.id, node, side: wallOf(rect(node), pt), x: pt.x, y: pt.y });
    return {
      id: e.id, from: e.from, to: e.to, label: e.label, async: e.async, animate: e.animate, style: e.style,
      count: e.count, tags: e.tags, color: e.color, heads: e.heads, points: w.points, labelRect: w.label,
      ...(p.problem.wires.find((x) => x.id === e.id)?.bundle === "wrap" ? { via: "bus" as const } : {}),
    };
  });

  // a frame title a wire runs through is drawn last, on a halo (PFrame.titleCrossed)
  const fx = (px: number) => Math.round(px * font.scale);
  for (const f of frames as (typeof frames[number] & { titleCrossed?: boolean })[]) {
    const title = {
      x: f.icon ? f.x + 12 : f.x + 14, y: f.icon ? f.y + 9 : f.y + 11,
      w: (f.icon ? 32 : 0) + Math.round(measure(f.label, fx(13), "500", font.metrics)), h: f.icon ? 24 : 17,
    };
    const crosses = (e: PEdge) => e.points.slice(1).some((b, i) => {
      const a = e.points[i];
      return Math.min(a.x, b.x) < title.x + title.w && Math.max(a.x, b.x) > title.x && Math.min(a.y, b.y) < title.y + title.h && Math.max(a.y, b.y) > title.y;
    });
    if (edges.some(crosses)) f.titleCrossed = true;
  }

  // zone chips: on the border, at the corner the zone asked for
  const chips = zones.map((z) => {
    const detailW = z.detail ? Math.round(measure(z.detail, fx(11), "400", "mono")) + 16 : 0;
    const w = Math.round(measure(z.label, fx(11), "500", font.metrics)) + 16 + (z.icon ? CHIP_H : 0) + detailW;
    return {
      x: z.labelPos.endsWith("right") ? z.x + z.w - 12 - w : z.x + 12,
      y: z.labelPos.startsWith("top") ? z.y - CHIP_H / 2 : z.y + z.h - CHIP_H / 2,
      w, h: CHIP_H, label: z.label, zone: z.id, icon: z.icon, ...(z.detail ? { detail: z.detail, detailW } : {}),
    };
  });

  return {
    positioned: {
      name: view.name, width: sol.width, height: sol.height,
      nodes, edges, ports, frames, zones, chips, badges: [], notes: [],
      flow: p.graph.flow, lines: view.layout.lines ?? "orthogonal",
    },
    skipped: sol.skipped,
  };
}

/** Which wall of `r` the point sits on. */
function wallOf(r: Rect, pt: Pt): Side {
  if (pt.y === r.y) return "north";
  if (pt.y === r.y + r.h) return "south";
  return pt.x === r.x ? "west" : "east";
}
