// The hard rules, checked on a `Problem` and its `Solution` directly — no
// view, no model. What `checkLayout` holds a `Positioned` to, plus what only
// the contract can say: a box's `room` is entered by nothing but its own
// wires on that wall, and a wire asked to use a side uses it.
import type { Box, Group, Problem, Pt, Rect, Side, Solution } from "../../src/layout/weft/contract.js";

const inside = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
/** Does the segment run through the open inside of `r`? Along a wall is not through. */
const through = (p: Pt, q: Pt, r: Rect) =>
  Math.min(p.x, q.x) < r.x + r.w && Math.max(p.x, q.x) > r.x && Math.min(p.y, q.y) < r.y + r.h && Math.max(p.y, q.y) > r.y;

/** The clear space outside one wall of a box, as a rectangle. */
export function roomRect(r: Rect, side: Side, depth: number): Rect {
  return side === "north" ? { x: r.x, y: r.y - depth, w: r.w, h: depth } : side === "south" ? { x: r.x, y: r.y + r.h, w: r.w, h: depth }
    : side === "east" ? { x: r.x + r.w, y: r.y, w: depth, h: r.h } : { x: r.x - depth, y: r.y, w: depth, h: r.h };
}
/** Which wall of `r` a point stands on. */
export function wallAt(r: Rect, p: Pt): Side | undefined {
  if (p.y === r.y && p.x >= r.x && p.x <= r.x + r.w) return "north";
  if (p.y === r.y + r.h && p.x >= r.x && p.x <= r.x + r.w) return "south";
  if (p.x === r.x && p.y >= r.y && p.y <= r.y + r.h) return "west";
  if (p.x === r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return "east";
  return undefined;
}

/** Every broken rule, as a line naming what broke it. Empty: the solution is legal. */
export function audit(problem: Problem, sol: Solution): string[] {
  const bad: string[] = [];
  const boxes = new Map<string, Box>(), parent = new Map<string, string>(), home = new Map<string, Group>();
  const walk = (g: Group, id: string) => { for (const b of g.boxes) { boxes.set(b.id, b); parent.set(b.id, id); home.set(b.id, g); if (b.group) walk(b.group, b.id); } };
  walk(problem.root, "");
  const rect = (id: string) => sol.boxes.get(id)!;
  const holds = (outer: string, id: string): boolean => { for (let p: string | undefined = id; p; p = parent.get(p)) if (p === outer) return true; return false; };
  const whole = (n: number) => Number.isInteger(n);

  // ── boxes ──────────────────────────────────────────────────────────────────
  for (const id of boxes.keys()) {
    const r = sol.boxes.get(id);
    if (!r) { bad.push(`box ${id}: no rectangle`); continue; }
    if (![r.x, r.y, r.w, r.h].every(whole)) bad.push(`box ${id}: not whole numbers`);
    const up = parent.get(id)!, o = up ? rect(up) : { x: 0, y: 0, w: sol.width, h: sol.height };
    if (r.x < o.x || r.y < o.y || r.x + r.w > o.x + o.w || r.y + r.h > o.y + o.h) bad.push(`box ${id} leaves ${up || "the canvas"}`);
  }
  for (const [a, pa] of parent) for (const [b, pb] of parent) if (a < b && pa === pb && inside(rect(a), rect(b))) bad.push(`boxes ${a} and ${b} overlap`);

  // ── rooms: nothing in them, and within the container's walls ───────────────
  const rooms: { id: string; side: Side; r: Rect }[] = [];
  for (const [id, b] of boxes) for (const side of ["north", "south", "east", "west"] as const) {
    const depth = b.room?.[side] ?? 0;
    if (depth > 0 && !b.group) rooms.push({ id, side, r: roomRect(rect(id), side, depth) });
  }
  for (const room of rooms) {
    const up = parent.get(room.id)!, o = up ? rect(up) : { x: 0, y: 0, w: sol.width, h: sol.height }, r = room.r;
    if (r.x < o.x || r.y < o.y || r.x + r.w > o.x + o.w || r.y + r.h > o.y + o.h) bad.push(`room ${room.side} of ${room.id} leaves ${up || "the canvas"}`);
    for (const id of boxes.keys()) if (id !== room.id && !holds(id, room.id) && inside(rect(id), r)) bad.push(`box ${id} stands in the room ${room.side} of ${room.id}`);
    for (const [w, { label }] of sol.wires) if (label && inside(label, r)) bad.push(`label of ${w} lies in the room ${room.side} of ${room.id}`);
  }

  // ── wires ──────────────────────────────────────────────────────────────────
  const rowMates = (a: string, b: string) => parent.get(a) === parent.get(b) && sol.ranks.get(a) === sol.ranks.get(b);
  for (const wire of problem.wires) {
    const drawn = sol.wires.get(wire.id);
    if (!drawn) { if (!sol.skipped.includes(wire.id)) bad.push(`wire ${wire.id}: neither drawn nor skipped`); continue; }
    const pts = drawn.points, n = pts.length;
    if (n < 2) { bad.push(`wire ${wire.id}: ${n} point(s)`); continue; }
    for (const p of pts) if (!whole(p.x) || !whole(p.y)) bad.push(`wire ${wire.id}: a point off the pixel grid`);
    for (let i = 0; i + 1 < n; i++) {
      const p = pts[i], q = pts[i + 1];
      if ((p.x !== q.x) === (p.y !== q.y)) bad.push(`wire ${wire.id}: segment ${i} is not straight along an axis`);
      if (i + 2 < n && ((p.x === q.x && q.x === pts[i + 2].x) || (p.y === q.y && q.y === pts[i + 2].y))) bad.push(`wire ${wire.id}: three points in a line`);
    }
    const ends = [[wire.from, pts[0], pts[1], wire.fromSide, "leaves"], [wire.to, pts[n - 1], pts[n - 2], wire.toSide, "enters"]] as const;
    for (const [id, p, next, asked, verb] of ends) {
      const r = rect(id), wall = wallAt(r, p), leaf = !boxes.get(id)!.group;
      if (!wall) { bad.push(`wire ${wire.id}: ${verb} ${id} at no wall`); continue; }
      const along = wall === "north" || wall === "south" ? [p.x - r.x, r.w] : [p.y - r.y, r.h];
      if (leaf && along[1] >= 32 && (along[0] < 8 || along[0] > along[1] - 8)) bad.push(`wire ${wire.id}: ${verb} ${id} within 8 px of a corner`);
      // straight out of the wall, and at least 16 px before a turn
      const out = wall === "north" ? next.y < p.y : wall === "south" ? next.y > p.y : wall === "east" ? next.x > p.x : next.x < p.x;
      if (leaf && !out) bad.push(`wire ${wire.id}: ${verb} ${id} along or into its ${wall} wall`);
      if (n > 2 && Math.abs(next.x - p.x) + Math.abs(next.y - p.y) < 16) bad.push(`wire ${wire.id}: ${verb} ${id} with less than 16 px before a turn`);
      if (asked && leaf && !rowMates(wire.from, wire.to) && wall !== asked && !sol.unhonoured?.includes(wire.id)) bad.push(`wire ${wire.id}: ${verb} ${id} by its ${wall} wall, asked ${asked}`);
    }
    if (sol.unhonoured?.includes(wire.id) && !wire.fromSide && !wire.toSide) bad.push(`wire ${wire.id}: unhonoured, but asked nothing`);
    for (let i = 0; i + 1 < n; i++) {
      for (const id of boxes.keys()) if (!holds(id, wire.from) && !holds(id, wire.to) && through(pts[i], pts[i + 1], rect(id))) bad.push(`wire ${wire.id} runs through ${id}`);
      for (const id of [wire.from, wire.to]) if (!boxes.get(id)!.group && through(pts[i], pts[i + 1], rect(id))) bad.push(`wire ${wire.id} runs through its own end ${id}`);
      for (const room of rooms) {
        if (!through(pts[i], pts[i + 1], room.r)) continue;
        // its own wire on that wall crosses the room, straight; nothing else enters
        const first = i === 0 && wire.from === room.id && wallAt(rect(room.id), pts[0]) === room.side;
        const last = i === n - 2 && wire.to === room.id && wallAt(rect(room.id), pts[n - 1]) === room.side;
        if (!first && !last) bad.push(`wire ${wire.id} enters the room ${room.side} of ${room.id}`);
      }
    }
    if (drawn.label) for (const id of boxes.keys()) if (!boxes.get(id)!.group && inside(drawn.label, rect(id))) bad.push(`label of ${wire.id} overlaps ${id}`);
  }
  const labels = [...sol.wires].flatMap(([id, w]) => (w.label ? [{ id, r: w.label }] : []));
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) if (inside(labels[i].r, labels[j].r)) bad.push(`labels of ${labels[i].id} and ${labels[j].id} overlap`);

  // ── no two wires along one line, unless they are one bundle ────────────────
  const bundle = new Map(problem.wires.map((w) => [w.id, w.bundle]));
  const segs = [...sol.wires].flatMap(([id, w]) => w.points.slice(1).map((b, i) => {
    const a = w.points[i], flat = a.y === b.y;
    return { id, flat, at: flat ? a.y : a.x, lo: flat ? Math.min(a.x, b.x) : Math.min(a.y, b.y), hi: flat ? Math.max(a.x, b.x) : Math.max(a.y, b.y) };
  }));
  const lying = new Set<string>();
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const s = segs[i], t = segs[j];
    if (s.id === t.id || s.flat !== t.flat || s.at !== t.at || s.lo >= t.hi || t.lo >= s.hi) continue;
    if (bundle.get(s.id) && bundle.get(s.id) === bundle.get(t.id)) continue;
    lying.add(s.id < t.id ? `${s.id} and ${t.id}` : `${t.id} and ${s.id}`);
  }
  for (const pair of lying) bad.push(`wires ${pair} are drawn along one line`);
  // two ends never meet one wall at one point
  const met = new Map<string, string>();
  for (const wire of problem.wires) {
    const pts = sol.wires.get(wire.id)?.points;
    if (!pts) continue;
    for (const [id, p] of [[wire.from, pts[0]], [wire.to, pts[pts.length - 1]]] as const) {
      const k = `${id}|${p.x},${p.y}`, other = met.get(k);
      if (other !== undefined && !(wire.bundle && bundle.get(other) === wire.bundle)) bad.push(`wires ${other} and ${wire.id} meet ${id} at one point`);
      met.set(k, wire.id);
    }
  }
  return bad;
}
