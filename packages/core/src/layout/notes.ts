// The note resolver: where each of a view's notes stands on a finished
// layout. docs/notes/note-placement.md is the policy record — the candidate
// ladders, the authored-side rule, the travel fallback.
//
// Nothing here knows which engine laid the view out. An engine that reserved
// room for a note says so (`room`, `boxes`); one that did not leaves the
// ladder to find it.
import type { SView, Side } from "../model/types.js";
import type { ThemeFont } from "../themes/index.js";
import { hitR } from "./annotate.js";
import type { PEdge, PFrame, PNode, PPort, PZone, Positioned } from "./positioned.js";
import { NOTE_CLEAR, noteBox } from "./sizes.js";

type Font = Pick<ThemeFont, "metrics" | "scale">;
type Rect = { x: number; y: number; w: number; h: number };

/** A frame's title strip: a note inside the frame stays below it. */
const FRAME_HEAD = 36;
const NOTE_FACE: Record<string, Side> = { "right-of": "east", "left-of": "west", above: "north", below: "south" };

export interface NoteInput {
  view: SView; font: Font;
  width: number; height: number;
  nodes: PNode[]; edges: PEdge[]; ports: PPort[]; frames: PFrame[]; zones: PZone[];
  chips: Positioned["chips"]; badges: Positioned["badges"]; pillRects: Rect[];
  /** Room an engine reserved beside a node for a note anchored to it, by note index. */
  room?: ReadonlyMap<number, { dx: number; dy: number; w: number; h: number }>;
  /** The inline box an engine reserved on a wire for a note anchored to it. */
  boxes?: ReadonlyMap<number, Rect>;
}

export function placeNotes(input: NoteInput): NonNullable<Positioned["notes"]> {
  const { view, font, width, height, nodes, edges: pEdges, ports, frames, zones: pZones, chips, badges, pillRects } = input;
  const noteRoom = input.room ?? new Map<number, { dx: number; dy: number; w: number; h: number }>();
  const noteBoxes = input.boxes;
  // pill-extended height, exactly as the renderer computes it. Nothing below
  // the drawing is an obstacle: the header and the legend band are laid
  // outside the content box (the renderer shifts the body down for one and
  // appends the other under it), so a note cannot land on either.
  const drawnBottoms = pillRects.map((r) => r.y + r.h + 16);
  const heightForNotes = Math.max(height, ...drawnBottoms);
  const pNotes: NonNullable<Positioned["notes"]> = [];
  {
  const out = pNotes;
  const list = view.notes ?? [];
  const p = { width, height: heightForNotes, nodes, edges: pEdges, noteBoxes } as any;
  const obstacles: { x: number; y: number; w: number; h: number }[] = [
    ...nodes, ...pillRects, ...chips, ...badges,
  ];
  const byPath = new Map(nodes.map((n) => [n.path, n]));
  // Notes are placed in declaration order and each joins the obstacle set, so
  // an earlier note wins a contested spot — the same tie-break pills use
  // (docs/notes/edge-labels.md), and what makes the output deterministic.
  const placed: Rect[] = [];
  // A frame or a zone is a wall, not a slab. It used to sit in the obstacle
  // list as a filled rect, so nothing inside one was ever clear and a note on
  // a framed node slid until it was over the wall — up to 240px, onto
  // whatever was there. A note may be wholly inside a compound or wholly
  // outside it; it may not straddle the border, or cover a frame's title.
  const walls: (Rect & { head: number })[] = [
    ...frames.map((f) => ({ x: f.x, y: f.y, w: f.w, h: f.h, head: FRAME_HEAD })),
    ...pZones.map((z) => ({ x: z.x, y: z.y, w: z.w, h: z.h, head: 0 })),
  ];
  const inside = (c: Rect & { head: number }, r: Rect, m = 4) =>
    r.x >= c.x + m && r.y >= c.y + Math.max(m, c.head) && r.x + r.w <= c.x + c.w - m && r.y + r.h <= c.y + c.h - m;
  // …and a wire is an obstacle. Nothing checked them, so a note dodging a
  // card could land squarely on the wire beside it and hide a run of it.
  const wires = pEdges.flatMap((e) => e.points.slice(1).map((b, i) => [e.points[i], b] as const));
  const onWire = (r: Rect, m = 4) => {
    const x0 = r.x - m, y0 = r.y - m, x1 = r.x + r.w + m, y1 = r.y + r.h + m;
    return wires.some(([a, b]) => {
      // Liang–Barsky: the segment's parameter range inside the grown box
      let t0 = 0, t1 = 1;
      const dx = b.x - a.x, dy = b.y - a.y;
      for (const [pp, qq] of [[-dx, a.x - x0], [dx, x1 - a.x], [-dy, a.y - y0], [dy, y1 - a.y]]) {
        if (pp === 0) { if (qq <= 0) return false; continue; }
        const t = qq / pp;
        if (pp < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
      }
      return t0 < t1;
    });
  };
  /** `strict` holds a note clear of wires too — relaxed last, since a note on
   *  a wire still beats one that travelled across the diagram to avoid it. */
  const clear = (r: Rect, strict = true) =>
    !obstacles.some((o) => hitR(o, r)) && !placed.some((q) => hitR(q, r))
    && walls.every((c) => inside(c, r) || !hitR(c, r))
    && !(strict && onWire(r));

  let noteIdx = -1;
  for (const note of list) {
    noteIdx++;
    // The room the engine kept on the wire for an edge note: what the ladder
    // below works in, and where the note goes if no rung of it is clear.
    const reserved = p.noteBoxes?.get(noteIdx);
    // `noteBox`, not a second copy of its arithmetic — see the comment there.
    // Integers, like every other rect (DESIGN §8): `measure` returns a float
    // and only x/y used to be rounded, so note widths once shipped as
    // `width="174.22411799999998"`.
    const { prose, w, h } = noteBox(note.text, font);

    // Candidates, in preference order. The authored side is never changed: an
    // author who wrote `right-of` gets right-of, further out or slid along it,
    // never flipped to the other side of the node.
    const cands: { x: number; y: number }[] = [];
    let anchor: (Rect & { path: string }) | undefined;
    let mid: { x: number; y: number } | undefined;
    let run: { x: number; y: number }[] | undefined;

    if (note.anchor.kind === "relpos") {
      // A node — or an expanded container, whose frame is the thing on the
      // page. That second lookup was missing, so `note right-of svc` in a view
      // that also said `expand svc` drew nothing and said nothing.
      const target = note.anchor.target;
      const n = byPath.get(target) ?? frames.find((f) => f.path === target);
      if (!n) continue;
      anchor = n;
      const rp = note.anchor.relpos;
      const cx = n.x + Math.round(n.w / 2) - Math.round(w / 2);
      const cy = n.y + Math.round(n.h / 2) - Math.round(h / 2);
      // Slide far enough to clear a whole card before standing further off.
      // ±48 was not enough: a system card is 88 tall, so a note beside a node
      // with a card to its right exhausted every slide, fell through to the
      // travel fallback, and ended up across the diagram trailing a leader
      // through the very card it was avoiding. Nearest-first, so the shortest
      // leader that works wins.
      const slides = [0];
      // Reach past a whole neighbouring card, not just a node: at ±128 a note
      // beside a crowded column exhausted the ladder, fell through to the
      // travel fallback and set off sideways across the diagram, trailing a
      // leader over everything between. Sliding stays on the authored side and
      // keeps the leader short, so it is always the better escape.
      for (let d = 16; d <= 240; d += 16) slides.push(-d, d);
      for (const gap of [24, 48, 72, 96])
        for (const slide of slides) {
          if (rp === "right-of") cands.push({ x: n.x + n.w + gap, y: cy + slide });
          if (rp === "left-of") cands.push({ x: n.x - gap - w, y: cy + slide });
          if (rp === "above") cands.push({ x: cx + slide, y: n.y - gap - h });
          if (rp === "below") cands.push({ x: cx + slide, y: n.y + n.h + gap });
        }
    } else if (note.anchor.kind === "edge") {
      const e = p.edges.find(
        (e: PEdge) => e.from === (note.anchor as any).from && e.to === (note.anchor as any).to,
      );
      if (!e) continue;
      // Halfway along the run, by arc length. This used to index
      // `points[floor(n/2) - 1]`, which for the common two-point edge is
      // `points[0]` — the *start* — so the note was pinned to its source node
      // and drawn over it every time.
      const at = (frac: number) => {
        const pts = e.points;
        const segs = pts.slice(1).map((q2: any, i2: number) => Math.hypot(q2.x - pts[i2].x, q2.y - pts[i2].y));
        const want = segs.reduce((a2: number, b2: number) => a2 + b2, 0) * frac;
        let run = 0;
        for (let i = 0; i < segs.length; i++) {
          if (run + segs[i] >= want) {
            const f = segs[i] === 0 ? 0 : (want - run) / segs[i];
            return {
              x: pts[i].x + (pts[i + 1].x - pts[i].x) * f,
              y: pts[i].y + (pts[i + 1].y - pts[i].y) * f,
            };
          }
          run += segs[i];
        }
        return pts[pts.length - 1];
      };
      mid = at(0.5);
      run = e.points;
      // slide along the wire before standing further off it — same ladder the
      // edge-label pills walk, so a note and its pill spread rather than stack
      for (const off of [16, 40, 64])
        for (const frac of [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74]) {
          const q = at(frac);
          cands.push({ x: q.x + off, y: q.y - Math.round(h / 2) });
        }
    } else {
      // A corner note is chrome: it means "pinned to the frame", so it hugs an
      // edge rather than drifting toward the middle. Stepping inward
      // diagonally was the first attempt and it read as a floating note that
      // had lost its corner. Slide along the horizontal edge first, then the
      // vertical one, staying at the 16px inset the whole way.
      const c = note.anchor.corner;
      const x0 = c.includes("left") ? 16 : p.width - w - 16;
      const y0 = c.includes("top") ? 16 : p.height - h - 16;
      const dx = c.includes("left") ? 24 : -24;
      // A short slide along the edge for a near-miss…
      for (let k = 0; k <= 4; k++) cands.push({ x: x0 + k * dx, y: y0 });
      // …then outward, off the current canvas. Growing the diagram is the
      // right answer for chrome: the note keeps its corner and the content
      // makes room, rather than the note wandering along the bottom edge until
      // `bottom-right` ends up on the left, which is what sliding produced.
      const out = c.includes("top") ? -24 : 24;
      for (let k = 1; k <= 12; k++) cands.push({ x: x0, y: y0 + k * out });
    }

    // Two passes: prefer a spot inside the canvas we already have, and only
    // spill outside — which widens or lengthens the whole diagram — when there
    // is genuinely nowhere in. Without this the ladder took the first clear
    // candidate in order, and since it tries the near side first, a `below`
    // note dodging a label pill slid left off the canvas and pushed every
    // other element 200px right to make room for it.
    const inX = (r: Rect) => r.x >= 0 && r.x + r.w <= p.width;
    const inY = (r: Rect) => r.y >= 0 && r.y + r.h <= p.height;
    // Three passes, loosening one axis at a time. Growing the canvas is
    // sometimes unavoidable — a `below` note on the bottom row has nowhere
    // else to go — but there is a real difference between extending downward,
    // which reads as the diagram getting taller, and sliding off the left
    // edge, which shifts every other element sideways to make room. Taking
    // the first clear candidate in ladder order did the latter.
    const fits: ((r: Rect) => boolean)[] = [
      (r) => inX(r) && inY(r),
      (r) => inX(r),
      () => true,
    ];
    let x = Math.round(cands[0]?.x ?? 16), y = Math.round(cands[0]?.y ?? 16);
    let found = false;
    // The room a node-anchored note reserved (`Box.room`, plan.ts) is where it goes —
    // unless something the engine did not place is in it: a pill, a badge, an
    // earlier note. Then the ladder runs as it would have.
    const room = noteRoom.get(noteIdx);
    if (room && anchor) {
      const L = { x: anchor.x + room.dx, y: anchor.y + room.dy, w: room.w, h: room.h };
      const rp = (note.anchor as any).relpos as string;
      const face = NOTE_FACE[rp];
      const along = face === "north" || face === "south";
      const at = ports.filter((pt) => pt.node === anchor!.path && pt.side === face);
      // centred on a room that may be narrower than the note
      const r = along
        ? { x: L.x + Math.round((L.w - w) / 2), y: L.y, w, h }
        : { x: L.x, y: L.y + Math.round((L.h - h) / 2), w, h };
      if (along) {
        if (face === "south") r.y = L.y + L.h - h;
        // past the last wire on the face, never past the room
        if (at.length) r.x = Math.min(Math.max(...at.map((pt) => pt.x)) + NOTE_CLEAR, L.x + L.w - w);
      } else {
        if (face === "east") r.x = L.x + L.w - w;
        if (at.length) r.y = Math.min(Math.max(...at.map((pt) => pt.y)) + NOTE_CLEAR, L.y + L.h - h);
      }
      if (clear(r)) { x = r.x; y = r.y; found = true; }
    }
    // An edge note's reservation is inline on its own wire; the ladder's
    // first rung stands it beside that wire instead, inside the room the
    // label made. The reservation is what is left when no rung is clear.
    // Room an engine kept beside the wire for this note is where it goes, if
    // nothing the engine could not see is in it.
    if (!found && reserved && clear({ ...reserved, w, h })) { x = reserved.x; y = reserved.y; found = true; }
    for (const strict of [true, false]) {
      for (const fit of found ? [] : fits) {
        for (const c of cands) {
          const r = { x: Math.round(c.x), y: Math.round(c.y), w, h };
          if (!fit(r) || !clear(r, strict)) continue;
          x = r.x; y = r.y; found = true;
          break;
        }
        if (found) break;
      }
      if (!found && reserved) { x = reserved.x; y = reserved.y; found = true; }
    }
    // Nothing on the ladder was free. Keep travelling in the authored
    // direction until it is: a note may leave the cluster entirely because its
    // dotted leader keeps it attached — the property edge-labels.md wishes
    // pills had. Bounded, like the pill fallback, so a pathological diagram
    // cannot spin.
    if (!found) {
      const rp = note.anchor.kind === "relpos" ? note.anchor.relpos : undefined;
      const step = rp === "above" ? { dx: 0, dy: -24 }
        : rp === "below" ? { dx: 0, dy: 24 }
        : rp === "left-of" ? { dx: -24, dy: 0 }
        : note.anchor.kind === "corner"
          // keep travelling along the edge it is pinned to, never into the middle
          ? { dx: 0, dy: note.anchor.corner.includes("top") ? 24 : -24 }
          : { dx: 24, dy: 0 };
      const last = cands[cands.length - 1] ?? { x, y };
      x = Math.round(last.x); y = Math.round(last.y);
      for (let guard = 0; guard < 50 && !clear({ x, y, w, h }, false); guard++) {
        x += step.dx; y += step.dy;
      }
    }
    placed.push({ x, y, w, h });

    // the leader is drawn from where the note *ended up*, not where it was
    // first tried
    // Attach at the nearest point on each box, not at a fixed side-midpoint.
    // The midpoint was right when a note always sat exactly beside its anchor,
    // but a note now slides to dodge obstacles — so a note that ended up well
    // below its node still had its leader leaving the node's right edge dead
    // centre, reading as a diagonal fired out of the right-hand side. Clamping
    // is also a no-op for the un-slid case (a note level with its node still
    // attaches at the side midpoint), so nothing that was already correct
    // moves.
    const clamp = (pt: { x: number; y: number }, r: Rect) => ({
      x: Math.max(r.x, Math.min(pt.x, r.x + r.w)),
      y: Math.max(r.y, Math.min(pt.y, r.y + r.h)),
    });
    const noteRect = { x, y, w, h };
    const noteMid = { x: x + w / 2, y: y + h / 2 };
    let leader: { x1: number; y1: number; x2: number; y2: number } | undefined;
    if (anchor) {
      const n = { x: anchor.x, y: anchor.y, w: anchor.w, h: anchor.h };
      const from = clamp({ x: n.x + n.w / 2, y: n.y + n.h / 2 }, noteRect);
      const to = clamp(noteMid, n);
      leader = { x1: from.x, y1: from.y, x2: to.x, y2: to.y };
    } else if (mid) {
      // To the nearest point of the wire, not its midpoint. They were the
      // same while a note always stood beside the midpoint; on a dog-leg the
      // midpoint is on the cross run, and a note standing beside the last
      // vertical run reached back to it with a long diagonal.
      let to = mid, best = Infinity;
      for (let i = 0; i + 1 < (run?.length ?? 0); i++) {
        const a = run![i], b = run![i + 1];
        const dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy;
        const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((noteMid.x - a.x) * dx + (noteMid.y - a.y) * dy) / len));
        const pt = { x: a.x + dx * t, y: a.y + dy * t };
        const d = Math.hypot(pt.x - noteMid.x, pt.y - noteMid.y);
        if (d < best) { best = d; to = pt; }
      }
      const from = clamp(to, noteRect);
      leader = { x1: from.x, y1: from.y, x2: to.x, y2: to.y };
    }

    // canvas pad/shift is the renderer's: it recomputes the extent from these
    // rects exactly as it did when it owned placement, so the move is inert
    out.push({
      i: noteIdx, x, y, w, h, prose,
      leader: leader
        ? { x1: Math.round(leader.x1), y1: Math.round(leader.y1), x2: Math.round(leader.x2), y2: Math.round(leader.y2) }
        : undefined,
    });
  }
  }
  return pNotes;
}
