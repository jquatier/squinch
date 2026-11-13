// The hard rules of REQUIREMENTS.md §3, checked on a `Solution` against the
// `Problem` it answers — the engine's own judge, independent of Squinch.
// (`checkLayout` in test/invariants.ts holds a `Positioned` to the rules the
// renderer cares about; it does not ask whether two wires share a segment,
// whether a port is in a corner, or whether a pin was kept. This does.)
//
// It is test and tooling code: the engine never calls it.

import type { Box, Group, Problem, Pt, Rect, Solution } from "../contract.js";

const inside = (o: Rect, i: Rect) => i.x >= o.x && i.y >= o.y && i.x + i.w <= o.x + o.w && i.y + i.h <= o.y + o.h;
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export function audit(problem: Problem, s: Solution): string[] {
  const bad: string[] = [];
  const parent = new Map<string, string>(), boxOf = new Map<string, Box>();
  const walk = (g: Group, id: string) => { for (const b of g.boxes) { parent.set(b.id, id); boxOf.set(b.id, b); if (b.group) walk(b.group, b.id); } };
  walk(problem.root, "");
  const up = (id: string): string[] => (id === "" ? [] : [id, ...up(parent.get(id)!)]);
  const whole = (v: number) => Number.isInteger(v);

  // 1 ─ boxes: integer, apart, inside their container, padded, wide enough
  const each = (g: Group, id: string, frame: Rect) => {
    const rs = g.boxes.map((b) => ({ b, r: s.boxes.get(b.id)! }));
    for (const { b, r } of rs) {
      if (!r) { bad.push(`box ${b.id}: no rectangle`); continue; }
      if (![r.x, r.y, r.w, r.h].every(whole)) bad.push(`box ${b.id}: not whole numbers`);
      const room = { x: frame.x + g.pad.left, y: frame.y + g.pad.top, w: frame.w - g.pad.left - g.pad.right, h: frame.h - g.pad.top - g.pad.bottom };
      if (!inside(room, r) || !inside(frame, { ...r, h: r.h + (b.bleed ?? 0) })) bad.push(`box ${b.id}: outside the padding of ${id || "the root"}`);
      if (!b.group && (r.w !== b.w || r.h !== b.h)) bad.push(`box ${b.id}: resized`);
      if (b.group && r.w < (b.minW ?? 0)) bad.push(`box ${b.id}: narrower than its minW`);
      if (b.group) each(b.group, b.id, r);
    }
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i], c = rs[j];
      if (a.r && c.r && (overlap({ ...a.r, h: a.r.h + (a.b.bleed ?? 0) }, c.r) || overlap(a.r, { ...c.r, h: c.r.h + (c.b.bleed ?? 0) }))) bad.push(`boxes ${a.b.id} and ${c.b.id} overlap`);
    }
    // 8 ─ what the author said
    const axis = (r: Rect) => (g.dir === "down" ? { along: r.x, size: r.w, rank: r.y } : { along: r.y, size: r.h, rank: r.x });
    const pinned = [...g.pins].filter(([b]) => s.boxes.has(b) && parent.get(b) === id).sort((p, q) => p[1] - q[1]);
    for (let i = 0; i + 1 < pinned.length; i++) {
      const [a, ra] = pinned[i], [b, rb] = pinned[i + 1];
      if ((ra === rb) !== (s.ranks.get(a) === s.ranks.get(b)) || (ra < rb && !(s.ranks.get(a)! < s.ranks.get(b)!))) bad.push(`pins: ${a} (${ra}) and ${b} (${rb}) are ranked ${s.ranks.get(a)} and ${s.ranks.get(b)}`);
    }
    const held = (g.held ?? []).filter((b) => parent.get(b) === id);
    const order = new Map(g.boxes.map((b, i) => [b.id, i]));
    for (const a of held) for (const b of held)
      if (a !== b && s.ranks.get(a) === s.ranks.get(b) && order.get(a)! < order.get(b)! && !(axis(s.boxes.get(a)!).along < axis(s.boxes.get(b)!).along)) bad.push(`held: ${a} should stand before ${b}`);
    for (const set of g.aligned ?? []) {
      const seen = new Set<number>(), mids: number[] = [];
      for (const b of set) {
        if (parent.get(b) !== id || seen.has(s.ranks.get(b)!)) continue;
        seen.add(s.ranks.get(b)!);
        const a = axis(s.boxes.get(b)!);
        mids.push(a.along + a.size / 2);
      }
      if (new Set(mids).size > 1) bad.push(`aligned: ${set.join(", ")} stand at ${mids.join(", ")}`);
    }
    (g.columns ?? []).forEach((band, i) => {
      for (const a of band) for (const b of g.columns![i + 1] ?? []) {
        const ra = s.boxes.get(a), rb = s.boxes.get(b);
        if (ra && rb && !(axis(ra).along + axis(ra).size <= axis(rb).along)) bad.push(`columns: ${a} is not wholly before ${b}`);
      }
    });
  };
  each(problem.root, "", { x: 0, y: 0, w: s.width, h: s.height });

  // 7 ─ every wire drawn or accounted for
  for (const w of problem.wires) if (!s.wires.has(w.id) && !s.skipped.includes(w.id)) bad.push(`wire ${w.id}: neither drawn nor skipped`);

  type Seg = { id: string; bundle?: string; a: Pt; b: Pt };
  const segs: Seg[] = [];
  const ends = new Map<string, { id: string; bundle?: string }[]>();
  const wallPorts = new Map<string, number[]>();
  for (const w of problem.wires) {
    const drawn = s.wires.get(w.id);
    if (!drawn) continue;
    const pts = drawn.points;
    // 3 ─ orthogonal, whole, no repeats, no three in a line
    if (pts.length < 2) { bad.push(`wire ${w.id}: ${pts.length} point(s)`); continue; }
    for (const p of pts) if (!whole(p.x) || !whole(p.y)) bad.push(`wire ${w.id}: point off the pixel grid`);
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      if ((a.x !== b.x) === (a.y !== b.y)) bad.push(`wire ${w.id}: ${a.x === b.x ? "repeated point" : "diagonal"} at ${a.x},${a.y}`);
      segs.push({ id: w.id, bundle: w.bundle, a, b });
      if (i + 2 < pts.length) {
        const c = pts[i + 2];
        if ((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)) bad.push(`wire ${w.id}: three points in a line at ${b.x},${b.y}`);
      }
    }
    // 4 ─ ends on its own boxes' walls, clear of the corners
    for (const [boxId, p, q] of [[w.from, pts[0], pts[1]], [w.to, pts[pts.length - 1], pts[pts.length - 2]]] as const) {
      const r = s.boxes.get(boxId)!;
      const onX = (p.x === r.x || p.x === r.x + r.w) && p.y >= r.y + 8 && p.y <= r.y + r.h - 8;
      const onY = (p.y === r.y || p.y === r.y + r.h) && p.x >= r.x + 8 && p.x <= r.x + r.w - 8;
      if (!onX && !onY) bad.push(`wire ${w.id}: ends at ${p.x},${p.y}, not on a wall of ${boxId} clear of its corners`);
      const face = boxOf.get(boxId)?.face;
      if (onX && !onY && face !== undefined && p.y > r.y + face) bad.push(`wire ${w.id}: lands below the face of ${boxId}`);
      // and leaves it outward, at a right angle
      if (onX && q.y !== p.y && !onY) bad.push(`wire ${w.id}: runs along the wall of ${boxId}`);
      const key = `${boxId}|${p.x},${p.y}`;
      (ends.get(key) ?? ends.set(key, []).get(key)!).push({ id: w.id, bundle: w.bundle });
      const wall = `${boxId}|${onY ? (p.y === r.y ? "n" : "s") : p.x === r.x ? "w" : "e"}`;
      (wallPorts.get(wall) ?? wallPorts.set(wall, []).get(wall)!).push(onY ? p.x : p.y);
    }
    // 2 ─ through no box but its own ends and what holds them
    const own = new Set([...up(w.from), ...up(w.to)]);
    for (const [id, r] of s.boxes) {
      if (own.has(id)) continue;
      const body = { ...r, h: r.h + (boxOf.get(id)?.bleed ?? 0) };
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i], b = pts[i + 1];
        const seg = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
        if (seg.x < body.x + body.w && seg.x + seg.w > body.x && seg.y < body.y + body.h && seg.y + seg.h > body.y) { bad.push(`wire ${w.id}: through ${id}`); break; }
      }
    }
    // 6 ─ its label: on the wire, on no box
    if (w.label && !drawn.label) bad.push(`wire ${w.id}: its label was not placed`);
    if (drawn.label) {
      const l = drawn.label;
      const on = pts.slice(1).some((b, i) => {
        const a = pts[i];
        return Math.min(a.x, b.x) <= l.x + l.w && Math.max(a.x, b.x) >= l.x && Math.min(a.y, b.y) <= l.y + l.h && Math.max(a.y, b.y) >= l.y;
      });
      if (!on) bad.push(`wire ${w.id}: its label is not on it`);
      for (const [id, r] of s.boxes) if (!boxOf.get(id)?.group && overlap(l, r)) bad.push(`wire ${w.id}: its label overlaps ${id}`);
    }
  }
  const labelled = problem.wires.filter((w) => s.wires.get(w.id)?.label);
  for (let i = 0; i < labelled.length; i++) for (let j = i + 1; j < labelled.length; j++)
    if (overlap(s.wires.get(labelled[i].id)!.label!, s.wires.get(labelled[j].id)!.label!)) bad.push(`labels of ${labelled[i].id} and ${labelled[j].id} overlap`);

  // 4 ─ no two wires at one point of a wall, but for a bundle's shared port
  for (const [key, list] of ends)
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++)
      if (!list[i].bundle || list[i].bundle !== list[j].bundle) bad.push(`wires ${list[i].id} and ${list[j].id} meet ${key.split("|")[0]} at one point`);

  // 5 ─ no two wires along one segment, but for a bundle's trunk
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const p = segs[i], q = segs[j];
    if (p.id === q.id || (p.bundle && p.bundle === q.bundle)) continue;
    const ph = p.a.y === p.b.y, qh = q.a.y === q.b.y;
    if (ph !== qh) continue;
    const [p0, p1, q0, q1, line] = ph
      ? [Math.min(p.a.x, p.b.x), Math.max(p.a.x, p.b.x), Math.min(q.a.x, q.b.x), Math.max(q.a.x, q.b.x), p.a.y === q.a.y]
      : [Math.min(p.a.y, p.b.y), Math.max(p.a.y, p.b.y), Math.min(q.a.y, q.b.y), Math.max(q.a.y, q.b.y), p.a.x === q.a.x];
    if (line && p0 < q1 && q0 < p1) bad.push(`wires ${p.id} and ${q.id} run along one line at ${ph ? `y ${p.a.y}` : `x ${p.a.x}`}`);
  }
  return bad;
}

/** Ports on one wall closer than 16 px: legal only where the wall has no room (§3.4). Reported apart. */
export function crowded(problem: Problem, s: Solution): number {
  const walls = new Map<string, number[]>();
  for (const w of problem.wires) {
    const pts = s.wires.get(w.id)?.points;
    if (!pts) continue;
    for (const [boxId, p] of [[w.from, pts[0]], [w.to, pts[pts.length - 1]]] as const) {
      const r = s.boxes.get(boxId)!;
      const onY = p.y === r.y || p.y === r.y + r.h;
      const wall = `${boxId}|${onY ? (p.y === r.y ? "n" : "s") : p.x === r.x ? "w" : "e"}`;
      const list = walls.get(wall) ?? walls.set(wall, []).get(wall)!;
      if (!list.includes(onY ? p.x : p.y)) list.push(onY ? p.x : p.y);
    }
  }
  let n = 0;
  for (const list of walls.values()) {
    list.sort((a, b) => a - b);
    for (let i = 0; i + 1 < list.length; i++) if (list[i + 1] - list[i] < 16) n++;
  }
  return n;
}
