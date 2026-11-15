// Annotations: what stands on a finished layout beside its boxes and wires —
// flow badges, zone chips, and the flag on a frame title a wire runs through.
// Placement is geometry, so it belongs to layout: `checkLayout` can only
// assert what `Positioned` carries. Order is the obstacle registry: pills
// exist, badges are carved out of their reservations, chips avoid both, and
// the note resolver (`notes.ts`) sees all three.
//
// Nothing here knows which engine laid the view out.
import { fit, measure } from "../metrics.js";
import type { ViewGraph } from "../view/resolve.js";
import type { ThemeFont } from "../themes/index.js";
import type { PEdge, PFrame, PNode, PZone, Positioned } from "./positioned.js";
import { CHIP_H } from "./sizes.js";

type Font = Pick<ThemeFont, "metrics" | "scale">;
type Rect = { x: number; y: number; w: number; h: number };

/** Between a badge and the pill it shares a reservation with. */
export const BADGE_GAP = 4;

/** How wide the badge for an edge's flow steps is — sized from the FULL
 *  flow's numbers, so walking a flow one hop at a time cannot change the
 *  geometry. 0 for an edge no flow step runs along. */
export function badgeWidth(flow: ViewGraph["flow"], edgeId: string, font: Font): number {
  const nums = flow?.byEdge[edgeId];
  if (!nums?.length) return 0;
  return Math.max(9, Math.round(measure(nums.join("·"), Math.round(10 * font.scale), "500", font.metrics) / 2) + 5) * 2;
}

export const hitR = (a: Rect, b: Rect, m = 4) =>
  a.x < b.x + b.w + m && a.x + a.w + m > b.x && a.y < b.y + b.h + m && a.y + a.h + m > b.y;

/** Badges and chips for a laid-out view. Carves each badge out of its edge's
 *  `labelRect` (mutating it), so everything downstream sees a labelRect that
 *  means "the pill draws here". */
export function annotate(
  graph: ViewGraph, pEdges: PEdge[], nodes: PNode[], pZones: PZone[], font: Font,
): { badges: Positioned["badges"]; chips: Positioned["chips"]; pillRects: (Rect & { edgeId: string })[] } {
  const fx = (px: number) => Math.round(px * font.scale);
  const badgeW = (edgeId: string) => badgeWidth(graph.flow, edgeId, font);
  /** Nearest point ON the wire, projected onto its segments — not the nearest
   *  vertex, which is always a corner and puts the badge in the elbow. */
  const nearestPoint = (pts: { x: number; y: number }[], x: number, y: number) => {
    let best = pts[0], bestD = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2)) : 0;
      const p = { x: Math.round(a.x + dx * t), y: Math.round(a.y + dy * t) };
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  };
  /** Halfway along the polyline, not the middle vertex — a two-point coplanar
   *  run has no middle vertex, and its "middle" would be the arrowhead. */
  const midOfRun = (pts: { x: number; y: number }[]) => {
    const segs = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y));
    let left = segs.reduce((a, b) => a + b, 0) / 2;
    for (let i = 0; i < segs.length; i++) {
      if (segs[i] >= left) {
        const t = segs[i] ? left / segs[i] : 0;
        return { x: Math.round(pts[i].x + (pts[i + 1].x - pts[i].x) * t), y: Math.round(pts[i].y + (pts[i + 1].y - pts[i].y) * t) };
      }
      left -= segs[i];
    }
    return pts[pts.length - 1];
  };
  const badges: Positioned["badges"] = [];
  if (graph.flow) {
    for (const e of pEdges) {
      const nums = graph.flow.byEdge[e.id] ?? [];
      if (!nums.length) continue;
      const bw = badgeW(e.id);
      const r = e.labelRect;
      // No pill: the badge is a bead on the wire, centred on the point of the
      // edge nearest its own label dummy — which ELK placed at the median layer
      // of *this* edge, so the number can no longer end up beside a neighbour's
      // line. Falls back to the middle vertex for an edge ELK gave no label.
      if (!r || !e.label) {
        const at = r ? nearestPoint(e.points, r.x + r.w / 2, r.y + r.h / 2) : midOfRun(e.points);
        badges.push({ edgeId: e.id, x: Math.round(at.x - bw / 2), y: at.y - 9, w: bw, h: 18, nums });
        continue;
      }
      // With a pill, the reservation covers both and either end of it is free.
      // Put the badge at the end nearest the wire: the number then reads as
      // belonging to that line rather than to whatever pill it sits beside.
      const vertical = r.h > r.w;
      const near = nearestPoint(e.points, r.x + r.w / 2, r.y + r.h / 2);
      if (vertical) {
        const atTop = near.y <= r.y + r.h / 2;
        badges.push({ edgeId: e.id, x: r.x + Math.round((r.w - 18) / 2), y: atTop ? r.y : r.y + r.h - bw, w: 18, h: bw, nums });
        if (atTop) r.y += bw + BADGE_GAP;
        r.h -= bw + BADGE_GAP;
      } else {
        const atLeft = near.x <= r.x + r.w / 2;
        badges.push({ edgeId: e.id, x: atLeft ? r.x : r.x + r.w - bw, y: r.y + Math.round((r.h - 18) / 2), w: bw, h: 18, nums });
        if (atLeft) r.x += bw + BADGE_GAP;
        r.w -= bw + BADGE_GAP;
      }
    }
  }

  // the DRAWN pill, not the reservation: a reservation can be taller (it
  // doubles as the gap spacer), and chips historically avoided the 18-tall
  // pill the renderer draws centred inside it — feeding them the raw
  // reservation shifted 7 views by 3px at the gate
  // e.label too, not just labelRect: unlabelled edges carry 2px spacer labels
  // (the gap-arithmetic trick), and those come back as ghost labelRects. The
  // renderer always ignored them (`if (!e.label)`); obstacles must too.
  const pillRects = pEdges.filter((e) => e.label && e.labelRect).map((e) => ({
    x: e.labelRect!.x,
    y: e.labelRect!.y + Math.round((e.labelRect!.h - 18) / 2),
    w: e.labelRect!.w, h: 18, edgeId: e.id,
  }));

  const chips: Positioned["chips"] = [];
  {
    const segs = pEdges.flatMap((e) => {
      const out: { x: number; y: number; w: number; h: number }[] = [];
      for (let i = 0; i < e.points.length - 1; i++) {
        const a = e.points[i], b = e.points[i + 1];
        out.push({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) });
      }
      return out;
    });
    const obstacles = () => [...segs, ...nodes, ...pillRects, ...badges, ...chips];
    for (const z of [...pZones].sort((a, b) => a.depth - b.depth)) {
      // Chip anatomy (docs/design): a flush icon tab, the label segment, and
      // an optional mono segment for the boundary's hard fact. Each segment is
      // measured in the face it will be drawn with — the mono one in mono
      // metrics — because the placer's rect must be the rect the renderer
      // fills, or the chip overhangs its own border.
      const iconW = z.icon ? CHIP_H : 0; // a square tab, flush with the label bed
      const room = z.w - 24; // 12 clear of each corner
      const labelNat = Math.round(measure(z.label, fx(11), "500", font.metrics)) + 16;
      const detailNat = z.detail ? Math.round(measure(z.detail, fx(11), "400", "mono")) + 16 : 0;
      // The detail segment is all-or-nothing: it holds facts like `10.0.0.0/16`
      // where a truncated value is not a shortened label, it is a *different
      // network*. So when the boundary is too narrow for both, the segment goes
      // and the name keeps its room; only if the name alone still overflows
      // does it ellipsize.
      const showDetail = !!z.detail && iconW + labelNat + detailNat <= room;
      const detail = showDetail ? z.detail : undefined;
      const detailW = showDetail ? detailNat : 0;
      const label = fit(z.label, Math.max(24, room - iconW - detailW - 16), fx(11), "500", font.metrics);
      const w = Math.round(measure(label, fx(11), "500", font.metrics)) + 16 + iconW + detailW;
      const y = z.labelPos.startsWith("top") ? z.y - CHIP_H / 2 : z.y + z.h - CHIP_H / 2;
      const xLo = z.x + 12;
      const xHi = Math.max(xLo, z.x + z.w - 12 - w);
      const fromRight = z.labelPos.endsWith("right");
      let best = { x: fromRight ? xHi : xLo, hits: Infinity };
      for (let step = 0; ; step++) {
        const x = fromRight ? xHi - step * 16 : xLo + step * 16;
        if (x < xLo || x > xHi) break;
        const rect = { x, y, w, h: CHIP_H };
        const n = obstacles().filter((o) =>
          o.x < rect.x + rect.w + 6 && o.x + o.w + 6 > rect.x &&
          o.y < rect.y + rect.h + 6 && o.y + o.h + 6 > rect.y).length;
        if (n < best.hits) best = { x, hits: n };
        if (n === 0) break;
      }
      chips.push({
        x: best.x, y, w, h: CHIP_H, label, zone: z.id, icon: z.icon,
        ...(detail ? { detail, detailW } : {}),
      });
    }
  }
  return { badges, chips, pillRects };
}

/** A frame title is text in the frame's padding, and a wire can legitimately
 *  run through that padding. The title does what zone chips do: it is drawn
 *  last, on a canvas halo, whenever a wire crosses its rect. */
export function markCrossedTitles(frames: PFrame[], pEdges: PEdge[], font: Font): void {
  const fx = (px: number) => Math.round(px * font.scale);
  {
    // the header's geometry, mirrored from the renderer's `frameHeader`: a
    // 24px chip at (12, 9) then the title 8 past it, or the bare title at (14, 24)
    const titleRect = (f: PFrame) => ({
      x: f.icon ? f.x + 12 : f.x + 14, y: f.icon ? f.y + 9 : f.y + 24 - 13,
      w: (f.icon ? 24 + 8 : 0) + Math.round(measure(f.label, fx(13), "500", font.metrics)),
      h: f.icon ? 24 : 17,
    });
    const hit = (r: { x: number; y: number; w: number; h: number }, e: PEdge) => {
      for (let i = 0; i < e.points.length - 1; i++) {
        const a = e.points[i], b = e.points[i + 1];
        const seg = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
        if (seg.x < r.x + r.w && seg.x + seg.w > r.x && seg.y < r.y + r.h && seg.y + seg.h > r.y) return true;
      }
      return false;
    };
    for (const f of frames) {
      const r = titleRect(f);
      if (pEdges.some((e) => hit(r, e))) f.titleCrossed = true;
    }
  }
}
