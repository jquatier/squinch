// A view laid out: `layoutView(model, view)` → `Positioned`.
//
//   plan      the view as a layout problem — the tree of containers, the
//             hints projected onto each, the sizes               (plan.ts)
//   solve     ranks, order, positions, routes                     (weft/)
//   dress     the solution as `Positioned`: nodes, frames, zones, wires, ports
//   annotate  flow badges, zone chips, crossed titles, notes
//                                                  (annotate.ts, notes.ts)
//
// The engine knows nothing about Squinch and this file knows nothing about
// how a layout is found; `plan.ts` is the only place that speaks both. Why the
// engine is what it is: docs/notes/layout-engine.md.
import type { Diagnostic, SModel, SView, Side } from "../model/types.js";
import type { ThemeFont } from "../themes/index.js";
import { crowdedMarks } from "./marks.js";
import { annotate, BADGE_GAP, badgeWidth, markCrossedTitles } from "./annotate.js";
import { placeNotes } from "./notes.js";
import { noteOff, plan } from "./plan.js";
import type { Positioned, PEdge, PPort } from "./positioned.js";
import { INTER, NOTE_CLEAR, noteBox, pillDims } from "./sizes.js";
import { solve } from "./weft/engine.js";
import type { Rect, Pt } from "./weft/contract.js";

const OPPOSITE: Record<Side, Side> = { north: "south", south: "north", east: "west", west: "east" };

export * from "./sizes.js";
export type * from "./positioned.js";

type Font = Pick<ThemeFont, "metrics" | "scale">;

/** Lay one view out. Synchronous work behind a Promise: every host awaits
 *  it, and the signature has outlived the engine that needed it. */
export async function layoutView(
  model: SModel, view: SView, font: Font = INTER,
): Promise<{ positioned: Positioned; diagnostics: Diagnostic[] }> {
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

  // Straight lines run from first point to last: the stub a mark stands on
  // is not in the picture, and a mark turned to the wire's angle would need
  // geometry off the integer grid. So they are not drawn, and that is said.
  const straight = view.layout.lines === "straight";
  const unmarked = straight ? p.graph.edges.filter((e) => e.marks && sol.wires.has(e.id)).length : 0;
  if (unmarked)
    p.diagnostics.push({
      severity: "warning",
      message: `\`lines straight\` draws no relationship marks — ${unmarked} marked edge${unmarked > 1 ? "s" : ""} in this view ${unmarked > 1 ? "lose theirs" : "loses its"}`,
      fix: "drop `lines straight` from this view's `layout { }`; the marks stand on the straight run a wire makes out of its table",
      loc: view.loc,
    });
  const ports: PPort[] = [];
  const edges: PEdge[] = p.graph.edges.filter((e) => sol.wires.has(e.id)).map((e) => {
    const w = sol.wires.get(e.id)!;
    for (const [node, pt] of [[e.from, w.points[0]], [e.to, w.points[w.points.length - 1]]] as const)
      ports.push({ edge: e.id, node, side: wallOf(rect(node), pt), x: pt.x, y: pt.y });
    return {
      id: e.id, from: e.from, to: e.to, label: e.label, async: e.async, animate: e.animate, style: e.style,
      count: e.count, tags: e.tags, color: e.color, heads: e.heads, points: w.points, labelRect: w.label,
      ...(e.marks && !straight ? { marks: e.marks } : {}),
      ...(p.problem.wires.find((x) => x.id === e.id)?.bundle?.startsWith("wrap") ? { via: "bus" as const } : {}),
    };
  });

  // an edge the engine cannot draw is said, never dropped in silence
  for (const id of sol.skipped) {
    const e = p.graph.edges.find((x) => x.id === id);
    if (e) p.diagnostics.push({
      severity: "warning",
      message: `\`${e.from}\` → \`${e.to}\` is not drawn — one end is inside the other`,
      fix: "point the edge at a member of the container instead, or collapse the container in this view",
      loc: view.loc,
    });
  }

  // `align` and `cols` ask for a shared axis; where the layout could not give
  // one, say which and why (SPEC §6: never silently dropped)
  const diagnostics = [...p.diagnostics];
  const axis = (view.layout.direction ?? "down") === "right" ? "y" : "x", span = axis === "x" ? "w" : "h";
  const asked = [
    ...view.layout.align.map((g) => ({ nodes: g.nodes, loc: g.loc, from: "align" })),
    ...(view.layout.cols ?? []).filter((c) => c.length > 1).map((nodes) => ({ nodes, loc: view.loc, from: "cols" })),
  ];
  for (const g of asked) {
    const found = g.nodes.filter((path) => sol.boxes.has(path));
    if (found.length < 2) continue;
    const centre = (path: string) => rect(path)[axis] + Math.round(rect(path)[span] / 2);
    const off = found.filter((path) => centre(path) !== centre(found[0]));
    if (!off.length) continue;
    const list = g.nodes.join(" ");
    const oneRank = found.every((path) => sol.ranks.get(path) === sol.ranks.get(found[0]) && p.parentOf.get(path) === p.parentOf.get(found[0]));
    diagnostics.push(oneRank
      ? {
        severity: "warning",
        message: `${g.from} \`[${list}]\` — all ${found.length} sit on the same rank, so they cannot share an axis`,
        fix: `to put them side by side write \`rows [${list}]\`; \`${g.from}\` stacks nodes *across* ranks`,
        loc: g.loc,
      }
      : {
        severity: "warning",
        message: `${g.from} \`[${list}]\` — ${off.map((x) => `\`${x}\``).join(", ")} could not be put on \`${found[0]}\`'s axis`,
        fix: `they sit in different containers, or another hint holds them apart; align the containers themselves, or drop one of the hints`,
        loc: g.loc,
      });
  }

  // A note anchored to an edge shared that wire's reservation, which the
  // engine centred on the wire: the pill (if any) keeps the middle, the note
  // takes the room to one side — east of a wire running down, south of one
  // running rightward.
  const boxes = new Map<number, { x: number; y: number; w: number; h: number }>();
  for (const e of edges) {
    const i = p.edgeNote.get(e.id), r = e.labelRect;
    if (i === undefined || !r) continue;
    const nt = noteBox(view.notes![i].text, font), cx = r.x + Math.round(r.w / 2), cy = r.y + Math.round(r.h / 2);
    const pill = e.label ? pillDims(e.label, font).w + (badgeWidth(p.graph.flow, e.id, font) ? badgeWidth(p.graph.flow, e.id, font) + BADGE_GAP : 0) : 0;
    const across = r.w >= 2 * (noteOff(pill) + nt.w); // reserved across the wire: it runs down here
    boxes.set(i, across
      ? { x: cx + noteOff(pill), y: cy - Math.round(nt.h / 2), w: nt.w, h: nt.h }
      : { x: cx - Math.round(nt.w / 2), y: cy + (pill ? 9 : 0) + NOTE_CLEAR, w: nt.w, h: nt.h });
    if (e.label) e.labelRect = { x: cx - Math.round(pill / 2), y: cy - 9, w: pill, h: 18 };
    else delete e.labelRect;
  }

  // `route … from/to` names walls; say where one could not be used, and why
  const drawnBy = new Map(p.problem.wires.map((w) => [w.id, w]));
  for (const r of view.layout.routes) {
    if (!r.fromSide && !r.toSide) continue;
    const e = p.graph.edges.find((x) => x.from === r.from && x.to === r.to && (!r.label || x.label === r.label));
    if (!e || !drawnBy.has(e.id)) continue; // not drawn here: the plan said so
    const mates = p.parentOf.get(e.from) === p.parentOf.get(e.to) && sol.ranks.get(e.from) === sol.ranks.get(e.to);
    if (mates) {
      diagnostics.push({
        severity: "warning",
        message: `\`route ${r.from} -> ${r.to}\` sides are ignored — it is a same-rank edge`,
        fix: "same-rank edges are routed side-to-side automatically; drop the `from`/`to`, or move one end to another row so the edge spans ranks",
        loc: r.loc,
      });
      continue;
    }
    // one warning per end that was not given its side, each with its own cause
    for (const u of sol.unhonoured ?? []) {
      if (u.wire !== e.id) continue;
      const box = u.end === "from" ? r.from : r.to, other = u.end === "from" ? r.to : r.from, side = (u.end === "from" ? r.fromSide : r.toSide)!;
      // the box beside `box` that holds the other end, and a zone's box by the zone's own id
      const holder = (path: string) => { let at = path; while (p.parentOf.get(at) !== undefined && p.parentOf.get(at) !== p.parentOf.get(box)) at = p.parentOf.get(at)!; return at; };
      const name = (id: string) => id.replace(/^zone:/, "");
      const [why, fix] =
        u.why === "trunk" ? [
          "the edge is drawn as part of a trunk, which shares one port",
          "take the edge out of the `channel` (or drop the `wrap`) to route it on its own, or drop the `from`/`to`",
        ] : u.why === "taken" ? [
          `the ${side} side of \`${box}\` already carries a wire running straight across to a neighbour`,
          `ask for another side, or move that neighbour to another row so the ${side} side is free`,
        ] : u.why === "row" ? [
          `\`${box}\` is in the same row as \`${name(holder(other))}\`, which holds the other end, so the edge runs straight across`,
          `drop the \`${u.end}\`, or move \`${box}\` to another row`,
        ] : u.why === "far" ? [
          `the edge leaves \`${name(p.parentOf.get(box) ?? "")}\` by its ${OPPOSITE[side]} side, the other way`,
          `drop the \`${u.end}\`, or ask for north or south`,
        ] : [
          `another box stands between \`${box}\` and the ${side} side of \`${name(p.parentOf.get(box) ?? "")}\`, which the edge leaves by`,
          `drop the \`${u.end}\`, ask for north or south, or put \`${box}\` at the ${side} end of its row`,
        ];
      diagnostics.push({
        severity: "warning",
        message: `\`route ${r.from} -> ${r.to}\` could not use the ${side} side of \`${box}\` — ${why}`,
        fix,
        loc: r.loc,
      });
    }
  }

  // what stands on the layout beside its boxes and wires
  markCrossedTitles(frames, edges, font);
  const { badges, chips, pillRects } = annotate(p.graph, edges, nodes, zones, font);
  // A note on a face that also carries wires stands past the last of them:
  // the room is told to reach that far (the engine kept the whole depth of
  // the rank clear there; the resolver still checks what it finds).
  const room = new Map(p.noteRoom);
  (view.notes ?? []).forEach((note, i) => {
    const r = room.get(i);
    if (!r || note.anchor.kind !== "relpos") return;
    const target = note.anchor.target, rp = note.anchor.relpos;
    const face: Side = rp === "above" ? "north" : rp === "below" ? "south" : rp === "left-of" ? "west" : "east";
    if (!ports.some((pt) => pt.node === target && pt.side === face)) return;
    const nt = noteBox(note.text, font);
    room.set(i, face === "north" || face === "south" ? { ...r, w: r.w + NOTE_CLEAR + nt.w } : { ...r, h: r.h + NOTE_CLEAR + nt.h });
  });
  const notes = placeNotes({ view, font, width: sol.width, height: sol.height, nodes, edges, ports, frames, zones, chips, badges, pillRects, room, boxes });
  diagnostics.push(...crowdedMarks({ edges, badges, chips, notes }, pillRects, view.loc));

  return {
    positioned: {
      name: view.name, width: sol.width, height: sol.height,
      nodes, edges, ports, frames, zones, chips, badges, notes,
      flow: p.graph.flow, lines: view.layout.lines ?? "orthogonal",
    },
    diagnostics,
  };
}

/** Which wall of `r` the point sits on. */
function wallOf(r: Rect, pt: Pt): Side {
  if (pt.y === r.y) return "north";
  if (pt.y === r.y + r.h) return "south";
  return pt.x === r.x ? "west" : "east";
}
