// Positioned + Theme (+ view annotations) → deterministic SVG string.
// DESIGN.md-lite; integers, LF, fixed attribute order — the string is the
// artifact under byte-identity tests.
import { fit, measure } from "../metrics.js";
import { iconMeta } from "../model/packs.js";
import type { Theme } from "../themes/index.js";
import type { Positioned, PEdge, PNode } from "../layout/layout.js";
import type { SNote } from "../model/types.js";

const PLATE = 40;
const PAD = 12;
const R_NODE = 4;
const R_EDGE = 8;
const DIM = "0.35";

export interface RenderOpts {
  highlight?: string[];
  notes?: SNote[];
  showDescriptions?: boolean;
}

function edgePath(pts: { x: number; y: number }[], lines: Positioned["lines"]): string {
  if (lines === "straight")
    return `M ${pts[0].x} ${pts[0].y} L ${pts[pts.length - 1].x} ${pts[pts.length - 1].y}`;
  return roundedPath(pts, lines === "curved" ? 24 : R_EDGE);
}

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

/** Greedy word-wrap against the metrics table; ≤maxLines, last line ellipsized. */
function wrap(text: string, maxPx: number, sizePx: number, maxLines: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const attempt = cur ? `${cur} ${w}` : w;
    if (measure(attempt, sizePx, "400") <= maxPx) cur = attempt;
    else {
      if (cur) lines.push(cur);
      cur = w;
      if (lines.length === maxLines - 1) break;
    }
  }
  if (lines.length < maxLines) lines.push(cur);
  const consumed = lines.join(" ").length;
  if (consumed < text.length) {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = fit(`${last}${text.slice(consumed)}`, maxPx, sizePx, "400");
  }
  return lines;
}

function leaf(n: PNode, t: Theme, opts: RenderOpts, dimmed: boolean, L: string[]) {
  const op = dimmed ? ` opacity="${DIM}"` : "";
  const ctx = n.kind === "context-leaf";
  const stroke = ctx ? ` stroke-dasharray="4 3"` : "";
  L.push(`<g${op}>`);
  L.push(
    `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="${R_NODE}" fill="${t.surface}" stroke="${t.border}" stroke-width="1.5"${stroke}/>`,
  );
  const meta = n.icon ? iconMeta(n.icon.pack, n.icon.id) : undefined;
  const px = n.x + PAD, py = n.y + PAD;
  L.push(`<rect x="${px}" y="${py}" width="${PLATE}" height="${PLATE}" rx="4" fill="${meta?.color ?? t.muted}"${ctx ? ` opacity="0.55"` : ""}/>`);
  L.push(
    `<text x="${px + PLATE / 2}" y="${py + PLATE / 2 + 4}" text-anchor="middle" font-size="11" font-weight="500" fill="${t.plateText}">${esc(meta?.code ?? "?")}</text>`,
  );
  const maxLabel = n.w - PAD - PLATE - PAD - PAD;
  const withDesc = opts.showDescriptions && n.description;
  const labelY = withDesc ? n.y + n.h / 2 - 1 : n.y + n.h / 2 + 5;
  L.push(
    `<text x="${px + PLATE + PAD}" y="${labelY}" font-size="13" font-weight="500" fill="${ctx ? t.muted : t.ink}">${esc(fit(n.label, maxLabel, 13, "500"))}</text>`,
  );
  if (withDesc)
    L.push(
      `<text x="${px + PLATE + PAD}" y="${n.y + n.h / 2 + 15}" font-size="11" fill="${t.muted}">${esc(fit(n.description!, maxLabel, 11, "400"))}</text>`,
    );
  L.push(`</g>`);
}

function card(n: PNode, t: Theme, dimmed: boolean, L: string[]) {
  const ctx = n.kind === "context-card";
  // one opacity, never two: dim wins over the context fade
  const op = dimmed ? ` opacity="${DIM}"` : ctx ? ` opacity="0.75"` : "";
  const stroke = ctx ? ` stroke-dasharray="4 3"` : "";
  L.push(`<g${op}>`);
  L.push(
    `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="6" fill="${t.surface}" stroke="${t.border}" stroke-width="1.5"${stroke}/>`,
  );
  // accent bar (kind silhouette, DESIGN §3)
  L.push(`<rect x="${n.x}" y="${n.y}" width="4" height="${n.h}" rx="2" fill="${ctx ? t.muted : t.accent}"/>`);
  const tx = n.x + PAD + 6;
  L.push(
    `<text x="${tx}" y="${n.y + 34}" font-size="15" font-weight="500" fill="${ctx ? t.muted : t.ink}">${esc(fit(n.label, n.w - 60, 15, "500"))}</text>`,
  );
  if (n.tagline)
    L.push(
      `<text x="${tx}" y="${n.y + 54}" font-size="11" fill="${t.muted}">${esc(fit(n.tagline, n.w - 40, 11, "400"))}</text>`,
    );
  if (n.glyph) {
    const g = iconMeta(n.glyph.pack, n.glyph.id);
    if (g)
      L.push(
        `<text x="${n.x + n.w - PAD}" y="${n.y + 22}" text-anchor="end" font-size="10" font-weight="500" fill="${t.muted}">${esc(g.code)}</text>`,
      );
  }
  // preview strip: up to 3 inner icons, bottom-right, 16px at 60%
  n.preview.forEach((icon, i) => {
    const meta = iconMeta(icon.pack, icon.id);
    if (!meta) return;
    const ix = n.x + n.w - PAD - 16 - i * 20;
    const iy = n.y + n.h - PAD - 16;
    L.push(`<rect x="${ix}" y="${iy}" width="16" height="16" rx="3" fill="${meta.color}" opacity="0.6"/>`);
  });
  L.push(`</g>`);
}

function notes(p: Positioned, t: Theme, list: SNote[], L: string[]) {
  const byPath = new Map(p.nodes.map((n) => [n.path, n]));
  for (const note of list) {
    const inner = 176;
    const lines = wrap(note.text, inner, 11, 3);
    const w = Math.min(200, Math.max(...lines.map((l) => measure(l, 11, "400"))) + 24);
    const h = lines.length * 15 + 12;
    let x = 0, y = 0;
    let leader: { x1: number; y1: number; x2: number; y2: number } | undefined;

    if (note.anchor.kind === "relpos") {
      const n = byPath.get(note.anchor.target);
      if (!n) continue;
      const rp = note.anchor.relpos;
      if (rp === "right-of") { x = n.x + n.w + 24; y = n.y + Math.round(n.h / 2) - Math.round(h / 2); leader = { x1: x, y1: y + h / 2, x2: n.x + n.w, y2: n.y + n.h / 2 }; }
      if (rp === "left-of") { x = n.x - 24 - w; y = n.y + Math.round(n.h / 2) - Math.round(h / 2); leader = { x1: x + w, y1: y + h / 2, x2: n.x, y2: n.y + n.h / 2 }; }
      if (rp === "above") { x = n.x + Math.round(n.w / 2) - Math.round(w / 2); y = n.y - 24 - h; leader = { x1: x + w / 2, y1: y + h, x2: n.x + n.w / 2, y2: n.y }; }
      if (rp === "below") { x = n.x + Math.round(n.w / 2) - Math.round(w / 2); y = n.y + n.h + 24; leader = { x1: x + w / 2, y1: y, x2: n.x + n.w / 2, y2: n.y + n.h }; }
    } else if (note.anchor.kind === "edge") {
      const e = p.edges.find(
        (e) => e.from === (note.anchor as any).from && e.to === (note.anchor as any).to,
      );
      if (!e) continue;
      const mid = e.points[Math.floor(e.points.length / 2) - 1] ?? e.points[0];
      x = mid.x + 16;
      y = mid.y - h - 8;
      leader = { x1: x, y1: y + h, x2: mid.x, y2: mid.y };
    } else {
      const c = note.anchor.corner;
      x = c.includes("left") ? 16 : p.width - w - 16;
      y = c.includes("top") ? 16 : p.height - h - 16;
    }
    x = Math.round(x); y = Math.round(y);
    const bg = note.style === "warning" ? t.warnTint : t.surface;
    if (leader)
      L.push(
        `<line x1="${Math.round(leader.x1)}" y1="${Math.round(leader.y1)}" x2="${Math.round(leader.x2)}" y2="${Math.round(leader.y2)}" stroke="${t.muted}" stroke-width="1" stroke-dasharray="2 3"/>`,
      );
    L.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${bg}" stroke="${t.border}" stroke-width="1"/>`);
    lines.forEach((line, i) =>
      L.push(
        `<text x="${x + 12}" y="${y + 17 + i * 15}" font-size="11" fill="${t.ink}">${esc(line)}</text>`,
      ),
    );
  }
}

interface Pill { x: number; y: number; w: number; h: number; mx: number; label: string; dimmed: boolean }

const intersects = (a: Pill | { x: number; y: number; w: number; h: number }, b: Pill, m = 4) =>
  a.x < b.x + b.w + m && a.x + a.w + m > b.x && a.y < b.y + b.h + m && a.y + a.h + m > b.y;

/**
 * Compute all edge-label pills, then resolve collisions deterministically:
 * a pill overlapping a node or an earlier pill shifts down until clear
 * (DESIGN: a label never sits on another label — enforced, not hoped).
 */
function computePills(p: Positioned, edgeMatches: (e: PEdge) => boolean): Pill[] {
  const byPath = new Map(p.nodes.map((n) => [n.path, n]));
  const nodeBottom = (path: string) => {
    const n = byPath.get(path)!;
    return n.y + n.h;
  };
  const pills: Pill[] = [];
  for (const e of p.edges) {
    if (!e.label) continue;
    let best = 0, bi = 0;
    for (let i = 0; i < e.points.length - 1; i++) {
      const len = Math.hypot(e.points[i + 1].x - e.points[i].x, e.points[i + 1].y - e.points[i].y);
      if (len > best) { best = len; bi = i; }
    }
    const mx = Math.round((e.points[bi].x + e.points[bi + 1].x) / 2);
    let my = Math.round((e.points[bi].y + e.points[bi + 1].y) / 2);
    const w = Math.round(measure(e.label, 11, "400")) + 12;
    const relocated = w > best - 8;
    if (relocated) my = Math.max(nodeBottom(e.from), nodeBottom(e.to)) + 17;
    const pill: Pill = { x: mx - Math.round(w / 2), y: my - 9, w, h: 18, mx, label: e.label, dimmed: !edgeMatches(e) };
    // collision resolution: shift down past nodes (when relocated) and earlier pills
    for (let guard = 0; guard < 50; guard++) {
      const hit =
        pills.some((q2) => intersects(q2, pill)) ||
        (relocated && p.nodes.some((n2) => intersects(n2, pill)));
      if (!hit) break;
      pill.y += 22;
    }
    pills.push(pill);
  }
  return pills;
}

function pillMarkup(pill: Pill, t: Theme): string {
  const op = pill.dimmed ? ` opacity="${DIM}"` : "";
  return (
    `<g${op}><rect x="${pill.x}" y="${pill.y}" width="${pill.w}" height="${pill.h}" rx="2" fill="${t.surface}" stroke="${t.border}" stroke-width="1"/>` +
    `<text x="${pill.mx}" y="${pill.y + 13}" text-anchor="middle" font-size="11" fill="${t.muted}">${esc(pill.label)}</text></g>`
  );
}

export function renderSVG(p: Positioned, t: Theme, opts: RenderOpts = {}): string {
  const hl = opts.highlight ?? [];
  const nodeMatches = (n: PNode) => hl.length === 0 || n.tags.some((tag) => hl.includes(tag));
  const byPath = new Map(p.nodes.map((n) => [n.path, n]));
  const edgeMatches = (e: PEdge) =>
    hl.length === 0 || (nodeMatches(byPath.get(e.from)!) && nodeMatches(byPath.get(e.to)!));

  const body: string[] = [];

  // container frames first — recessed surface behind everything (DESIGN §5)
  for (const f of p.frames) {
    body.push(
      `<rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="8" fill="${t.surfaceAlt}" stroke="${t.border}" stroke-width="1"/>`,
    );
    body.push(
      `<text x="${f.x + 14}" y="${f.y + 24}" font-size="13" font-weight="500" fill="${t.muted}">${esc(f.label)}</text>`,
    );
  }

  for (const e of p.edges) {
    const dimmed = !edgeMatches(e);
    const col = e.async ? t.asyncEdge : t.edge;
    const dash = e.async ? ` stroke-dasharray="6 4"` : "";
    const op = dimmed ? ` opacity="${DIM}"` : "";
    body.push(`<g${op}><path d="${edgePath(e.points, p.lines)}" fill="none" stroke="${col}" stroke-width="1.5"${dash}/>`);
    body.push(arrow(e, t));
    body.push(`</g>`);
  }

  for (const n of p.nodes) {
    const dimmed = !nodeMatches(n);
    if (n.kind === "card" || n.kind === "context-card") card(n, t, dimmed, body);
    else leaf(n, t, opts, dimmed, body);
    if (!dimmed && hl.length > 0)
      body.push(
        `<rect x="${n.x - 3}" y="${n.y - 3}" width="${n.w + 6}" height="${n.h + 6}" rx="${R_NODE + 3}" fill="none" stroke="${t.accent}" stroke-width="1.5" opacity="0.8"/>`,
      );
  }

  // labels last, collision-resolved; canvas grows if a pill was pushed below
  const pills = computePills(p, edgeMatches);
  for (const pill of pills) body.push(pillMarkup(pill, t));
  const height = Math.max(p.height, ...pills.map((pl) => pl.y + pl.h + 16));

  if (opts.notes?.length) notes({ ...p, height }, t, opts.notes, body);

  const L: string[] = [];
  L.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${p.width}" height="${height}" viewBox="0 0 ${p.width} ${height}" font-family="Inter, system-ui, sans-serif">`,
  );
  L.push(`<rect width="${p.width}" height="${height}" fill="${t.canvas}"/>`);
  L.push(...body);
  L.push(`</svg>`);
  return L.join("\n") + "\n";
}
