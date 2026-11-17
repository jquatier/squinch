// Relationship marks on a laid-out picture: where each one stands, and
// whether anything else stands on it.
//
// The engine keeps labels off a marked end (`Wire.tips`), so in an ordinary
// picture nothing below fires. What it cannot always give is room that does
// not exist: five relationships on the 64px head of a table in a rightward
// view, a flow badge on a wire too short to hold it beside two marks. Those
// are said, naming the table — never drawn over in silence.
import type { Diagnostic, Loc } from "../model/types.js";
import type { PEdge, Positioned } from "./positioned.js";
import { MARK_HALF, MARK_REACH } from "./sizes.js";

type Rect = { x: number; y: number; w: number; h: number };

/** The box a mark is drawn in at each end of a marked edge: from the wall out
 *  along the wire's first (last) run, and half a mark to either side. */
export function markRects(e: PEdge): { end: "from" | "to"; node: string; at: { x: number; y: number }; rect: Rect }[] {
  if (!e.marks || e.points.length < 2) return [];
  const n = e.points.length;
  return ([["from", e.from, e.points[0], e.points[1]], ["to", e.to, e.points[n - 1], e.points[n - 2]]] as const).map(([end, node, p, q]) => {
    const dx = Math.sign(q.x - p.x), dy = Math.sign(q.y - p.y);
    const rect = dx
      ? { x: Math.min(p.x, p.x + dx * MARK_REACH), y: p.y - MARK_HALF, w: MARK_REACH, h: 2 * MARK_HALF }
      : { x: p.x - MARK_HALF, y: Math.min(p.y, p.y + dy * MARK_REACH), w: 2 * MARK_HALF, h: MARK_REACH };
    return { end, node, at: p, rect };
  });
}

const hit = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** One warning per table whose marks something else stands on. */
export function crowdedMarks(
  pos: Pick<Positioned, "edges" | "badges" | "chips" | "notes">, pills: (Rect & { edgeId: string })[], loc: Loc,
): Diagnostic[] {
  const marks = pos.edges.flatMap((e) => markRects(e).map((m) => ({ ...m, edge: e })));
  if (!marks.length) return [];
  const crowded = new Map<string, Set<string>>();
  const say = (node: string, what: string) => (crowded.get(node) ?? crowded.set(node, new Set()).get(node)!).add(what);
  for (const m of marks) {
    if (pills.some((r) => hit(m.rect, r))) say(m.node, "an edge label");
    if (pos.badges.some((r) => hit(m.rect, r))) say(m.node, "a flow badge");
    if (pos.chips.some((r) => hit(m.rect, r))) say(m.node, "a zone label");
    if ((pos.notes ?? []).some((r) => hit(m.rect, r))) say(m.node, "a note");
    // another mark — unless it is the same drawn end (a trunk's shared port)
    if (marks.some((o) => o !== m && !(o.at.x === m.at.x && o.at.y === m.at.y) && hit(m.rect, o.rect))) say(m.node, "another mark");
    // another wire passing through it; one that shares this very end is the same trunk
    for (const o of pos.edges) {
      if (o === m.edge) continue;
      const a = o.points[0], z = o.points[o.points.length - 1];
      if ((a.x === m.at.x && a.y === m.at.y) || (z.x === m.at.x && z.y === m.at.y)) continue;
      if (o.points.slice(1).some((q, i) => {
        const p = o.points[i];
        return hit(m.rect, { x: Math.min(p.x, q.x) - 0.5, y: Math.min(p.y, q.y) - 0.5, w: Math.abs(q.x - p.x) + 1, h: Math.abs(q.y - p.y) + 1 });
      })) say(m.node, "another wire");
    }
  }
  return [...crowded].map(([node, what]) => ({
    severity: "warning" as const,
    message: `the relationship marks at \`${node}\` are crowded — ${[...what].join(", ")} stands on one of them`,
    fix: `give the wires at \`${node}\` more room: move one to another wall with \`route … from <side>\` (or \`to <side>\`), `
      + "widen the spacing with `density spacious` in the view's `layout { }`, or drop the marks on the least important edge",
    loc,
  }));
}
