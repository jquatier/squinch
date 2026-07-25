// Positioned + Theme → deterministic SVG string (DESIGN.md-lite; integers, LF,
// fixed attribute order — the string is the artifact under byte-identity tests).
import { fit, measure } from "../metrics.js";
import { iconMeta } from "../model/packs.js";
import type { Theme } from "../themes/index.js";
import type { Positioned, PEdge } from "../layout/layout.js";

const PLATE = 40;
const PAD = 12;
const R_NODE = 4;
const R_EDGE = 8;

function roundedPath(pts: { x: number; y: number }[], r = R_EDGE): string {
  if (pts.length < 3)
    return `M ${pts[0].x} ${pts[0].y} L ${pts[pts.length - 1].x} ${pts[pts.length - 1].y}`;
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i - 1], c = pts[i], n = pts[i + 1];
    const rr = Math.min(
      r,
      Math.floor(Math.hypot(c.x - p.x, c.y - p.y) / 2),
      Math.floor(Math.hypot(n.x - c.x, n.y - c.y) / 2),
    );
    if (rr < 2) { d += ` L ${c.x} ${c.y}`; continue; }
    d += ` L ${c.x - Math.sign(c.x - p.x) * rr} ${c.y - Math.sign(c.y - p.y) * rr}`
      + ` Q ${c.x} ${c.y} ${c.x + Math.sign(n.x - c.x) * rr} ${c.y + Math.sign(n.y - c.y) * rr}`;
  }
  d += ` L ${pts[pts.length - 1].x} ${pts[pts.length - 1].y}`;
  return d;
}

function arrow(e: PEdge, t: Theme): string {
  const n = e.points.length;
  const tip = e.points[n - 1], prev = e.points[n - 2];
  const dx = Math.sign(tip.x - prev.x), dy = Math.sign(tip.y - prev.y);
  const bx = tip.x - dx * 8, by = tip.y - dy * 8;
  const p1 = `${bx + dy * 6} ${by + dx * 6}`, p2 = `${bx - dy * 6} ${by - dx * 6}`;
  const col = e.async ? t.asyncEdge : t.edge;
  return e.async
    ? `<path d="M ${p1} L ${tip.x} ${tip.y} L ${p2}" fill="none" stroke="${col}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<path d="M ${tip.x} ${tip.y} L ${p1} L ${p2} Z" fill="${col}"/>`;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function edgeLabel(e: PEdge, t: Theme, nodeBottom: (p: string) => number): string {
  if (!e.label) return "";
  let best = 0, bi = 0;
  for (let i = 0; i < e.points.length - 1; i++) {
    const len = Math.hypot(e.points[i + 1].x - e.points[i].x, e.points[i + 1].y - e.points[i].y);
    if (len > best) { best = len; bi = i; }
  }
  const mx = Math.round((e.points[bi].x + e.points[bi + 1].x) / 2);
  let my = Math.round((e.points[bi].y + e.points[bi + 1].y) / 2);
  const w = Math.round(measure(e.label, 11, "400")) + 12;
  if (w > best - 8) my = Math.max(nodeBottom(e.from), nodeBottom(e.to)) + 17;
  const x = mx - Math.round(w / 2), y = my - 9;
  return (
    `<rect x="${x}" y="${y}" width="${w}" height="18" rx="2" fill="${t.surface}" stroke="${t.border}" stroke-width="1"/>` +
    `<text x="${mx}" y="${y + 13}" text-anchor="middle" font-size="11" fill="${t.muted}">${esc(e.label)}</text>`
  );
}

export function renderSVG(p: Positioned, t: Theme): string {
  const L: string[] = [];
  L.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${p.width}" height="${p.height}" viewBox="0 0 ${p.width} ${p.height}" font-family="Inter, system-ui, sans-serif">`,
  );
  L.push(`<rect width="${p.width}" height="${p.height}" fill="${t.canvas}"/>`);

  for (const e of p.edges) {
    const col = e.async ? t.asyncEdge : t.edge;
    const dash = e.async ? ` stroke-dasharray="6 4"` : "";
    L.push(`<path d="${roundedPath(e.points)}" fill="none" stroke="${col}" stroke-width="1.5"${dash}/>`);
    L.push(arrow(e, t));
  }

  for (const n of p.nodes) {
    L.push(
      `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="${R_NODE}" fill="${t.surface}" stroke="${t.border}" stroke-width="1.5"/>`,
    );
    const meta = n.icon ? iconMeta(n.icon.pack, n.icon.id) : undefined;
    const px = n.x + PAD, py = n.y + PAD;
    L.push(`<rect x="${px}" y="${py}" width="${PLATE}" height="${PLATE}" rx="4" fill="${meta?.color ?? t.muted}"/>`);
    L.push(
      `<text x="${px + PLATE / 2}" y="${py + PLATE / 2 + 4}" text-anchor="middle" font-size="11" font-weight="500" fill="${t.plateText}">${esc(meta?.code ?? "?")}</text>`,
    );
    const maxLabel = n.w - PAD - PLATE - PAD - PAD;
    L.push(
      `<text x="${px + PLATE + PAD}" y="${n.y + n.h / 2 + 5}" font-size="13" font-weight="500" fill="${t.ink}">${esc(fit(n.label, maxLabel, 13, "500"))}</text>`,
    );
  }

  const bottom = (path: string) => {
    const n = p.nodes.find((x) => x.path === path)!;
    return n.y + n.h;
  };
  for (const e of p.edges) {
    const lbl = edgeLabel(e, t, bottom);
    if (lbl) L.push(lbl);
  }

  L.push(`</svg>`);
  return L.join("\n") + "\n";
}
