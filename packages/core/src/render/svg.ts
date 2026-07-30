// Positioned + Theme (+ view annotations) → deterministic SVG string.
// DESIGN.md-lite; integers, LF, fixed attribute order — the string is the
// artifact under byte-identity tests. Sketch themes swap crisp strokes for
// seeded rough.js paths and hand-lettered type; light/dark output is
// byte-for-byte what it was before sketch existed.
import { fit, measure, type FontFamily } from "../metrics.js";
import { FONTS } from "../fonts.generated.js";
import { iconMeta, packMonochrome } from "../model/packs.js";
import { iconAsset, symbolId } from "../packs/registry.js";
import { makeSketcher, type Sketcher } from "./sketch.js";
import type { Theme } from "../themes/index.js";
import type { Positioned, PEdge, PNode, PZone } from "../layout/layout.js";
import type { SNote, ZoneColor, ZoneKind } from "../model/types.js";

const PLATE = 40;
const PAD = 12;
const R_NODE = 4;
const R_EDGE = 8;
const DIM = "0.35";

export interface RenderOpts {
  highlight?: string[];
  notes?: SNote[];
  showDescriptions?: boolean;
  /** `legend auto` — a key of the styles this render actually uses. */
  legend?: boolean;
  /** drafting-style corner block (bottom-right), free-form key/values */
  titleblock?: Record<string, string>;
  /** view title — the titleblock headline */
  title?: string;
  /** Embed the subsetted faces via @font-face (default true), so the SVG
   *  renders with the exact font the metrics were measured from even in
   *  sandboxed contexts like GitHub's <img>. Off = smaller output for hosts
   *  that already serve the fonts. */
  embedFonts?: boolean;
  /** Sketch-theme jitter seed — hash(source), threaded in by the API so
   *  roughness is a pure function of the input (never randomness). */
  seed?: number;
  /** Reveal this many hops of a `show flow`, dimming everything the request has
   *  not reached yet and picking out the current one. A viewer concern — the
   *  DSL declares the flow, the presenter walks it — so it lives here and not
   *  in the model. Omitted, the whole flow shows at once, as before.
   *
   *  Counted over the hops **visible in this view**, not the flow's declared
   *  numbering: a flow that starts two systems away has its opening steps
   *  lifted out of a scoped view, and walking declared numbers there would
   *  spend the first presses on frames where nothing happens. `1` is always
   *  the first hop you can actually see. Badges still read their declared
   *  number — that's the flow's real shape. */
  flowStep?: number;
}

/** The accent bar down a live system card carries the brand ramp off the
 *  Squinch mark — magenta through to light blue, top to bottom. Brand, not
 *  theme: the same two stops in light and dark, exactly as the logo behaves,
 *  which also means an adaptive render has nothing to switch here.
 *
 *  In objectBoundingBox units, so every bar runs the full ramp over its own
 *  height rather than sampling a slice of one diagram-wide gradient — a short
 *  card and a tall one should look like the same object. */
const ACCENT_GRAD = "sq-accent";
const accentDefs = () =>
  `<defs><linearGradient id="${ACCENT_GRAD}" x1="0" y1="0" x2="0" y2="1">` +
  `<stop offset="0" stop-color="#C441FE"/><stop offset="1" stop-color="#15B6FF"/>` +
  `</linearGradient></defs>`;

/** Everything the emitters need beyond geometry: theme, type, jitter. */
interface RC {
  t: Theme;
  fam: FontFamily;
  fx: (px: number) => number; // theme-scaled font size (sketch type runs larger)
  sk: Sketcher | null;
}

// Dedicated family names: guarantee the embedded face wins over any
// page-level font, so text width always matches the precomputed metrics.
function fontDefs(t: Theme): string {
  const cssFamily = t.font.css.split(",")[0];
  const face = (w: "400" | "500") =>
    `@font-face{font-family:${cssFamily};font-style:normal;font-weight:${w};` +
    `src:url(data:font/woff2;base64,${FONTS[t.font.metrics][w]}) format("woff2")}`;
  return `<style>${face("400")}${face("500")}</style>`;
}

/** Crisp fill + theme-appropriate stroke: one rect in light/dark, a fill rect
 *  under a seeded rough outline in sketch. `extra` lands on the stroke. */
function box(
  rc: RC,
  x: number, y: number, w: number, h: number, rx: number,
  fill: string, stroke: string, strokeW: number, extra = "",
): string {
  if (!rc.sk)
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeW}"${extra}/>`;
  return (
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="${fill}"/>` +
    `<path d="${rc.sk.rect(x, y, w, h, { roughness: w < 80 ? 0.6 : undefined, multi: w >= 80 })}" fill="none" stroke="${stroke}" stroke-width="${strokeW}" stroke-linecap="round"${extra}/>`
  );
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

/**
 * Crossing hops (DESIGN §4): where two unrelated wires cross, the later edge
 * takes a small gap so a crossing can never read as a junction. Deterministic:
 * declaration order decides who hops, and only perpendicular axis-aligned
 * segments count. Edges that share an endpoint are connected, not crossing.
 */
const HOP = 4; // half-gap in px — an 8px break total
function hopPoints(edges: PEdge[]): Map<string, { x: number; y: number }[]> {
  const hops = new Map<string, { x: number; y: number }[]>();
  const segsOf = (e: PEdge) => {
    const out: { a: { x: number; y: number }; b: { x: number; y: number }; horiz: boolean }[] = [];
    for (let i = 0; i < e.points.length - 1; i++) {
      const a = e.points[i], b = e.points[i + 1];
      if (a.x === b.x && a.y === b.y) continue;
      out.push({ a, b, horiz: Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) });
    }
    return out;
  };
  const between = (v: number, p: number, q: number, pad: number) =>
    v >= Math.min(p, q) + pad && v <= Math.max(p, q) - pad;
  for (let i = 0; i < edges.length; i++)
    for (let j = i + 1; j < edges.length; j++) {
      const A = edges[i], B = edges[j];
      // connected edges meet at a node — that is a junction, not a crossing
      if (A.from === B.from || A.from === B.to || A.to === B.from || A.to === B.to) continue;
      for (const sa of segsOf(A))
        for (const sb of segsOf(B)) {
          if (sa.horiz === sb.horiz) continue;
          const h = sa.horiz ? sa : sb;
          const v = sa.horiz ? sb : sa;
          // the crossing must sit clear of both segments' own bends
          if (!between(v.a.x, h.a.x, h.b.x, HOP + 2)) continue;
          if (!between(h.a.y, v.a.y, v.b.y, HOP + 2)) continue;
          const pt = { x: v.a.x, y: h.a.y };
          (hops.get(B.id) ?? hops.set(B.id, []).get(B.id)!).push(pt);
        }
    }
  return hops;
}

/** Break a polyline into sub-polylines around each hop point. */
function splitAtHops(
  pts: { x: number; y: number }[],
  hops: { x: number; y: number }[],
): { x: number; y: number }[][] {
  const out: { x: number; y: number }[][] = [];
  let cur: { x: number; y: number }[] = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
    const on = hops
      .filter((h) =>
        Math.min(a.x, b.x) - 1 <= h.x && h.x <= Math.max(a.x, b.x) + 1 &&
        Math.min(a.y, b.y) - 1 <= h.y && h.y <= Math.max(a.y, b.y) + 1)
      .map((h) => ({ h, d: Math.hypot(h.x - a.x, h.y - a.y) }))
      .filter((x) => x.d > HOP + 2 && x.d < len - HOP - 2)
      .sort((p, q) => p.d - q.d);
    for (const { h, d } of on) {
      cur.push({ x: Math.round(a.x + ux * (d - HOP)), y: Math.round(a.y + uy * (d - HOP)) });
      out.push(cur);
      cur = [{ x: Math.round(a.x + ux * (d + HOP)), y: Math.round(a.y + uy * (d + HOP)) }];
    }
    cur.push(b);
  }
  out.push(cur);
  return out.filter((seg) => seg.length >= 2);
}

function arrow(e: PEdge, t: Theme, accent = false): string {
  const n = e.points.length;
  const tip = e.points[n - 1], prev = e.points[n - 2];
  const dx = Math.sign(tip.x - prev.x), dy = Math.sign(tip.y - prev.y);
  const bx = tip.x - dx * 8, by = tip.y - dy * 8;
  const p1 = `${bx + dy * 6} ${by + dx * 6}`, p2 = `${bx - dy * 6} ${by - dx * 6}`;
  // the head has to travel with the line, or a highlighted hop ends in a grey point
  const col = accent ? t.accent : e.async ? t.asyncEdge : t.edge;
  return e.async
    ? `<path d="M ${p1} L ${tip.x} ${tip.y} L ${p2}" fill="none" stroke="${col}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<path d="M ${tip.x} ${tip.y} L ${p1} L ${p2} Z" fill="${col}"/>`;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Greedy word-wrap against the metrics table; ≤maxLines, last line ellipsized. */
function wrap(rc: RC, text: string, maxPx: number, sizePx: number, maxLines: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const attempt = cur ? `${cur} ${w}` : w;
    if (measure(attempt, sizePx, "400", rc.fam) <= maxPx) cur = attempt;
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
    lines[lines.length - 1] = fit(`${last}${text.slice(consumed)}`, maxPx, sizePx, "400", rc.fam);
  }
  return lines;
}

function leaf(n: PNode, rc: RC, opts: RenderOpts, dimmed: boolean, L: string[]) {
  const { t } = rc;
  const op = dimmed ? ` opacity="${DIM}"` : "";
  const ctx = n.kind === "context-leaf";
  const stroke = ctx ? ` stroke-dasharray="4 3"` : "";
  L.push(`<g data-path="${esc(n.path)}" data-kind="${n.kind}"${op}>`);
  L.push(box(rc, n.x, n.y, n.w, n.h, R_NODE, t.surface, t.border, 1.5, stroke));
  const px = n.x + PAD, py = n.y + PAD;
  L.push(iconPlate(n.icon, px, py, PLATE, rc, ctx));
  const maxLabel = n.w - PAD - PLATE - PAD - PAD;
  const withDesc = opts.showDescriptions && n.description;
  const labelY = withDesc ? n.y + n.h / 2 - 1 : n.y + n.h / 2 + 5;
  L.push(
    `<text x="${px + PLATE + PAD}" y="${labelY}" font-size="${rc.fx(13)}" font-weight="500" fill="${ctx ? t.muted : t.ink}">${esc(fit(n.label, maxLabel, rc.fx(13), "500", rc.fam))}</text>`,
  );
  if (withDesc)
    L.push(
      `<text x="${px + PLATE + PAD}" y="${n.y + n.h / 2 + 15}" font-size="${rc.fx(11)}" fill="${t.muted}">${esc(fit(n.description!, maxLabel, rc.fx(11), "400", rc.fam))}</text>`,
    );
  L.push(`</g>`);
}

function card(n: PNode, rc: RC, dimmed: boolean, L: string[]) {
  const { t } = rc;
  const ctx = n.kind === "context-card";
  // one opacity, never two: dim wins over the context fade
  const op = dimmed ? ` opacity="${DIM}"` : ctx ? ` opacity="0.75"` : "";
  const stroke = ctx ? ` stroke-dasharray="4 3"` : "";
  L.push(`<g data-path="${esc(n.path)}" data-kind="${n.kind}"${op}>`);
  L.push(box(rc, n.x, n.y, n.w, n.h, 6, t.surface, t.border, 1.5, stroke));
  // accent bar (kind silhouette, DESIGN §3). A live card carries the brand
  // ramp; a context card stays muted, because the bar is what tells the two
  // apart at a glance and colour is the cheapest way to say "this one is the
  // subject".
  L.push(
    `<rect x="${n.x}" y="${n.y}" width="4" height="${n.h}" rx="2" fill="${ctx ? t.muted : `url(#${ACCENT_GRAD})`}"/>`,
  );
  const tx = n.x + PAD + 6;
  L.push(
    `<text x="${tx}" y="${n.y + 34}" font-size="${rc.fx(15)}" font-weight="500" fill="${ctx ? t.muted : t.ink}">${esc(fit(n.label, n.w - 60, rc.fx(15), "500", rc.fam))}</text>`,
  );
  if (n.tagline)
    L.push(
      `<text x="${tx}" y="${n.y + 54}" font-size="${rc.fx(11)}" fill="${t.muted}">${esc(fit(n.tagline, n.w - 40, rc.fx(11), "400", rc.fam))}</text>`,
    );
  if (n.glyph) {
    const asset = iconAsset(n.glyph.pack, n.glyph.id);
    if (asset)
      L.push(
        `<g color="${t.muted}"><use href="#${symbolId(n.glyph.pack, n.glyph.id)}" x="${n.x + n.w - PAD - 18}" y="${n.y + 10}" width="18" height="18"/></g>`,
      );
    else {
      const g = iconMeta(n.glyph.pack, n.glyph.id);
      if (g)
        L.push(
          `<text x="${n.x + n.w - PAD}" y="${n.y + 22}" text-anchor="end" font-size="${rc.fx(10)}" font-weight="500" fill="${t.muted}">${esc(g.code)}</text>`,
        );
    }
  }
  // preview strip: up to 3 inner icons, bottom-right, 16px at 60%
  n.preview.forEach((icon, i) => {
    const ix = n.x + n.w - PAD - 16 - i * 20;
    const iy = n.y + n.h - PAD - 16;
    L.push(iconPlate(icon, ix, iy, 16, rc, true));
  });
  L.push(`</g>`);
}

function notes(p: Positioned, rc: RC, list: SNote[], L: string[]) {
  const { t } = rc;
  const byPath = new Map(p.nodes.map((n) => [n.path, n]));
  for (const note of list) {
    const inner = 176;
    const lines = wrap(rc, note.text, inner, rc.fx(11), 3);
    const w = Math.min(200, Math.max(...lines.map((l) => measure(l, rc.fx(11), "400", rc.fam))) + 24);
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
    L.push(box(rc, x, y, w, h, 3, bg, t.border, 1));
    lines.forEach((line, i) =>
      L.push(
        `<text x="${x + 12}" y="${y + 17 + i * 15}" font-size="${rc.fx(11)}" fill="${t.ink}">${esc(line)}</text>`,
      ),
    );
  }
}

// zone-kind → tint token (DESIGN §5: kind-tinted, low opacity)
const ZONE_TINT: Record<ZoneKind, (t: Theme) => string> = {
  account: (th) => th.zoneAccount,
  region: (th) => th.zoneNeutral,
  vpc: (th) => th.zoneNetwork,
  subnet: (th) => th.zoneNetwork,
  network: (th) => th.zoneNetwork,
  cloud: (th) => th.zoneCloud,
  onprem: (th) => th.zoneNeutral,
  custom: (th) => th.zoneNeutral,
};

// explicit `color:` roles a zone may choose instead of its kind default —
// still theme tokens, never hex in the DSL
const ZONE_COLOR_ROLE: Record<ZoneColor, (t: Theme) => string> = {
  account: (th) => th.zoneAccount,
  network: (th) => th.zoneNetwork,
  cloud: (th) => th.zoneCloud,
  neutral: (th) => th.zoneNeutral,
  ink: (th) => th.ink,
  muted: (th) => th.muted,
  accent: (th) => th.accent,
};

const zoneColor = (z: { kind: ZoneKind; color?: ZoneColor }, t: Theme) =>
  z.color ? ZONE_COLOR_ROLE[z.color](t) : ZONE_TINT[z.kind](t);

/** Legend of what's actually in the picture — never a fixed key (DESIGN:
 *  quiet structure; only earned entries). Returns markup + band height. */
function legend(p: Positioned, rc: RC, y: number, L: string[]): { h: number; w: number } {
  const { t } = rc;
  const items: { sample: (x: number, cy: number) => string; label: string }[] = [];
  if (p.edges.some((e) => !e.async))
    items.push({
      sample: (x, cy) => `<line x1="${x}" y1="${cy}" x2="${x + 24}" y2="${cy}" stroke="${t.edge}" stroke-width="1.5"/>`,
      label: "sync",
    });
  if (p.edges.some((e) => e.async))
    items.push({
      sample: (x, cy) => `<line x1="${x}" y1="${cy}" x2="${x + 24}" y2="${cy}" stroke="${t.asyncEdge}" stroke-width="1.5" stroke-dasharray="6 4"/>`,
      label: "async",
    });
  if (p.edges.some((e) => e.count > 1))
    items.push({
      sample: (x, cy) =>
        `<line x1="${x}" y1="${cy}" x2="${x + 24}" y2="${cy}" stroke="${t.edge}" stroke-width="1.5"/>` +
        `<text x="${x + 12}" y="${cy - 4}" text-anchor="middle" font-size="${rc.fx(9)}" fill="${t.muted}">×n</text>`,
      label: "aggregated",
    });
  if (p.nodes.some((n) => n.kind.startsWith("context")))
    items.push({
      sample: (x, cy) => `<rect x="${x + 2}" y="${cy - 7}" width="20" height="14" rx="2" fill="${t.surface}" stroke="${t.border}" stroke-width="1.5" stroke-dasharray="4 3"/>`,
      label: "context",
    });
  if (p.flow && Object.keys(p.flow.byEdge).length)
    items.push({
      sample: (x, cy) =>
        `<circle cx="${x + 12}" cy="${cy}" r="8" fill="${t.accent}"/>` +
        `<text x="${x + 12}" y="${cy + 3}" text-anchor="middle" font-size="${rc.fx(9)}" font-weight="500" fill="${t.plateText}">1</text>`,
      label: `flow: ${p.flow.label}`,
    });
  // zone kinds present in this render, in kind-list order, deduped
  const kindsPresent = [...new Set((p.zones ?? []).map((z) => z.kind))];
  for (const kind of kindsPresent) {
    const col = ZONE_TINT[kind](t);
    items.push({
      sample: (x, cy) =>
        `<rect x="${x + 2}" y="${cy - 7}" width="20" height="14" rx="2" fill="${col}" fill-opacity="0.04" stroke="${col}" stroke-width="1" stroke-dasharray="4 3"/>`,
      label: kind,
    });
  }
  if (!items.length) return { h: 0, w: 0 };
  const cy = y + 12;
  let x = 16;
  for (const it of items) {
    L.push(it.sample(x, cy));
    x += 24 + 8;
    L.push(`<text x="${x}" y="${cy + 4}" font-size="${rc.fx(11)}" fill="${t.muted}">${esc(it.label)}</text>`);
    x += Math.round(measure(it.label, rc.fx(11), "400", rc.fam)) + 24;
  }
  return { h: 24, w: x - 24 };
}

function titleblockDims(rc: RC, title: string | undefined, kv: Record<string, string>, canvasW: number) {
  const rows = Object.entries(kv);
  const keyW = Math.max(0, ...rows.map(([k]) => measure(k, rc.fx(11), "400", rc.fam)));
  const wNeed = Math.max(
    title ? measure(title, rc.fx(13), "500", rc.fam) : 0,
    ...rows.map(([, v]) => keyW + 12 + measure(v, rc.fx(11), "400", rc.fam)),
  );
  return {
    rows, keyW,
    w: Math.min(280, canvasW - 32, Math.round(wNeed) + 24), // never wider than the canvas
    h: (title ? 24 : 8) + rows.length * 16 + 8,
  };
}

/** Drafting-style corner block, bottom-right: title row + key/value rows. */
function titleblock(
  p: Positioned, rc: RC, y: number, dims: ReturnType<typeof titleblockDims>,
  title: string | undefined, L: string[],
): void {
  const { t } = rc;
  const { rows, keyW, w, h } = dims;
  const x = p.width - w - 16;
  L.push(box(rc, x, y, w, h, 3, t.surface, t.border, 1));
  let ty = y + 18;
  if (title) {
    L.push(`<text x="${x + 12}" y="${ty}" font-size="${rc.fx(13)}" font-weight="500" fill="${t.ink}">${esc(fit(title, w - 24, rc.fx(13), "500", rc.fam))}</text>`);
    ty += 20;
  } else ty -= 2;
  for (const [k, v] of rows) {
    L.push(`<text x="${x + 12}" y="${ty}" font-size="${rc.fx(11)}" fill="${t.muted}">${esc(k)}</text>`);
    L.push(`<text x="${x + 12 + Math.round(keyW) + 12}" y="${ty}" font-size="${rc.fx(11)}" fill="${t.ink}">${esc(fit(v, w - 24 - keyW - 12, rc.fx(11), "400", rc.fam))}</text>`);
    ty += 16;
  }
}

interface Pill {
  x: number; y: number; w: number; h: number;
  mx: number; label: string; dimmed: boolean;
  edgeId?: string;
}

const intersects = (a: Pill | { x: number; y: number; w: number; h: number }, b: Pill, m = 4) =>
  a.x < b.x + b.w + m && a.x + a.w + m > b.x && a.y < b.y + b.h + m && a.y + a.h + m > b.y;

/**
 * Compute all edge-label pills, then resolve collisions deterministically:
 * a pill overlapping a node or an earlier pill shifts down until clear
 * (DESIGN: a label never sits on another label — enforced, not hoped).
 */
function computePills(p: Positioned, rc: RC, edgeMatches: (e: PEdge) => boolean): Pill[] {
  const byPath = new Map(p.nodes.map((n) => [n.path, n]));
  const nodeBottom = (path: string) => {
    const n = byPath.get(path)!;
    return n.y + n.h;
  };
  // Fixed obstacles a pill must never sit on: nodes, zone borders (thin bands
  // — the interior tint is fine to cross), frame borders and frame titles.
  // Sitting ON its own edge line is the point of a pill; other edges are
  // handled by the pill's opaque background.
  const band = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });
  const fixed = [
    ...p.nodes,
    ...(p.zones ?? []).flatMap((z) => [
      band(z.x - 2, z.y - 2, z.w + 4, 4),
      band(z.x - 2, z.y + z.h - 2, z.w + 4, 4),
      band(z.x - 2, z.y - 2, 4, z.h + 4),
      band(z.x + z.w - 2, z.y - 2, 4, z.h + 4),
    ]),
    ...p.frames.flatMap((f) => [
      band(f.x - 1, f.y - 1, f.w + 2, 2),
      band(f.x - 1, f.y + f.h - 1, f.w + 2, 2),
      band(f.x - 1, f.y - 1, 2, f.h + 2),
      band(f.x + f.w - 1, f.y - 1, 2, f.h + 2),
      band(f.x + 8, f.y + 6, Math.round(measure(f.label, rc.fx(13), "500", rc.fam)) + 12, 24),
    ]),
  ];
  const pills: Pill[] = [];
  for (const e of p.edges) {
    if (!e.label) continue;
    // Every segment is a candidate host, longest first. Trying only the
    // longest was tunnel vision: a dogleg whose best run threads a crowded
    // gutter would detach even with three clear runs of its own
    // (docs/notes/edge-labels.md).
    const segs = e.points.slice(0, -1).map((a, i) => {
      const b = e.points[i + 1];
      return { a, b, len: Math.hypot(b.x - a.x, b.y - a.y) };
    }).sort((s1, s2) => s2.len - s1.len);
    const best = segs[0]?.len ?? 0;
    // labels truncate like node labels do, and a pill never leaves the canvas
    const maxW = Math.max(60, Math.min(240, p.width - 16));
    const label = fit(e.label, maxW - 12, rc.fx(11), "400", rc.fam);
    const w = Math.round(measure(label, rc.fx(11), "400", rc.fam)) + 12;
    // a modest overhang past the segment's bends is fine (opaque pill bg);
    // flee below only when the label truly dwarfs its longest segment
    const relocated = w > best + 24;

    const rectOn = (seg: { a: { x: number; y: number }; b: { x: number; y: number } }, fr: number): Pill => {
      let mx = Math.round(seg.a.x + (seg.b.x - seg.a.x) * fr);
      const my = Math.round(seg.a.y + (seg.b.y - seg.a.y) * fr);
      let x = mx - Math.round(w / 2);
      if (x < 8) x = 8;
      if (x + w > p.width - 8) x = p.width - 8 - w;
      mx = x + Math.round(w / 2);
      return { x, y: my - 9, w, h: 18, mx, label, dimmed: !edgeMatches(e), edgeId: e.id };
    };
    const rectAt = (fr: number) => rectOn(segs[0], fr);
    const clear = (r: Pill) =>
      !fixed.some((o) => intersects(o, r)) && !pills.some((q2) => intersects(q2, r));

    let pill: Pill | undefined;
    if (!relocated) {
      // stay ON the edge: for each segment (longest first) slide from its
      // midpoint outward; move to the next segment before ever detaching
      for (const seg of segs) {
        if (w > seg.len + 24) continue; // too short to host this label
        for (const fr of [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.18, 0.82]) {
          const cand = rectOn(seg, fr);
          if (clear(cand)) { pill = cand; break; }
        }
        if (pill) break;
      }
    }
    if (!pill) {
      // fallback: below the edge's nodes, shifting down past everything
      pill = rectAt(0.5);
      if (relocated) pill.y = Math.max(nodeBottom(e.from), nodeBottom(e.to)) + 17 - 9;
      for (let guard = 0; guard < 50; guard++) {
        const hit = pills.some((q2) => intersects(q2, pill!)) ||
          p.nodes.some((n2) => intersects(n2, pill!));
        if (!hit) break;
        pill.y += 22;
      }
    }
    pills.push(pill);
  }
  return pills;
}

interface ZoneChip {
  x: number; y: number; w: number; h: number;
  label: string; col: string; zone: string;
  icon?: { pack: string; id: string };
}

/**
 * Zone label chips straddle their zone's top border. ELK doesn't treat labels
 * as routing obstacles (spiked: outside compound labels get routed straight
 * through), so this is ours, same philosophy as computePills: slide the chip
 * right along the border in grid steps to the first spot clear of edges,
 * nodes and pills — falling back to the least-crossed spot. The canvas halo
 * (drawn in chipMarkup) keeps even the fallback legible.
 */
function placeZoneChips(p: Positioned, rc: RC, t: Theme, pills: Pill[]): ZoneChip[] {
  const chips: ZoneChip[] = [];
  // axis-aligned segment bboxes; the corner rounding deviates ≤8px → margin
  const segs = p.edges.flatMap((e) => {
    const out: { x: number; y: number; w: number; h: number }[] = [];
    for (let i = 0; i < e.points.length - 1; i++) {
      const a = e.points[i], b = e.points[i + 1];
      out.push({
        x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
        w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y),
      });
    }
    return out;
  });
  const obstacles = () => [...segs, ...p.nodes, ...pills, ...chips];
  for (const z of [...(p.zones ?? [])].sort((a, b) => a.depth - b.depth)) {
    const col = zoneColor(z, t);
    const iconW = z.icon ? 26 : 0; // 20px flush tab + 6px gap (AWS corner-tab look)
    const label = fit(z.label, z.w - 48 - iconW, rc.fx(11), "500", rc.fam);
    const w = Math.round(measure(label, rc.fx(11), "500", rc.fam)) + 16 + iconW;
    // which border the chip straddles, and which way it slides to escape:
    // left corners slide right, right corners slide left — always along the
    // border the author chose.
    const y = z.labelPos.startsWith("top") ? z.y - 10 : z.y + z.h - 10;
    const xLo = z.x + 12;
    const xHi = Math.max(xLo, z.x + z.w - 12 - w);
    const fromRight = z.labelPos.endsWith("right");
    let best = { x: fromRight ? xHi : xLo, hits: Infinity };
    for (let step = 0; ; step++) {
      const x = fromRight ? xHi - step * 16 : xLo + step * 16;
      if (x < xLo || x > xHi) break;
      const rect = { x, y, w, h: 20 };
      const hits = obstacles().filter((o) =>
        o.x < rect.x + rect.w + 6 && o.x + o.w + 6 > rect.x &&
        o.y < rect.y + rect.h + 6 && o.y + o.h + 6 > rect.y,
      ).length;
      if (hits < best.hits) best = { x, hits };
      if (hits === 0) break;
    }
    chips.push({ x: best.x, y, w, h: 20, label, col, zone: z.id, icon: z.icon });
  }
  return chips;
}

function chipMarkup(c: ZoneChip, rc: RC, t: Theme): string {
  // halo first: a canvas knockout 3px proud of the chip, so any edge the chip
  // must sit over reads as deliberately interrupted, never collided-with
  const halo = `<rect x="${c.x - 3}" y="${c.y - 3}" width="${c.w + 6}" height="${c.h + 6}" rx="4" fill="${t.canvas}"/>`;
  const chip = rc.sk
    ? `<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" rx="2" fill="${t.canvas}"/>` +
      `<path d="${rc.sk.rect(c.x, c.y, c.w, c.h, { roughness: 0.6, multi: false })}" fill="none" stroke="${c.col}" stroke-width="1"/>`
    : `<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" rx="3" fill="${t.canvas}" stroke="${c.col}" stroke-width="1"/>`;
  // the icon is a flush, full-height tab on the chip's left edge — the AWS
  // boundary-label convention — never a padded thumbnail floating in the pill
  const icon = c.icon ? iconPlate(c.icon, c.x, c.y, c.h, rc) : "";
  const tx = c.x + 8 + (c.icon ? c.h + 4 : 0);
  return (
    `<g data-kind="zone-chip" data-zone="${esc(c.zone)}">${halo}${chip}${icon}` +
    `<text x="${tx}" y="${c.y + 14}" font-size="${rc.fx(11)}" font-weight="500" fill="${c.col}">${esc(c.label)}</text></g>`
  );
}

function pillMarkup(pill: Pill, rc: RC): string {
  const { t } = rc;
  const op = pill.dimmed ? ` opacity="${DIM}"` : "";
  return (
    `<g${op}>` + box(rc, pill.x, pill.y, pill.w, pill.h, 2, t.surface, t.border, 1) +
    `<text x="${pill.mx}" y="${pill.y + 13}" text-anchor="middle" font-size="${rc.fx(11)}" fill="${t.muted}">${esc(pill.label)}</text></g>`
  );
}

/** One <symbol> per distinct icon used in this render, in stable order. */
function iconDefs(p: Positioned): string {
  const used = new Map<string, { pack: string; id: string }>();
  const note = (icon?: { pack: string; id: string }) => {
    if (icon) used.set(`${icon.pack}/${icon.id}`, icon);
  };
  for (const n of p.nodes) {
    note(n.icon);
    note(n.glyph);
    for (const prev of n.preview) note(prev);
  }
  for (const z of p.zones ?? []) note(z.icon);
  const symbols: string[] = [];
  for (const key of [...used.keys()].sort()) {
    const { pack, id } = used.get(key)!;
    const asset = iconAsset(pack, id);
    if (!asset) continue;
    // artwork inlined verbatim inside the symbol; placement is ours, the asset is untouched
    symbols.push(
      `<symbol id="${symbolId(pack, id)}" viewBox="${asset.viewBox}">${asset.body}</symbol>`,
    );
  }
  return symbols.length ? `<defs>\n${symbols.join("\n")}\n</defs>` : "";
}

/** Icon artwork clipped to our plate radius, or a lettered fallback plate.
 *  Always crisp — the AWS art is verbatim; sketch roughness stops at its edge. */
function iconPlate(
  icon: { pack: string; id: string } | undefined,
  x: number, y: number, size: number, rc: RC, soften = false,
): string {
  const { t } = rc;
  const meta = icon ? iconMeta(icon.pack, icon.id) : undefined;
  const asset = icon ? iconAsset(icon.pack, icon.id) : undefined;
  const r = Math.max(2, Math.round(size / 10));
  if (asset && icon && (icon.pack === "builtin" || packMonochrome(icon.pack))) {
    // single-colour marks — our own glyphs and logo packs alike: a coloured
    // plate with the mark knocked out of it, so a wordless logo still reads
    const pad = Math.round(size * 0.2);
    return (
      `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${r}" fill="${meta?.color ?? t.muted}"${soften ? ` opacity="0.6"` : ""}/>` +
      // `fill` as well as `color`: our own glyphs paint with currentColor, but
      // vendored marks (Simple Icons) carry no fill at all and would default to
      // black — invisible on a dark brand plate. fill is inherited, and any
      // glyph that sets its own fill still wins.
      `<g color="${t.plateText}" fill="${t.plateText}"${soften ? ` opacity="0.9"` : ""}>` +
      `<use href="#${symbolId(icon.pack, icon.id)}" x="${x + pad}" y="${y + pad}" width="${size - pad * 2}" height="${size - pad * 2}"/>` +
      `</g>`
    );
  }
  if (asset && icon) {
    // clip-path directly on <use> stops it instantiating in some renderers —
    // wrap instead, so the artwork still gets our rounded plate corners.
    const clip = `clip-${symbolId(icon.pack, icon.id)}-${x}-${y}-${size}`;
    return (
      `<clipPath id="${clip}"><rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${r}"/></clipPath>` +
      `<g clip-path="url(#${clip})"${soften ? ` opacity="0.6"` : ""}>` +
      `<use href="#${symbolId(icon.pack, icon.id)}" x="${x}" y="${y}" width="${size}" height="${size}"/>` +
      `</g>`
    );
  }
  const code = meta?.code ?? "?";
  return (
    `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${r}" fill="${meta?.color ?? t.muted}"${soften ? ` opacity="0.6"` : ""}/>` +
    (size >= 24
      ? `<text x="${x + size / 2}" y="${y + size / 2 + 4}" text-anchor="middle" font-size="${rc.fx(11)}" font-weight="500" fill="${t.plateText}">${esc(code)}</text>`
      : "")
  );
}

export function renderSVG(p: Positioned, t: Theme, opts: RenderOpts = {}): string {
  const rc: RC = {
    t,
    fam: t.font.metrics,
    fx: (px) => Math.round(px * t.font.scale),
    sk: t.sketch ? makeSketcher(opts.seed ?? 1, t.sketch.roughness, t.sketch.bowing) : null,
  };
  const hl = opts.highlight ?? [];
  const byPath = new Map(p.nodes.map((n) => [n.path, n]));

  // Walking a flow (`flowStep`) dims by *progress* rather than by tag: an edge
  // is reached once one of its step numbers is due, and a node once an edge
  // touching it is. Both dimming rules compose — a highlighted view that also
  // steps a flow dims anything failing either test.
  const stepsOf = (e: PEdge): number[] => p.flow?.byEdge[e.id] ?? [];
  const walking = opts.flowStep !== undefined && !!p.flow;
  // the declared step numbers that render here, in order — the ordinal indexes
  // into this, so hop 1 is the first one on screen whatever it is called
  const visible = p.flow
    ? [...new Set(Object.values(p.flow.byEdge).flat())].sort((a, b) => a - b)
    : [];
  const step = walking
    ? visible[Math.min(Math.max(opts.flowStep!, 0), visible.length) - 1]
    : undefined;
  const edgeReached = (e: PEdge) =>
    !walking || (step !== undefined && stepsOf(e).some((s) => s <= step));
  const reachedNodes = new Set<string>();
  if (walking)
    for (const e of p.edges) if (edgeReached(e)) reachedNodes.add(e.from), reachedNodes.add(e.to);

  const nodeMatches = (n: PNode) =>
    (hl.length === 0 || n.tags.some((tag) => hl.includes(tag))) &&
    (!walking || reachedNodes.has(n.path));
  const edgeMatches = (e: PEdge) =>
    (hl.length === 0 || (nodeMatches(byPath.get(e.from)!) && nodeMatches(byPath.get(e.to)!))) &&
    edgeReached(e);

  const body: string[] = [];

  // zone boundaries first — the classic dashed deployment frame, behind
  // everything, outermost first (DESIGN §5). Kind picks the tint. The label
  // chips render LAST (top layer, after edges) so their canvas halo knocks
  // out anything they must sit over — see placeZoneChips below.
  const zoneMarkup = (z: PZone): string => {
    const col = zoneColor(z, t);
    const dash = ` stroke-dasharray="8 5"`;
    const boundary = rc.sk
      ? `<rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" rx="2" fill="${col}" fill-opacity="0.04"/>` +
        `<path d="${rc.sk.rect(z.x, z.y, z.w, z.h, { multi: false })}" fill="none" stroke="${col}" stroke-width="1.5"${dash} stroke-linecap="round"/>`
      : `<rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" rx="8" fill="${col}" fill-opacity="0.04" stroke="${col}" stroke-width="1.5"${dash}/>`;
    return `<g data-kind="zone" data-zone="${esc(z.id)}" data-zone-kind="${z.kind}">${boundary}</g>`;
  };
  for (const z of [...(p.zones ?? [])].sort((a, b) => a.depth - b.depth)) body.push(zoneMarkup(z));

  // container frames first — recessed surface behind everything (DESIGN §5)
  for (const f of p.frames) {
    if (rc.sk) {
      body.push(`<g data-path="${esc(f.path)}" data-kind="frame">` +
        box(rc, f.x, f.y, f.w, f.h, 8, t.surfaceAlt, t.border, 1) + `</g>`);
    } else {
      body.push(
        `<rect data-path="${esc(f.path)}" data-kind="frame" x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="8" fill="${t.surfaceAlt}" stroke="${t.border}" stroke-width="1"/>`,
      );
    }
    body.push(
      `<text x="${f.x + 14}" y="${f.y + 24}" font-size="${rc.fx(13)}" font-weight="500" fill="${t.muted}">${esc(f.label)}</text>`,
    );
  }

  const hops = hopPoints(p.edges);
  for (const e of p.edges) {
    const dimmed = !edgeMatches(e);
    // the hop being narrated right now: accent-coloured and heavier, so the
    // eye lands on it without having to hunt for the badge
    const current = step !== undefined && stepsOf(e).includes(step);
    const col = current ? t.accent : e.async ? t.asyncEdge : t.edge;
    const weight = current ? 2.5 : 1.5;
    const dash = e.async ? ` stroke-dasharray="6 4"` : "";
    // async flow animation: dashes drift source→target at constant px/s (one
    // shared keyframe, so long edges never "flow faster"); CSS only, and
    // prefers-reduced-motion turns it off entirely
    const anim = e.async && e.animate ? ` class="sq-flow"` : "";
    const op = dimmed ? ` opacity="${DIM}"` : "";
    const myHops = hops.get(e.id);
    const runs = myHops?.length ? splitAtHops(e.points, myHops) : [e.points];
    body.push(`<g${op}>`);
    for (const run of runs) {
      const d = edgePath(run, p.lines);
      body.push(
        `<path${anim} d="${rc.sk ? rc.sk.path(d) : d}" fill="none" stroke="${col}" stroke-width="${weight}"${dash}${rc.sk ? ` stroke-linecap="round"` : ""}/>`,
      );
    }
    body.push(arrow(e, t, current));
    body.push(`</g>`);
  }

  for (const n of p.nodes) {
    const dimmed = !nodeMatches(n);
    if (n.kind === "card" || n.kind === "context-card") card(n, rc, dimmed, body);
    else leaf(n, rc, opts, dimmed, body);
    if (!dimmed && hl.length > 0)
      body.push(
        `<rect x="${n.x - 3}" y="${n.y - 3}" width="${n.w + 6}" height="${n.h + 6}" rx="${R_NODE + 3}" fill="none" stroke="${t.accent}" stroke-width="1.5" opacity="0.8"/>`,
      );
  }

  // labels last, collision-resolved; canvas grows if a pill was pushed below
  const pills = computePills(p, rc, edgeMatches);
  for (const pill of pills) body.push(pillMarkup(pill, rc));
  // zone label chips last: slid clear of edges where possible, haloed always
  for (const chip of placeZoneChips(p, rc, t, pills)) body.push(chipMarkup(chip, rc, t));
  // flow step badges: numbered circles just after each edge leaves its
  // source, sliding further along the wire past pills, nodes and each other
  if (p.flow) {
    const placedBadges: { x: number; y: number; w: number; h: number }[] = [];
    const pointFromStart = (pts: { x: number; y: number }[], dist: number) => {
      let remaining = dist;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b2 = pts[i + 1];
        const seg = Math.hypot(b2.x - a.x, b2.y - a.y);
        if (seg >= remaining)
          return {
            x: Math.round(a.x + ((b2.x - a.x) / seg) * remaining),
            y: Math.round(a.y + ((b2.y - a.y) / seg) * remaining),
          };
        remaining -= seg;
      }
      return pts[pts.length - 1];
    };
    for (const e of p.edges) {
      // while walking, a badge only appears once its step is due — an edge
      // carrying steps 2 and 5 reads "2" until the story reaches 5
      const nums = (p.flow.byEdge[e.id] ?? []).filter(
        (s) => !walking || (step !== undefined && s <= step),
      );
      if (!nums.length) continue;
      const total = e.points.reduce(
        (acc, pt, i) => (i ? acc + Math.hypot(pt.x - e.points[i - 1].x, pt.y - e.points[i - 1].y) : 0),
        0,
      );
      const text = nums.join("·");
      const rWide = Math.max(9, Math.round(measure(text, rc.fx(10), "500", rc.fam) / 2) + 5);
      let cx = 0, cy = 0;
      const docked = pills.find((q2) => q2.edgeId === e.id);
      if (docked) {
        // the edge has a label: the badge docks to the pill's left —
        // "③ record" reads as one unit, and can't collide by construction
        cx = docked.x - rWide - 4;
        cy = docked.y + 9;
      } else {
        for (const d of [18, 36, 54, 78, 102, 134]) {
          const pt = pointFromStart(e.points, Math.min(d, total / 2));
          cx = pt.x; cy = pt.y;
          const rect = { x: cx - rWide, y: cy - 9, w: rWide * 2, h: 18 };
          const hit =
            pills.some((q2) => intersects(q2, rect as any)) ||
            placedBadges.some((q2) => intersects(q2 as any, rect as any)) ||
            p.nodes.some((n2) => intersects(n2, rect as any));
          if (!hit || d >= total / 2) break;
        }
      }
      placedBadges.push({ x: cx - rWide, y: cy - 9, w: rWide * 2, h: 18 });
      // steps already narrated recede; only the current one stays at full weight
      const done = walking && step !== undefined && !nums.includes(step);
      const halo = walking && !done
        ? `<rect x="${cx - rWide - 3}" y="${cy - 12}" width="${rWide * 2 + 6}" height="24" rx="12" fill="none" stroke="${t.accent}" stroke-width="1.5" opacity="0.45"/>`
        : "";
      body.push(
        `<g data-kind="flow-step"${done ? ` opacity="0.55"` : ""}>` +
          halo +
          (rWide > 9
            ? `<rect x="${cx - rWide}" y="${cy - 9}" width="${rWide * 2}" height="18" rx="9" fill="${t.accent}"/>`
            : `<circle cx="${cx}" cy="${cy}" r="9" fill="${t.accent}"/>`) +
          `<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="${rc.fx(10)}" font-weight="500" fill="${t.plateText}">${esc(text)}</text></g>`,
      );
    }
  }
  let height = Math.max(p.height, ...pills.map((pl) => pl.y + pl.h + 16));

  if (opts.notes?.length) notes({ ...p, height }, rc, opts.notes, body);

  // footer band: legend bottom-left, titleblock bottom-right; the titleblock
  // drops below the legend when the canvas is too narrow for both
  if (opts.legend || (opts.titleblock && Object.keys(opts.titleblock).length)) {
    const bandY = height - 8;
    const lg = opts.legend ? legend(p, rc, bandY, body) : { h: 0, w: 0 };
    let bottom = bandY + lg.h;
    if (opts.titleblock && Object.keys(opts.titleblock).length) {
      const tb = titleblockDims(rc, opts.title, opts.titleblock, p.width);
      const beside = lg.w === 0 || 16 + lg.w + 24 + tb.w + 16 <= p.width;
      const ty = beside ? bandY : bottom + 8;
      titleblock(p, rc, ty, tb, opts.title, body);
      bottom = Math.max(bottom, ty + tb.h);
    }
    if (bottom > bandY) height = bottom + 16;
  }

  const L: string[] = [];
  L.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${p.width}" height="${height}" viewBox="0 0 ${p.width} ${height}" font-family="${t.font.css}">`,
  );
  if (opts.embedFonts !== false) L.push(fontDefs(t));
  if (p.edges.some((e) => e.async && e.animate))
    L.push(
      // dasharray period is 10px (6+4); -10 per 0.9s ≈ 11px/s, everywhere
      `<style>@media (prefers-reduced-motion: no-preference){` +
        `.sq-flow{animation:sq-flow 0.9s linear infinite}` +
        `@keyframes sq-flow{to{stroke-dashoffset:-10}}}</style>`,
    );
  L.push(`<rect width="${p.width}" height="${height}" fill="${t.canvas}"/>`);
  // only when something references it — a diagram of plain nodes should not
  // carry a gradient it never draws
  if (p.nodes.some((n) => n.kind === "card")) L.push(accentDefs());
  const defs = iconDefs(p);
  if (defs) L.push(defs);
  L.push(...body);
  L.push(`</svg>`);
  return L.join("\n") + "\n";
}
