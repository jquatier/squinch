// DESIGN §9's beauty checklist, mechanised.
//
// It was a thing a human eyeballed each release, and the reason it was never
// automated is that the tests read rendered SVG — where the entire identifying
// surface is `data-path` and `data-kind`, both on nodes. There is no
// `data-edge`, no `data-port`, no `data-frame`, so the crossing-hop test has to
// find edges by matching a theme colour literal. Whole categories of the
// checklist — port distribution, stub lengths, zone containment — simply cannot
// be expressed that way, which is why the coplanar router still has no named
// test and why five stub violations sat in the corpus unnoticed.
//
// `layoutView` already returns the geometry, typed. These are pure functions
// over `Positioned`: they return violations rather than asserting, so the
// caller decides how to report, and so one sweep can check a whole corpus and
// list everything at once instead of dying on the first failure.
import type { Positioned, PNode, PEdge } from "../src/layout/layout.js";

/** What `Positioned` does not carry, and the rules need. */
export interface Ctx {
  /** zone id → declared member paths, for the containment rule */
  zoneMembers?: Map<string, string[]>;
  /** node paths that are a `channel` target — exempt from the port rule */
  channelTargets?: Set<string>;
}

const GRID = 8;
/** DESIGN §4: an edge runs ≥16 before its first turn. Not arbitrary — `R_EDGE`
 *  is 8 and `roundedPath` clamps a corner to half the shorter segment, so below
 *  16 the corner never reaches full radius and the line appears to leave the box
 *  diagonally, which is the thing §4 forbids. */
const STUB = 16;

const rect = (r: { x: number; y: number; w: number; h: number }) => ({
  x1: r.x, y1: r.y, x2: r.x + r.w, y2: r.y + r.h,
});
const overlaps = (a: PNode, b: PNode) => {
  const [p, q] = [rect(a), rect(b)];
  return p.x1 < q.x2 && p.x2 > q.x1 && p.y1 < q.y2 && p.y2 > q.y1;
};
const contains = (
  outer: { x: number; y: number; w: number; h: number },
  inner: { x: number; y: number; w: number; h: number },
) => {
  const [o, i] = [rect(outer), rect(inner)];
  return i.x1 >= o.x1 && i.x2 <= o.x2 && i.y1 >= o.y1 && i.y2 <= o.y2;
};
const len = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(b.x - a.x, b.y - a.y);

/**
 * Every violation in one pass, each a human-readable line naming the element.
 * Empty array = the layout is well-formed.
 */
export function checkLayout(p: Positioned, ctx: Ctx = {}): string[] {
  const bad: string[] = [];
  const nodes = p.nodes;

  // ── integers ────────────────────────────────────────────────────────────
  // DESIGN §8, and the load-bearing one: it is what lets goldens authored on
  // macOS byte-match on Linux. Sub-pixel drift would break the determinism
  // contract silently, on one OS only.
  const whole = (v: number) => Number.isInteger(v);
  for (const n of nodes)
    if (![n.x, n.y, n.w, n.h].every(whole))
      bad.push(`node ${n.path}: non-integer geometry (${n.x},${n.y} ${n.w}×${n.h})`);
  for (const pt of p.ports)
    if (!whole(pt.x) || !whole(pt.y)) bad.push(`port on ${pt.node}: non-integer (${pt.x},${pt.y})`);
  for (const e of p.edges)
    for (const q of e.points)
      if (!whole(q.x) || !whole(q.y)) bad.push(`edge ${e.id}: non-integer point (${q.x},${q.y})`);

  // ── node dimensions on the grid ─────────────────────────────────────────
  // DESIGN §2. Dimensions are ours — `sizeOf` picks from fixed tiers — unlike
  // positions, which ELK assigns and which cannot be gridded while `align`
  // equalises centres across 40px-stepped tiers.
  for (const n of nodes)
    if (n.w % GRID || n.h % GRID)
      bad.push(`node ${n.path}: ${n.w}×${n.h} is off the ${GRID}px grid`);

  // ── orthogonality ───────────────────────────────────────────────────────
  if (p.lines === "orthogonal")
    for (const e of p.edges)
      for (let i = 0; i < e.points.length - 1; i++) {
        const a = e.points[i], b = e.points[i + 1];
        if (a.x !== b.x && a.y !== b.y)
          bad.push(`edge ${e.id}: diagonal segment (${a.x},${a.y})→(${b.x},${b.y})`);
      }

  // ── edges are drawable ──────────────────────────────────────────────────
  for (const e of p.edges)
    if (e.points.length < 2) bad.push(`edge ${e.id}: ${e.points.length} point(s)`);

  // ── stubs (DESIGN §4) ───────────────────────────────────────────────────
  // Only edges that actually turn: 171 of 352 orthogonal edges are two-point
  // runs from the coplanar router, where "before its first turn" has no meaning.
  for (const e of p.edges as PEdge[]) {
    if (e.points.length < 3) continue;
    const first = len(e.points[0], e.points[1]);
    const last = len(e.points[e.points.length - 2], e.points[e.points.length - 1]);
    if (first < STUB) bad.push(`edge ${e.id}: leaves ${first} before turning (need ${STUB})`);
    if (last < STUB) bad.push(`edge ${e.id}: enters after ${last} (need ${STUB})`);
  }

  // ── nothing overlaps ────────────────────────────────────────────────────
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++)
      if (overlaps(nodes[i], nodes[j]))
        bad.push(`nodes ${nodes[i].path} and ${nodes[j].path} overlap`);

  // ── containment ─────────────────────────────────────────────────────────
  for (const f of p.frames)
    for (const n of nodes.filter((x) => x.frame === f.path))
      if (!contains(f, n)) bad.push(`node ${n.path} escapes its frame ${f.path}`);

  if (ctx.zoneMembers)
    for (const z of p.zones) {
      const members = ctx.zoneMembers.get(z.id) ?? [];
      for (const n of nodes) {
        const inZone = members.some((m) => n.path === m || n.path.startsWith(`${m}.`));
        if (inZone && !contains(z, n)) bad.push(`node ${n.path} escapes its zone ${z.id}`);
      }
    }

  // ── label pills never collide (DESIGN §4) ───────────────────────────────
  // Space is reserved at layout time, so this can be a hard geometric rule
  // rather than a hope about a placement search: a labelRect may not overlap a
  // node or another labelRect. Its own edge does not count — sitting on your
  // own wire is the point — and margins are zero, since the reservation
  // already carries its breathing room.
  const labelled = p.edges.filter((e) => e.labelRect);
  for (const e of labelled) {
    for (const n of nodes)
      if (overlaps(e.labelRect as any, n))
        bad.push(`label of ${e.id} overlaps node ${n.path}`);
  }
  for (let i = 0; i < labelled.length; i++)
    for (let j = i + 1; j < labelled.length; j++) {
      const a = labelled[i].labelRect!, b = labelled[j].labelRect!;
      if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y)
        bad.push(`labels of ${labelled[i].id} and ${labelled[j].id} overlap`);
    }

  // ── reserved note boxes (edge-anchored notes) never collide ─────────────
  for (const [i, r] of p.noteBoxes ?? [])
    for (const n of nodes)
      if (overlaps(r as any, n)) bad.push(`note ${i} overlaps node ${n.path}`);
  for (const [i, r] of p.noteBoxes ?? [])
    for (const e of labelled)
      if (e.labelRect && r.x < e.labelRect.x + e.labelRect.w && r.x + r.w > e.labelRect.x
          && r.y < e.labelRect.y + e.labelRect.h && r.y + r.h > e.labelRect.y)
        bad.push(`note ${i} overlaps label of ${e.id}`);

  // ── chips and badges never collide with nodes ───────────────────────────
  // They are typed geometry now (Positioned consolidation), so the rule is
  // assertable. A chip legitimately straddles its own zone border; it must not
  // sit on a node. Badges likewise.
  for (const c of p.chips ?? [])
    for (const n of nodes)
      if (overlaps(c as any, n)) bad.push(`chip ${c.zone} overlaps node ${n.path}`);
  for (const b of p.badges ?? [])
    for (const n of nodes)
      if (overlaps(b as any, n)) bad.push(`badge on ${b.edgeId} overlaps node ${n.path}`);

  // ── a badge is nearest the wire it numbers ──────────────────────────────
  // The rule the old placement broke without ever colliding with anything. A
  // badge docked to the left of its pill, or walked out from its edge's start,
  // could come to rest against a *neighbouring* line and read as that edge's
  // number — `microservices#checkout` had one sitting on an async wire it had
  // nothing to do with. Overlap rules cannot see that, because attachment, not
  // collision, is the property. So assert attachment directly: no other edge
  // may be closer to the badge than its own. Not "touching" — a reservation
  // deliberately sits a spacing notch off the wire.
  const distToRun = (pts: { x: number; y: number }[], x: number, y: number) => {
    let best = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b2 = pts[i + 1];
      const dx = b2.x - a.x, dy = b2.y - a.y, l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2)) : 0;
      best = Math.min(best, Math.hypot(a.x + dx * t - x, a.y + dy * t - y));
    }
    return best;
  };
  for (const b of p.badges ?? []) {
    const own = p.edges.find((q) => q.id === b.edgeId);
    if (!own || own.points.length < 2) continue;
    const [cx, cy] = [b.x + b.w / 2, b.y + b.h / 2];
    const mine = distToRun(own.points, cx, cy);
    for (const other of p.edges)
      if (other.id !== own.id && other.points.length >= 2 && distToRun(other.points, cx, cy) < mine)
        bad.push(`badge on ${b.edgeId} sits nearer edge ${other.id} than its own`);
  }

  // ── port distribution (DESIGN §4) ───────────────────────────────────────
  // "multiple edges on one side spread at even offsets — never stacked into a
  // single point". The one legal exception is a `channel`: merging N sources
  // into one entry port is exactly what the feature does, so a trunk target is
  // exempt rather than a false positive.
  const seen = new Map<string, string>();
  for (const pt of p.ports) {
    if (ctx.channelTargets?.has(pt.node)) continue;
    const key = `${pt.node}|${pt.side}|${pt.x},${pt.y}`;
    const prev = seen.get(key);
    if (prev) bad.push(`ports for ${prev} and ${pt.edge} stack at ${pt.node} ${pt.side} (${pt.x},${pt.y})`);
    else seen.set(key, pt.edge);
  }

  return bad;
}
