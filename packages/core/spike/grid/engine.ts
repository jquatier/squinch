// The grid engine: boxes in ranks, wires in channels, containers inside-first.
//
// It knows nothing about Squinch. A `Problem` is boxes (some holding boxes),
// wires between them, and per container a direction, a spacing and the ranks
// the author pinned. A `Solution` is a rectangle per box and a polyline per
// wire. Everything Squinch-specific — views, zones, cards, hints — is turned
// into a Problem by `problem.ts` and back into a picture by `layout.ts`.
//
// `solve` does what spans containers: ranks and order for each (they need
// only who is joined to whom), which wall each wire uses where its two ends
// part company, then every container laid out innermost first (`group.ts`)
// and each wire stitched from the pieces the containers on its way drew.

import { sideOf } from "./axes.js";
import { layoutGroup } from "./group.js";
import { orderBoxes } from "./order.js";
import { assignRanks, dense, type Edge } from "./rank.js";
import type { Box, Group, Laid, Problem, Pt, Rect, Role, Route, Side, Solution, Wire } from "./types.js";

export type { Box, Dir, Group, Problem, Pt, Rect, Side, Solution, Wire } from "./types.js";
export { median } from "./place.js";

const ROOT = "";

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
    const own = dense(assignRanks(g.boxes.map((b) => b.id), edges, g.pins));
    for (const [box, r] of own) ranks.set(box, r);
    if (g.free) {
      const byId = new Map(g.boxes.map((b) => [b.id, b]));
      g.boxes = orderBoxes(g.boxes.map((b) => b.id), own, edges).map((id) => byId.get(id)!);
    }
  }

  // ── decide which wall each wire uses, where its ends part company ─────────
  const routes = new Map<string, Route>();
  for (const [home, list] of lifted) {
    const g = groups.get(home)!;
    const at = new Map(g.boxes.map((b, i) => [b.id, i]));
    for (const { wire, a, b, fromChain, toChain } of list) {
      const ra = ranks.get(a)!, rb = ranks.get(b)!;
      const side = (r: Role) => sideOf(g.dir, r);
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

  // ── lay out, innermost first — twice ──────────────────────────────────────
  // A container is laid out before its surroundings, so the first time it
  // puts each wall port where its own inside would like it. The second time
  // it knows which lane each wire arrives on and may meet it there.
  const laid = new Map<string, Laid>();
  let approach = new Map<string, Map<string, number>>();
  const layGroup = (id: string): Laid => {
    const g = groups.get(id)!;
    for (const b of g.boxes) if (b.group) {
      const inner = layGroup(b.id);
      b.w = inner.w; b.h = inner.h;
    }
    const out = layoutGroup(id, g, boxes.get(id), problem.wires, routes, ranks, laid, approach.get(id));
    laid.set(id, out);
    return out;
  };
  let top = layGroup(ROOT);
  if (groups.size > 1) {
    approach = new Map([...laid.values()].flatMap((l) => [...l.approach]));
    top = layGroup(ROOT);
  }

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

