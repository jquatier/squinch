// Positioned → deterministic SVG string. DESIGN.md-lite: fixed node anatomy, rounded
// orthogonal edges, chevron arrowheads, pill edge labels. Integers only, LF only,
// fixed attribute order — the string IS the artifact under byte-identity test.
import { fit, measure } from "./metrics.js";
import type { Positioned, PEdge } from "./layout.js";

const T = {
  canvas: "#F7F7F5",
  surface: "#FFFFFF",
  border: "#D8D7D3",
  ink: "#1C1C1A",
  muted: "#6F6E69",
  edge: "#8A897F",
  asyncEdge: "#7C74D9",
  plate: { APIGW: "#B0468C", "λ": "#D9760A", DDB: "#4568C9", S3: "#6C8F1F", OS: "#8A5FC9" } as Record<string, string>,
};
const PLATE = 40;
const PAD = 12;
const R_NODE = 4;
const R_EDGE = 8;

function roundedPath(pts: { x: number; y: number }[], r = R_EDGE): string {
  if (pts.length < 3) return `M ${pts[0].x} ${pts[0].y} L ${pts[pts.length - 1].x} ${pts[pts.length - 1].y}`;
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i - 1], c = pts[i], n = pts[i + 1];
    const inLen = Math.hypot(c.x - p.x, c.y - p.y);
    const outLen = Math.hypot(n.x - c.x, n.y - c.y);
    const rr = Math.min(r, Math.floor(inLen / 2), Math.floor(outLen / 2));
    if (rr < 2) { d += ` L ${c.x} ${c.y}`; continue; }
    const inX = c.x - Math.sign(c.x - p.x) * rr, inY = c.y - Math.sign(c.y - p.y) * rr;
    const outX = c.x + Math.sign(n.x - c.x) * rr, outY = c.y + Math.sign(n.y - c.y) * rr;
    d += ` L ${inX} ${inY} Q ${c.x} ${c.y} ${outX} ${outY}`;
  }
  d += ` L ${pts[pts.length - 1].x} ${pts[pts.length - 1].y}`;
  return d;
}

function arrow(e: PEdge): string {
  const n = e.points.length;
  const tip = e.points[n - 1], prev = e.points[n - 2];
  const dx = Math.sign(tip.x - prev.x), dy = Math.sign(tip.y - prev.y);
  // chevron: 8 long, 6 half-width, oriented along (dx,dy)
  const bx = tip.x - dx * 8, by = tip.y - dy * 8;
  const p1 = `${bx + dy * 6} ${by + dx * 6}`, p2 = `${bx - dy * 6} ${by - dx * 6}`;
  const col = e.async ? T.asyncEdge : T.edge;
  return e.async
    ? `<path d="M ${p1} L ${tip.x} ${tip.y} L ${p2}" fill="none" stroke="${col}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<path d="M ${tip.x} ${tip.y} L ${p1} L ${p2} Z" fill="${col}"/>`;
}

function edgeLabel(e: PEdge, nodeBottom: (id: string) => number): string {
  if (!e.label) return "";
  // longest segment's midpoint
  let best = 0, bi = 0;
  for (let i = 0; i < e.points.length - 1; i++) {
    const len = Math.hypot(e.points[i + 1].x - e.points[i].x, e.points[i + 1].y - e.points[i].y);
    if (len > best) { best = len; bi = i; }
  }
  const mx = Math.round((e.points[bi].x + e.points[bi + 1].x) / 2);
  let my = Math.round((e.points[bi].y + e.points[bi + 1].y) / 2);
  const w = Math.round(measure(e.label, 11, "400")) + 12;
  // Pill wider than its segment would sit on the endpoint nodes — drop it below them.
  if (w > best - 8) my = Math.max(nodeBottom(e.from), nodeBottom(e.to)) + 17;
  const x = mx - Math.round(w / 2), y = my - 9;
  return (
    `<rect x="${x}" y="${y}" width="${w}" height="18" rx="2" fill="${T.surface}" stroke="${T.border}" stroke-width="1"/>` +
    `<text x="${mx}" y="${y + 13}" text-anchor="middle" font-size="11" fill="${T.muted}">${esc(e.label)}</text>`
  );
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderSVG(p: Positioned): string {
  const L: string[] = [];
  L.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${p.width}" height="${p.height}" viewBox="0 0 ${p.width} ${p.height}" font-family="Inter, system-ui, sans-serif">`,
  );
  L.push(`<rect width="${p.width}" height="${p.height}" fill="${T.canvas}"/>`);

  for (const e of p.edges) {
    const col = e.async ? T.asyncEdge : T.edge;
    const dash = e.async ? ` stroke-dasharray="6 4"` : "";
    L.push(`<path d="${roundedPath(e.points)}" fill="none" stroke="${col}" stroke-width="1.5"${dash}/>`);
    L.push(arrow(e));
  }

  for (const n of p.nodes) {
    L.push(
      `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="${R_NODE}" fill="${T.surface}" stroke="${T.border}" stroke-width="1.5"/>`,
    );
    const plate = T.plate[n.icon] ?? T.muted;
    const px = n.x + PAD, py = n.y + PAD;
    L.push(`<rect x="${px}" y="${py}" width="${PLATE}" height="${PLATE}" rx="4" fill="${plate}"/>`);
    L.push(
      `<text x="${px + PLATE / 2}" y="${py + PLATE / 2 + 4}" text-anchor="middle" font-size="11" font-weight="500" fill="#FFFFFF">${esc(n.icon)}</text>`,
    );
    const maxLabel = n.w - PAD - PLATE - PAD - PAD;
    L.push(
      `<text x="${px + PLATE + PAD}" y="${n.y + n.h / 2 + 5}" font-size="13" font-weight="500" fill="${T.ink}">${esc(fit(n.label, maxLabel, 13, "500"))}</text>`,
    );
  }

  const bottom = (id: string) => {
    const n = p.nodes.find((x) => x.id === id)!;
    return n.y + n.h;
  };
  for (const e of p.edges) {
    const lbl = edgeLabel(e, bottom);
    if (lbl) L.push(lbl);
  }

  L.push(`</svg>`);
  return L.join("\n") + "\n";
}
