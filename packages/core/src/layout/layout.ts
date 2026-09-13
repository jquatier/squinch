// ViewGraph → positioned diagram. Spike-proven architecture (docs/ENGINEERING.md):
//   - declared ranks (rows/place) are ours, enforced via invisible scaffold edges
//   - same-rank ("coplanar") edges bypass ELK → our deterministic coplanar router
//   - one port per edge endpoint with FIXED_SIDE → ELK spreads ports + stubs
// ELK owns between-rank; we own within-rank. Keep that boundary crisp.
import ELKModule from "elkjs/lib/elk.bundled.js";

// elkjs ships a CJS class with no construct signature in its types
const ELK = ELKModule as unknown as { new (): { layout(graph: unknown): Promise<any> } };
import { fit, measure, wrapText, type FontFamily } from "../metrics.js";
import { resolveView } from "../view/resolve.js";
import type { VNode, VEdge } from "../view/resolve.js";
import type { SModel, SView, Side, Diagnostic, Hue, RelPos, ZoneKind, ZoneLabelPos } from "../model/types.js";
import type { ThemeFont } from "../themes/index.js";

const LEAF_TIERS = [120, 160, 200, 240];
const CARD_TIERS = [200, 240, 280, 320];
const LEAF_H = 64;
/** 88 → 96: the card grew a 30px shelf along its bottom, and 66 of body is
 *  what the title/tagline pair needs above it (docs/design). */
const CARD_H = 96;
/** Actor tiles: a name and a caption, no plate row under them. */
const PERSON_H = 56;
/** The bordered chip holding a card's kind glyph, top-right. */
const GLYPH_CHIP = 26;
/** The shelf strip along a card's bottom: child icons, `+N`, domain chip. */
export const SHELF_H = 30;
/** How far the stacked sheets bleed past a container, right and below. Not
 *  added to the node's size on purpose — see the comment at `canvasExtent`. */
export const SHEET_BLEED = 8;
const PLATE = 40;
const PAD = 12;
/** The label gap, B. In a view that carries ELK labels the between-layers
 *  spacing drops to B and every edge gets a label, so a gap measures
 *  `B + B + labelHeight + B + B` — B once as layer spacing and once as
 *  `elk.spacing.edgeLabel`, on each side of the label. That 4×B is why
 *  `spacerH` subtracts it back out to keep unlabelled gaps at the density
 *  spacing. One knob: change this and both option value and spacer follow.
 *  Went 16 → 12 → 8 across three gate reviews, then to 10. */
const LABEL_GAP = 10;
/** Zone chip height (docs/design). Shared: the placer reserves it, the
 *  renderer fills it, and the chip straddles its border by half of it. */
export const CHIP_H = 22;
/** Room a note reserves for its leading glyph, gutter included. Shared: layout
 *  wraps text to what is left, the renderer draws the mark in it. */
export const NOTE_GUTTER = 19;
/** A note's widest box, and the text column inside it. The column is what the
 *  wrap runs against; the box is the column plus padding plus the gutter, so
 *  the two can never disagree about whether the text fits. */
const NOTE_MAX_W = 200;
const NOTE_TEXT_W = NOTE_MAX_W - 24 - NOTE_GUTTER;
/** The pill a label will render as, measured with the layout's font — the
 *  single source of truth shared by the ELK reservation (here) and the
 *  renderer's pill text (svg.ts). If these two ever diverge, the reservation
 *  is for a different pill than the one drawn. Cap 240 mirrors computePills'
 *  maxW; the canvas-width term is unknowable before layout and only ever
 *  shrinks tiny diagrams, where a slightly generous reservation is harmless. */
export function pillDims(text: string, font: Pick<ThemeFont, "metrics" | "scale">): { label: string; w: number; h: number } {
  const fx11 = Math.round(11 * font.scale);
  const label = fit(text, 240 - 12, fx11, "400", font.metrics);
  return { label, w: Math.round(measure(label, fx11, "400", font.metrics)) + 12, h: 18 };
}

/** The box a note will render as, and the lines inside it — the single source
 *  of truth shared by every path that places one (edge notes, layer notes, the
 *  candidate-ladder resolver) and by the renderer that draws it.
 *
 *  It is one function because it was briefly two. The resolver kept its own
 *  copy of this arithmetic, so when notes gained a leading glyph only the
 *  other copy learned about the gutter: corner and `right-of` notes reserved a
 *  box 19px narrower than the text drawn into it, and the text ran out through
 *  the side. Exactly the failure `pillDims` exists to prevent, in the one
 *  place that had not been given the same treatment.
 *
 *  The column narrows by the gutter and the box widens by it, so the text
 *  keeps its 12px right margin whatever the glyph does. */
export function noteBox(text: string, font: Pick<ThemeFont, "metrics" | "scale">) {
  const fx11 = Math.round(11 * font.scale);
  const lines = wrapText(text, NOTE_TEXT_W, fx11, font.metrics, 3);
  // ceil the *text*, then add the padding — rounding the total instead let a
  // 32.4px word round its box down and quietly spend a pixel of the right
  // margin. Integers either way (DESIGN §8); this way the margin is the 12 it
  // claims to be.
  const widest = Math.ceil(Math.max(...lines.map((l) => measure(l, fx11, "400", font.metrics))));
  const w = Math.min(NOTE_MAX_W, widest + 24 + NOTE_GUTTER);
  return { lines, w, h: lines.length * 15 + 12 };
}

const SIDE_UP: Record<string, string> = { north: "NORTH", south: "SOUTH", east: "EAST", west: "WEST" };
const SIDE_DOWN: Record<string, Side> = { NORTH: "north", SOUTH: "south", EAST: "east", WEST: "west" };

export interface PNode extends VNode {
  x: number; y: number; w: number; h: number;
  rank: number;
}
export interface PPort { edge: string; node: string; side: Side; x: number; y: number }
export interface PFrame {
  path: string; label: string; x: number; y: number; w: number; h: number;
  color?: Hue;
  /** A wire runs through the title: the renderer draws the title last, on a
   *  halo, so it stays legible — the zone-chip rule applied to frame titles.
   *  Set only when it happens, which keeps every other render byte-identical. */
  titleCrossed?: boolean;
  /** Frame-chain nesting depth, outermost = 0. Counts *frames* only — a frame
   *  inside a zone is still depth 0 — because the renderer keys the recessed
   *  fill off it (depth 0 only; docs/notes/full-detail.md). */
  depth: number;
}
export interface PZone {
  id: string; label: string; kind: ZoneKind;
  icon?: { pack: string; id: string };
  labelPos: ZoneLabelPos;
  color?: Hue;
  /** mono chip segment — a CIDR, an account id (SPEC §zones) */
  detail?: string;
  x: number; y: number; w: number; h: number;
  depth: number; // nesting depth, outermost = 0 (render order)
}
export interface PEdge {
  id: string; from: string; to: string;
  label?: string; async: boolean;
  animate?: import("../model/types.js").EdgeAnimate;
  style?: "dashed" | "dotted";
  count: number;
  tags: string[];
  color?: Hue;
  heads: "one" | "both" | "none";
  points: { x: number; y: number }[];
  /** Label space reserved by ELK at layout time (cross-rank edges). The pill
   *  is drawn exactly here — no search, no fallback, no way to collide: the
   *  room exists because the layout made it. Coplanar edges get theirs from
   *  the router (phase 2); until then they are undefined and the renderer's
   *  search still covers them. */
  labelRect?: { x: number; y: number; w: number; h: number };
  /** Produced by the coplanar router rather than ELK. ELK's wires may cross a
   *  frame interior legitimately (it routes them around what it knows); ours
   *  must not cross anything, and the invariant sweep holds us to it. */
  coplanar?: true;
  /** Which of the router's shapes drew it, when it was not a same-rank wire:
   *  `bus` is a folded fan-out's spine-trunk-drop (docs/notes/wrap.md). */
  via?: "bus";
}
export interface Positioned {
  name: string;
  width: number; height: number;
  nodes: PNode[]; edges: PEdge[]; ports: PPort[]; frames: PFrame[];
  zones: PZone[];
  flow?: { label: string; byEdge: Record<string, number[]> };
  lines: "orthogonal" | "curved" | "straight";
  /** Zone label chips: geometry only — colour is a theme concern and layout
   *  is theme-free (the adaptive contract shares one layout across palettes).
   *  Slid along their zone's border to the least-crossed spot, exactly the
   *  algorithm that lived in svg.ts. */
  chips: {
    x: number; y: number; w: number; h: number; label: string; zone: string;
    icon?: { pack: string; id: string };
    /** mono segment text, and the width reserved for it — measured here so
     *  the renderer draws the segment the placer actually made room for */
    detail?: string; detailW?: number;
  }[];
  /** Flow badges, reserved for the FULL flow's step text. Walking a flow
   *  (`flowStep`) is a viewer concern: the renderer draws the walked subset
   *  right-aligned inside the reservation, so per-step text changes never move
   *  or collide with anything. */
  badges: { edgeId: string; x: number; y: number; w: number; h: number; nums: number[] }[];
  /** Fully placed notes, in declaration order: the resolver lives in layout
   *  now. Text lines are pre-wrapped (font-derived, theme-free); style/colour
   *  stay the renderer's. */
  notes?: { i: number; x: number; y: number; w: number; h: number; lines: string[]; leader?: { x1: number; y1: number; x2: number; y2: number } }[];
  /** Layout-reserved note boxes by view-note index — today the edge-anchored
   *  ones (second inline labels on their own elk edge). The resolver draws a
   *  reserved note exactly here and skips its candidate ladder. */
  noteBoxes?: Map<number, { x: number; y: number; w: number; h: number }>;
}

// Node width depends on the theme's font — the theme is a determinism input,
// so this is still a pure function of (source, theme). Both shipping themes
// use Inter at scale 1, so the parameter is currently constant; it stays
// because a theme that changed the face would change every node's width, and
// that dependency should be visible in the signature rather than assumed away.
const INTER: Pick<ThemeFont, "metrics" | "scale"> = { metrics: "inter", scale: 1 };

function sizeOf(n: VNode, font: Pick<ThemeFont, "metrics" | "scale">): { w: number; h: number } {
  const fam = font.metrics as FontFamily;
  const fx = (px: number) => Math.round(px * font.scale);
  const isCard = n.kind === "card" || n.kind === "context-card";
  if (isCard) {
    // The text column now starts after an icon plate and ends before the
    // glyph chip, so both come out of the width rather than letting the label
    // run under either.
    const need = PAD + PLATE + PAD + Math.max(
      measure(n.label, fx(15), "500", fam),
      measure(n.tagline ?? "", fx(11), "400", fam),
    ) + PAD + GLYPH_CHIP + PAD;
    return { w: CARD_TIERS.find((t) => t >= need) ?? CARD_TIERS[CARD_TIERS.length - 1], h: CARD_H };
  }
  const need = PAD + PLATE + PAD + measure(n.label, fx(13), "500", fam) + PAD;
  const w = LEAF_TIERS.find((t) => t >= need) ?? LEAF_TIERS[LEAF_TIERS.length - 1];
  // An actor is shorter than a service: no description line, and its round
  // avatar reads at 34 where a service plate reads at 40.
  return { w, h: n.kind === "person" ? PERSON_H : LEAF_H };
}

export async function layoutView(
  model: SModel,
  view: SView,
  font: Pick<ThemeFont, "metrics" | "scale"> = INTER,
): Promise<{ positioned: Positioned; diagnostics: Diagnostic[] }> {
  // A view scoped to a container (its auto view, or `scope c`) stands *inside*
  // it, so the container's own `layout { }` is the root layout there — unless
  // the view brings any rows/cols/place/direction of its own, in which case
  // the view's hints replace the block outright (SPEC §6: explicit wins, all
  // or nothing — the same rule that makes `view <path>` the customization of
  // the auto view rather than an overlay on it).
  {
    const own = view.scope ? model.containers.get(view.scope)?.layout : undefined;
    const viewHints = !!(view.layout.rows || view.layout.cols || view.layout.place.length || view.layout.direction);
    if (own && !viewHints)
      view = {
        ...view,
        layout: { ...view.layout, rows: own.rows, cols: own.cols, place: own.place, direction: own.direction },
      };
  }
  const graph = resolveView(model, view);
  const diagnostics = [...graph.diagnostics];
  const byPath = new Map(graph.nodes.map((n) => [n.path, n]));
  const memberPaths = graph.nodes.map((n) => n.path);
  const edges: VEdge[] = graph.edges;

  // Top "entities": frames count as one unit for ranking/order; framed nodes
  // project to their frame — the *outermost* one, since `expand *` nests
  // frames and only a top-level frame is a ranking unit. Inside frames, ELK's
  // natural layering rules.
  const frameParent = new Map(graph.frames.map((f) => [f.path, f.frame]));
  const outermostFrame = (frame: string) => {
    let f = frame;
    for (let p = frameParent.get(f); p; p = frameParent.get(p)) f = p;
    return f;
  };
  const entityOf = (p: string) => {
    const frame = byPath.get(p)?.frame; // a node's immediate frame
    if (frame) return outermostFrame(frame);
    return frameParent.has(p) ? outermostFrame(p) : p; // a frame is its outermost; anything else is itself
  };
  const entities = [
    ...graph.frames.filter((f) => !f.frame).map((f) => f.path),
    ...graph.nodes.filter((n) => !n.frame).map((n) => n.path),
  ];
  const entitySet = new Set(entities);

  // ── zones (SPEC §Zones): cross-cutting boundaries → ELK compounds ────────
  // A zone's effective members in this view are the visible entities matching
  // any declared member path (exactly, or as a descendant). Zones must form a
  // clean hierarchy — with each other AND with expanded frames — so the whole
  // picture stays a tree ELK can lay out; like frames, a zone is one unit for
  // ranking and ELK layers freely inside it.
  const memberMatch = (path: string, member: string) =>
    path === member || path.startsWith(member + ".");
  interface LZone {
    id: string; label: string; kind: ZoneKind;
    icon?: { pack: string; id: string }; labelPos: ZoneLabelPos;
    color?: Hue;
    detail?: string;
    set: Set<string>;
  }
  const zones: LZone[] = [];
  for (const z of model.zones) {
    const set = new Set(entities.filter((e) => z.members.some((m) => memberMatch(e, m))));
    for (const n of graph.nodes) {
      // any enclosing frame in the zone keeps the node whole — under
      // `expand *` the ranked entity is the outermost frame, so that is the
      // one membership must cover, and the one the error should name
      if (!n.frame || set.has(outermostFrame(n.frame))) continue;
      if (z.members.some((m) => memberMatch(n.path, m)))
        diagnostics.push({
          severity: "error",
          message: `zone \`${z.id}\` cuts through expanded container \`${outermostFrame(n.frame)}\` (member \`${n.path}\`)`,
          fix: `contain the whole container (\`contains ${outermostFrame(n.frame)}\`), or don't expand it in this view`,
          loc: z.loc,
        });
    }
    if (set.size > 0)
      zones.push({
        id: z.id, label: z.label ?? z.id, kind: z.kind,
        icon: z.icon, labelPos: z.labelPos, color: z.color, detail: z.detail, set,
      });
    else if (!view.auto)
      // A zone follows visibility by design, but vanishing in silence is not
      // the same thing: the author asked for this boundary in a view they
      // wrote, so say why it is not there (SPEC §6: never silently dropped).
      diagnostics.push({
        severity: "warning",
        message: `zone \`${z.id}\` has no visible members in view \`${view.name}\``,
        fix: z.members.length
          ? `its members (${z.members.join(", ")}) are inside collapsed cards here — ` +
            `\`expand\` one, or scope the view to them`
          : "the zone contains nothing",
        loc: z.loc,
      });
  }
  for (let i = 0; i < zones.length; i++)
    for (let j = i + 1; j < zones.length; j++) {
      const A = zones[i], B = zones[j];
      const shared = [...A.set].filter((e) => B.set.has(e));
      if (!shared.length) continue;
      const aOnly = [...A.set].filter((e) => !B.set.has(e));
      const bOnly = [...B.set].filter((e) => !A.set.has(e));
      if (aOnly.length && bOnly.length)
        diagnostics.push({
          severity: "error",
          message: `zones \`${A.id}\` and \`${B.id}\` partially overlap — visible zones must nest or stay disjoint`,
          fix: `shared: ${shared.join(", ")} · only ${A.id}: ${aOnly.join(", ")} · only ${B.id}: ${bOnly.join(", ")}`,
          loc: view.loc,
        });
      // Identical member sets pass the partial-overlap test (nothing is
      // exclusive to either) and then break the nesting pass, which orders
      // zones by strict containment: neither can be the other's parent, so one
      // ends up with no geometry and its members render outside it. Found by a
      // generated-input spike; no hand-written diagram had ever declared the
      // same boundary twice.
      else if (!aOnly.length && !bOnly.length)
        diagnostics.push({
          severity: "error",
          message: `zones \`${A.id}\` and \`${B.id}\` contain exactly the same members`,
          fix: `one boundary cannot sit inside the other: merge them, or give one a narrower \`contains\``,
          loc: view.loc,
        });
    }
  // nesting: parent = smallest strictly-containing zone; entity → smallest zone
  const zoneParent = new Map<string, LZone | undefined>();
  for (const z of zones) {
    let parent: LZone | undefined;
    for (const cand of zones) {
      if (cand === z || cand.set.size <= z.set.size) continue;
      if (![...z.set].every((e) => cand.set.has(e))) continue;
      if (!parent || cand.set.size < parent.set.size) parent = cand;
    }
    zoneParent.set(z.id, parent);
  }
  const entityZone = new Map<string, LZone>();
  for (const e of entities) {
    let best: LZone | undefined;
    for (const z of zones) if (z.set.has(e) && (!best || z.set.size < best.set.size)) best = z;
    if (best) entityZone.set(e, best);
  }
  const outerZoneOf = (e: string): string | undefined => {
    let z = entityZone.get(e);
    while (z && zoneParent.get(z.id)) z = zoneParent.get(z.id);
    return z?.id;
  };
  // the ranking/order granularity: outermost zone, else frame, else the node
  const unitOf = (p: string) => outerZoneOf(entityOf(p)) ?? entityOf(p);
  const units = [
    ...zones.filter((z) => !zoneParent.get(z.id)).map((z) => z.id),
    ...entities.filter((e) => !entityZone.has(e)),
  ];
  const unitSet = new Set(units);

  // ── ranks: declared (rows/place) pinned; everything else floats around them.
  // Context cards arrive *above* the scope's first row, so unhinted nodes may
  // take negative ranks and the whole grid is normalized afterwards. Declared
  // rows are relative to each other — context must never push them down.
  // ── wrap (Tier 0, PoC): synthesize `rows` for a chain or a fan-out ───────
  // A fold is a rank assignment, so it is written as the rows the author could
  // have typed and flows through everything rows already have: scaffold lower
  // bounds, the coplanar router within a band, the conflict checks. It lives
  // here rather than in the model because the shape test needs the *view's*
  // graph (after scope/only/expand), which the model never sees. Two shapes,
  // precisely: one linear chain, or one source whose targets are all leaves
  // with no other edges. Anything else warns — a knob that silently does
  // nothing is the defect routing-hints.md records reverting `around` for.
  //
  // The chain folds as a serpentine (band 2 runs right→left): the hop between
  // bands is then a one-column vertical, and the reversed arrows say which way
  // the band reads. The fan folds its targets into bands under the source; the
  // edges into band ≥2 are hidden from ELK (as coplanar edges are) and drawn
  // as a bus by `busEdges` below, because ELK's own answer to a rank-skipping
  // fan is to place the far band *outside* the near one and detour around it.
  type Wrap = { kind: "chain" | "fan"; source?: string; bands: string[][]; col: Map<string, number> };
  let wrap: Wrap | undefined;
  if (view.layout.wrap) {
    const n = view.layout.wrap.n;
    const paths = graph.nodes.map((nd) => nd.path);
    const outs = new Map<string, string[]>(), ins = new Map<string, string[]>();
    for (const e of edges) {
      outs.set(e.from, [...(outs.get(e.from) ?? []), e.to]);
      ins.set(e.to, [...(ins.get(e.to) ?? []), e.from]);
    }
    const deg = (m: Map<string, string[]>, p: string) => m.get(p)?.length ?? 0;
    const heads = paths.filter((p) => deg(ins, p) === 0);
    let why: string | undefined;
    if (graph.frames.length || zones.length) why = "it holds expanded containers or zones";
    else if (edges.length !== paths.length - 1 || heads.length !== 1) why = "its edges do not form one chain or one fan";
    else {
      const head = heads[0];
      const isChain = paths.every((p) => deg(outs, p) <= 1 && deg(ins, p) <= 1);
      const isFan = deg(outs, head) === paths.length - 1 &&
        paths.every((p) => p === head || (deg(ins, p) === 1 && deg(outs, p) === 0));
      if (isChain) {
        const order: string[] = [];
        for (let p: string | undefined = head; p && !order.includes(p); p = outs.get(p)?.[0]) order.push(p);
        const col = new Map<string, number>();
        const bands: string[][] = [];
        for (let i = 0; i * n < order.length; i++) {
          const slice = order.slice(i * n, (i + 1) * n);
          slice.forEach((p, k) => col.set(p, i % 2 ? n - 1 - k : k));
          bands.push([...slice].sort((a, b) => col.get(a)! - col.get(b)!));
        }
        wrap = { kind: "chain", bands, col };
      } else if (isFan) {
        const targets = paths.filter((p) => p !== head); // declaration order
        const col = new Map<string, number>([[head, 0]]);
        const bands: string[][] = [[head]];
        for (let i = 0; i * n < targets.length; i++) {
          const slice = targets.slice(i * n, (i + 1) * n);
          slice.forEach((p, k) => col.set(p, k));
          bands.push(slice);
        }
        wrap = { kind: "fan", source: head, bands, col };
      } else why = "its edges do not form one chain or one fan";
      // a fold that leaves one band (or a fan with one target band) is no fold
      if (wrap && wrap.bands.length < (wrap.kind === "fan" ? 3 : 2)) {
        why = wrap.kind === "fan"
          ? `its ${paths.length - 1} targets already fit in one band of ${n}`
          : `its ${paths.length} nodes already fit in one band of ${n}`;
        wrap = undefined;
      }
    }
    if (!wrap)
      diagnostics.push({
        severity: "warning",
        message: `\`wrap ${n}\` has no effect — this view is not a single chain or a single fan-out (${why})`,
        fix: "wrap folds one chain (a → b → c …) or one source fanning out to leaves; " +
          "for any other shape write the bands by hand: `rows [a b] [c d]`",
        loc: view.layout.wrap.loc,
      });
  }
  const rowsHint = view.layout.rows ?? wrap?.bands;
  /** Column-mate in the previous band: the scaffold feeder for a folded node,
   *  so bands line up as a grid instead of every unhinted member hanging off
   *  the first node of the rank above. */
  const wrapFeeder = new Map<string, string>();
  if (wrap)
    wrap.bands.forEach((band, i) => {
      if (i === 0) return;
      for (const p of band) {
        const mate = wrap!.bands[i - 1].find((q) => wrap!.col.get(q) === wrap!.col.get(p));
        if (mate) wrapFeeder.set(p, mate);
      }
    });
  const wrapBand = new Map<string, number>();
  wrap?.bands.forEach((band, i) => band.forEach((p) => wrapBand.set(p, i)));

  const declared = new Map<string, number>();
  rowsHint?.forEach((row, i) =>
    row.forEach((p) => unitSet.has(unitOf(p)) && declared.set(unitOf(p), i)),
  );
  // `place`'s direction word decides whether the node changes band or just its
  // position within one, and which axis is which depends on `direction`:
  // laying out downward, ranks are rows, so above/below move between them and
  // left-of/right-of order within one. Laying out to the right, ranks are
  // columns and the pairs swap. (Before this, relpos was parsed, validated and
  // documented — then never read: all four directions produced byte-identical
  // output, so `place x left-of y` silently meant right-of.)
  const downward = view.layout.direction !== "right";
  const changesBand = (rp: RelPos) =>
    downward ? rp === "above" || rp === "below" : rp === "left-of" || rp === "right-of";
  const towardsStart = (rp: RelPos) => rp === "above" || rp === "left-of";

  const crossEdges = edges
    .map((e) => [unitOf(e.from), unitOf(e.to)] as const)
    .filter(([a, b]) => a !== b);

  /** Relax until stable: successors sit below predecessors; unpinned
   *  predecessors of a pinned node float above it (possibly negative).
   *  Parameterised over the level's members and edges so an expanded frame's
   *  interior (below) runs the same pass over its own children. */
  const relaxOver = (
    members: string[],
    pairs: readonly (readonly [string, string])[],
    pins: Map<string, number>,
  ): Map<string, number> => {
    const out = new Map(pins);
    for (let pass = 0; pass < members.length + 2; pass++) {
      let changed = false;
      for (const [a, b] of pairs) {
        const ra = out.get(a), rb = out.get(b);
        if (!pins.has(b)) {
          const want = Math.max(rb ?? 0, (ra ?? 0) + 1);
          if (want !== rb) { out.set(b, want); changed = true; }
        }
        if (!pins.has(a)) {
          const cap = (out.get(b) ?? 0) - 1;
          const want = rb !== undefined ? Math.min(ra ?? cap, cap) : ra ?? 0;
          if (want !== ra) { out.set(a, want); changed = true; }
        }
      }
      if (!changed) break;
    }
    for (const p of members) if (!out.has(p)) out.set(p, 0);
    return out;
  };
  const relax = (pins: Map<string, number>) => relaxOver(units, crossEdges, pins);

  // `place` needs its target's rank — but that only existed for targets pinned
  // by `rows`, so `place x below y` where y wasn't in a rows band was silently
  // discarded, and in a diagram with no `rows` at all *every* place did nothing.
  // A target's natural rank is knowable, it just isn't known yet: relax once to
  // learn it, pin the placed nodes against that, then relax again.
  const beforePlace = relax(declared);
  for (const pl of view.layout.place) {
    // Already-pinned first, so places chain: `place idx right-of sync` has to
    // see where the *previous* `place sync right-of db` put sync, not sync's
    // natural rank. The relaxed value is only the fallback, for a target
    // nothing has pinned.
    const t = declared.get(unitOf(pl.target)) ?? beforePlace.get(unitOf(pl.target));
    if (t === undefined) continue;
    declared.set(
      unitOf(pl.node),
      changesBand(pl.relpos) ? t + (towardsStart(pl.relpos) ? -1 : 1) : t,
    );
  }

  // Ranking granularity is the outermost zone (`unitOf`), so nodes sharing one
  // collapse to a single unit and any rank hint between them is discarded —
  // along with the "runs upward" check, which would be comparing a unit against
  // itself. Wrapping a diagram in one boundary is the normal shape for a cloud
  // estate, and it turned `rows` into dead code that reported nothing: a whole
  // `layout` block rendering byte-identical to no block at all. Hints may be
  // unimplementable here, but they must never be silent (SPEC §9).
  {
    const zoneIds = new Set(zones.map((z) => z.id));
    // Naming a zone member in `rows` is *not* automatically inert: the rank is
    // recorded against the member's unit, which is the zone, so naming one
    // member is exactly how you rank the whole zone against everything outside
    // it — and that works. It only goes nowhere when the same zone is named
    // from more than one band, because the second write overwrites the first
    // and the ordering that was being asked for is the one thing ELK decides
    // internally. Warning on the single-member case told people a hint they
    // could see working had no effect.
    const bandsPerZone = new Map<string, Map<number, Set<string>>>();
    (rowsHint ?? []).forEach((row, i) =>
      row.forEach((p) => {
        const zone = unitOf(p);
        if (zone === entityOf(p) || !zoneIds.has(zone)) return;
        const bands = bandsPerZone.get(zone) ?? new Map<number, Set<string>>();
        bandsPerZone.set(zone, bands);
        (bands.get(i) ?? bands.set(i, new Set()).get(i)!).add(p);
      }),
    );
    const inertRows = [...bandsPerZone.values()]
      .filter((bands) => bands.size > 1)
      .flatMap((bands) => [...bands.values()].flatMap((s) => [...s]));
    const inertPlace = view.layout.place
      .filter((pl) => unitOf(pl.node) === unitOf(pl.target) && zoneIds.has(unitOf(pl.node)))
      .map((pl) => pl.node);
    const stuck = [...new Set([...inertRows, ...inertPlace])];
    if (stuck.length) {
      const zone = unitOf(stuck[0]);
      diagnostics.push({
        severity: "warning",
        message:
          `rank hints on ${stuck.map((p) => `\`${p}\``).join(", ")} have no effect — ` +
          `zone \`${zone}\` is laid out as one block, and its members are ranked inside it by ELK`,
        fix:
          `rows/cols/place order things *between* zones, not within one. ` +
          `Name a single member to rank the zone as a whole, ` +
          `or drop the boundary if the order inside it matters more.`,
        loc: view.loc,
      });
    }
  }

  // second pass, now that `place` has pinned what it resolved against
  const rank = relax(declared);
  // normalize to 0-based
  const minRank = Math.min(...rank.values());
  if (minRank !== 0) for (const [k, v] of rank) rank.set(k, v - minRank);

  // model order over units: rows first, placed after targets, rest in resolve order
  const order: string[] = [];
  for (const p of (rowsHint ?? []).flat().map(unitOf))
    if (unitSet.has(p) && !order.includes(p)) order.push(p);
  // Everything else in resolve order *before* `place` runs, so a placed node
  // can be moved next to its target even when neither is in a `rows` band.
  // Seeding only from rows meant `indexOf(target)` was -1 in a diagram without
  // rows, and the reorder was skipped — so `left-of` did nothing there.
  for (const p of units) if (!order.includes(p)) order.push(p);
  for (const pl of view.layout.place) {
    const n = unitOf(pl.node);
    const from = order.indexOf(n);
    if (from < 0) continue;
    order.splice(from, 1);
    const i = order.indexOf(unitOf(pl.target));
    if (i < 0) { order.splice(from, 0, n); continue; } // target not here: leave it be
    // Within a band, model order *is* left-to-right, so `left-of` has to land
    // before its target. Across bands (above/below) the node sits in a
    // different row entirely and this only decides which column it lands near,
    // so keep it adjacent to the target.
    order.splice(!changesBand(pl.relpos) && towardsStart(pl.relpos) ? i : i + 1, 0, n);
  }

  // `cols` pins horizontal bands: members of an earlier column sit left of a
  // later one. Only columned units move — the slots they occupy in the model
  // order are re-filled in column order, so everything else keeps its place.
  if (view.layout.cols?.length) {
    const colOf = new Map<string, number>();
    view.layout.cols.forEach((col, i) => col.forEach((p) => colOf.set(unitOf(p), i)));
    const slots: number[] = [];
    order.forEach((p, i) => { if (colOf.has(p)) slots.push(i); });
    const columned = slots.map((i) => order[i])
      .sort((a, b) => colOf.get(a)! - colOf.get(b)! || order.indexOf(a) - order.indexOf(b));
    slots.forEach((slot, i) => { order[slot] = columned[i]; });
  }

  // ── interior hints: rows/cols/place naming leaves inside an expanded frame ─
  // Ranking granularity at the root is the unit, so a hint naming a leaf inside
  // an expanded frame projected onto the frame and stopped there:
  // `rows [gw] [app.api] [app.q app.db]` rendered byte-identical to no hint at
  // all, with nothing said. The interior is ELK's, but it takes levers there
  // too — three, all measured against elkjs 0.12 (docs/notes/coplanar.md will
  // carry the table): an invisible edge is a rank lower bound inside a
  // compound exactly as at the root; the compound's *child model order* is
  // the order of its entry layer (members fed only from outside the frame,
  // via the border-port dummies); and every layer below the entry follows
  // `semiInteractive` crossing minimisation with `elk.position` on the
  // children — child model order is ignored there, and the root's
  // `forceNodeModelOrder` never reaches a child graph (setting it on the
  // compound crashes ELK's comparator on the border dummies). So each
  // expanded frame runs the root's pass over its *direct* members — child
  // frames then leaves, what `framedChildren` hands ELK — with a hint on a
  // deeper path projecting to the child frame that holds it, exactly as the
  // root projects onto the outermost one; the result is both the child order
  // and the positions. A frame with no hint at its level is left alone, which
  // is what keeps every unhinted render identical.
  // What this cannot do is route: an edge between two members declared on one
  // row stays in ELK's graph (the coplanar router stops at the frame wall,
  // coplanar.md), so ELK layers them apart — that pair is a warning, not a
  // silent no-op.
  const frameOrder = new Map<string, string[]>();
  const innerScaffold: { id: string; from: string; to: string }[] = [];
  /** The direct child of `frame` that holds `p` (p itself when it is one). */
  const memberOf = (frame: string, p: string): string | undefined => {
    let cur = p;
    let parent = byPath.get(p)?.frame ?? frameParent.get(p);
    while (parent !== undefined) {
      if (parent === frame) return cur;
      cur = parent;
      parent = frameParent.get(parent);
    }
    return undefined;
  };
  for (const f of graph.frames) {
    const F = f.path;
    const members = [
      ...graph.frames.filter((c) => c.frame === F).map((c) => c.path),
      ...graph.nodes.filter((n) => n.frame === F).map((n) => n.path),
    ];
    // Two sources of interior hints, never merged: the view's own hints when
    // they relate two or more of this frame's members, else the container's
    // `layout { }` block. All or nothing per container (SPEC §6) — a merge of
    // bands from two blocks would draw an arrangement neither block asked for.
    const project = (paths: string[][]) =>
      paths.map((band) => band.map((p) => memberOf(F, p)).filter((m): m is string => m !== undefined));
    const viewRows = project(view.layout.rows ?? []);
    const viewCols = project(view.layout.cols ?? []);
    const viewPlace = view.layout.place.flatMap((pl) => {
      const node = memberOf(F, pl.node), target = memberOf(F, pl.target);
      return node && target && node !== target ? [{ pl, node, target }] : [];
    });
    const viewNamed = new Set([...viewRows.flat(), ...viewCols.flat(), ...viewPlace.flatMap((x) => [x.node, x.target])]);
    const own = viewNamed.size >= 2 ? undefined : model.containers.get(F)?.layout;
    const hintLoc = own?.loc ?? view.loc;
    const rowsHere = own ? project(own.rows ?? []) : viewRows;
    const colsHere = own ? project(own.cols ?? []) : viewCols;
    const placeHere = (own ? own.place : []).flatMap((pl) => {
      const node = memberOf(F, pl.node), target = memberOf(F, pl.target);
      return node && target && node !== target ? [{ pl, node, target }] : [];
    }).concat(own ? [] : viewPlace);
    // Engage only when a hint relates two or more of this frame's members.
    // Naming one member is how you rank the whole frame from the root
    // (`rows [gw] [app.api]`), and that must keep rendering exactly as it
    // did — switching the frame to semi-interactive on its account would
    // replace ELK's interior order with declaration order, uninvited.
    const named = new Set([...rowsHere.flat(), ...colsHere.flat(), ...placeHere.flatMap((x) => [x.node, x.target])]);
    if (named.size < 2) continue;

    const pairs = edges.flatMap((e) => {
      const a = memberOf(F, e.from), b = memberOf(F, e.to);
      return a && b && a !== b ? [[a, b] as const] : [];
    });
    // same rule as the root: a member named from several bands takes the last
    const pinned = new Map<string, number>();
    rowsHere.forEach((row, i) => row.forEach((m) => pinned.set(m, i)));
    const before = relaxOver(members, pairs, pinned);
    for (const { pl, node, target } of placeHere) {
      const t = pinned.get(target) ?? before.get(target)!;
      pinned.set(node, changesBand(pl.relpos) ? t + (towardsStart(pl.relpos) ? -1 : 1) : t);
    }
    for (const e of edges) {
      const a = memberOf(F, e.from), b = memberOf(F, e.to);
      if (!a || !b || a === b || !pinned.has(a) || !pinned.has(b)) continue;
      if (pinned.get(a)! > pinned.get(b)!)
        diagnostics.push({
          severity: "error",
          message: `hint conflict: \`${e.from}\` → \`${e.to}\` runs upward inside \`${F}\` — row ${pinned.get(a)} to row ${pinned.get(b)}`,
          fix: `put \`${e.to}\` in a row below \`${e.from}\`, or drop one of them from \`rows\``,
          loc: hintLoc,
        });
      else if (pinned.get(a) === pinned.get(b))
        diagnostics.push({
          severity: "warning",
          message:
            `\`${e.from}\` and \`${e.to}\` are asked to share a row inside \`${F}\`, but the edge between them ` +
            `cannot be routed there — same-rank edges are routed only between units, not inside an expanded container`,
          fix: `ELK will layer them apart: put \`${e.to}\` in the row below \`${e.from}\`, or collapse \`${F}\` in this view`,
          loc: hintLoc,
        });
    }
    const rankHere = relaxOver(members, pairs, pinned);
    const lo = Math.min(...rankHere.values());
    for (const [k, v] of rankHere) rankHere.set(k, v - lo);

    const orderHere: string[] = [];
    for (const m of rowsHere.flat()) if (!orderHere.includes(m)) orderHere.push(m);
    for (const m of members) if (!orderHere.includes(m)) orderHere.push(m);
    for (const { pl, node, target } of placeHere) {
      orderHere.splice(orderHere.indexOf(node), 1);
      const i = orderHere.indexOf(target);
      orderHere.splice(!changesBand(pl.relpos) && towardsStart(pl.relpos) ? i : i + 1, 0, node);
    }
    if (colsHere.some((c) => c.length)) {
      const colOf = new Map<string, number>();
      colsHere.forEach((col, i) => col.forEach((m) => colOf.set(m, i)));
      const slots: number[] = [];
      orderHere.forEach((m, i) => { if (colOf.has(m)) slots.push(i); });
      const columned = slots.map((i) => orderHere[i])
        .sort((a, b) => colOf.get(a)! - colOf.get(b)! || orderHere.indexOf(a) - orderHere.indexOf(b));
      slots.forEach((slot, i) => { orderHere[slot] = columned[i]; });
    }
    frameOrder.set(F, orderHere);

    const naturalHere = new Map(members.map((m) => [m, 0]));
    for (let i = 0; i < members.length; i++)
      for (const [a, b] of pairs) naturalHere.set(b, Math.max(naturalHere.get(b)!, naturalHere.get(a)! + 1));
    for (const m of orderHere) {
      const want = rankHere.get(m)!;
      if (naturalHere.get(m)! >= want) continue;
      const feeder = orderHere.find((x) => rankHere.get(x)! === want - 1);
      if (feeder) innerScaffold.push({ id: `scaffold.${m}`, from: feeder, to: m });
    }
  }

  // ── edge classes: inner (same entity) | coplanar (same rank, both bare) |
  //    cross-rank (ELK's) ────────────────────────────────────────────────────
  const inner = (e: VEdge) => entityOf(e.from) === entityOf(e.to) && byPath.get(e.from)?.frame;
  // The coplanar router handles bare leaves and leaves inside any unit — an
  // expanded frame or a zone — plus frames named as endpoints. A unit endpoint
  // routes between the two *outermost* unit rects, then inward to the leaf
  // when the corridor is clear (docs/notes/coplanar.md, approaches #5 and #6).
  // Zones used to be turned away on the grounds that a dashed boundary is not
  // a wall a wire can enter; ELK's own wires enter zones constantly, and the
  // first real diagram that banded two namespaces on one row (lookbook 27-k8s)
  // fell apart on that rule. Classifying an edge coplanar (hiding it from ELK)
  // IS the entire same-rank mechanism — there is no other way to co-layer its
  // units.
  const framePathSet = new Set(graph.frames.map((f) => f.path));
  const routable = (p: string) => byPath.has(p) || framePathSet.has(p);
  const coplanar = edges.filter(
    (e) =>
      !inner(e) &&
      routable(e.from) &&
      routable(e.to) &&
      unitOf(e.from) !== unitOf(e.to) &&
      rank.get(unitOf(e.from)) === rank.get(unitOf(e.to)),
  );
  const coplanarSet = new Set(coplanar.map((e) => e.id));
  // A folded fan's edges into band ≥2 skip a rank. Hidden from ELK exactly as
  // coplanar edges are — the targets then have no ELK edge, and the column-mate
  // scaffold is what ranks them — and drawn as a bus after ELK has finished.
  const bus = wrap?.kind === "fan"
    ? edges.filter((e) => e.from === wrap!.source && (wrapBand.get(e.to) ?? 0) >= 2)
    : [];
  const busSet = new Set(bus.map((e) => e.id));
  const elkEdges = edges.filter((e) => !coplanarSet.has(e.id) && !busSet.has(e.id));

  const natural = new Map(units.map((p) => [p, 0]));
  for (let i = 0; i < units.length; i++)
    for (const e of elkEdges) {
      const ef = unitOf(e.from), et = unitOf(e.to);
      if (ef !== et) natural.set(et, Math.max(natural.get(et)!, natural.get(ef)! + 1));
    }
  /** The `rows` line the author could paste, with `target` moved into
   *  `source`'s band — or undefined when that would break a different edge. */
  const mergedRowsFix = (source: string, target: string): string | undefined => {
    const moved = new Map(declared);
    moved.set(target, declared.get(source)!);
    for (const other of edges) {
      const oa = unitOf(other.from), ob = unitOf(other.to);
      if (oa === ob || !moved.has(oa) || !moved.has(ob)) continue;
      if (moved.get(oa)! > moved.get(ob)!) return undefined;
    }
    const bands = new Map<number, string[]>();
    for (const [unit, row] of moved) {
      if (!bands.has(row)) bands.set(row, []);
      bands.get(row)!.push(unit);
    }
    const line = [...bands.keys()].sort((x, y) => x - y)
      .map((row) => `[${bands.get(row)!.join(" ")}]`)
      .join(" ");
    return `write \`rows ${line}\` — equal ranks are legal, and route side to side`;
  };

  // A conflict is only a *user* error when two explicitly declared nodes
  // contradict each other — an edge that runs upward between declared rows.
  // Context and other unhinted nodes never trigger it; they float (see above).
  for (const e of edges) {
    const a = unitOf(e.from), b = unitOf(e.to);
    if (a === b || !declared.has(a) || !declared.has(b)) continue;
    if (declared.get(a)! > declared.get(b)!) {
      // equal ranks are legal (coplanar). Name the *unit* in the fix, not the
      // endpoint: ranking is per unit, so when an endpoint sits in a zone the
      // thing the author can actually move is the zone, and telling them to put
      // a zone member in a row is advice the language does not accept.
      const named = (endpoint: string, unit: string) =>
        endpoint === unit ? `\`${endpoint}\`` : `\`${unit}\` (which holds \`${endpoint}\`)`;
      diagnostics.push({
        severity: "error",
        message: `hint conflict: \`${e.from}\` → \`${e.to}\` runs upward — row ${declared.get(a)} to row ${declared.get(b)}`,
        // Round 17: 27-rank-conflict hit the *same* conflict on two consecutive
        // attempts, so the edit between them addressed nothing — the agent was
        // guessing at an arrangement rather than applying a fix. Every
        // diagnostic here that gets applied in one iteration writes the
        // corrected text out (`write \`[a b c]\``); the ones that describe a
        // choice between two abstract edits are the ones that get guessed at.
        // So: offer the concrete line. Merging the target into the source's
        // band is always legal on its own (equal ranks route side to side) —
        // but it can collide with a *different* edge, so it is only offered
        // when the whole arrangement comes back clean. A confidently wrong
        // suggestion is worse than a vague right one.
        fix: mergedRowsFix(a, b) ??
          `put ${named(e.to, b)} in a row below ${named(e.from, a)}, or drop one of them from \`rows\``,
        loc: view.loc,
      });
    }
  }

  const scaffold: { id: string; from: string; to: string }[] = [];
  for (const p of order) {
    const want = rank.get(p)!;
    const nat = natural.get(p)!;
    if (nat < want) {
      const feeder = wrapFeeder.get(p) ?? order.find((f) => rank.get(f)! === want - 1);
      if (feeder) scaffold.push({ id: `scaffold.${p}`, from: feeder, to: p });
    }
  }

  // route hints: exact (from|to|label) beats pairwise (from|to); a pairwise hint
  // on an ambiguous parallel pair is a check error per SPEC §4.
  const routeExact = new Map(
    view.layout.routes.filter((r) => r.label).map((r) => [`${r.from}|${r.to}|${r.label}`, r]),
  );
  const routePair = new Map(
    view.layout.routes.filter((r) => !r.label).map((r) => [`${r.from}|${r.to}`, r]),
  );
  const pairCount = new Map<string, number>();
  for (const e of edges) {
    const k = `${e.from}|${e.to}`;
    pairCount.set(k, (pairCount.get(k) ?? 0) + 1);
  }
  for (const r of view.layout.routes) {
    if (!r.label && (pairCount.get(`${r.from}|${r.to}`) ?? 0) > 1)
      diagnostics.push({
        severity: "error",
        message: `${pairCount.get(`${r.from}|${r.to}`)} edges match \`route ${r.from} -> ${r.to}\``,
        fix: "add the edge's label to the route statement to disambiguate",
        loc: r.loc,
      });
    // Sides are fed to ELK. Same-rank edges bypass ELK entirely for our own
    // coplanar router, which picks its own sides from geometry — so a `from`/`to`
    // hint on one is accepted, validated, and then discarded. That is the silent
    // class this project keeps having to fix, and the canonical example shipped
    // with one: `route db ~> sync from east to west` in examples/orders.squinch,
    // taught by the cookbook, doing nothing.
    if ((r.fromSide || r.toSide) && coplanar.some((e) => e.from === r.from && e.to === r.to))
      diagnostics.push({
        severity: "warning",
        message: `\`route ${r.from} -> ${r.to}\` sides are ignored — it is a same-rank edge`,
        fix: "same-rank edges are routed side-to-side automatically; drop the `from`/`to`, "
          + "or move one end to another row so the edge spans ranks",
        loc: r.loc,
      });
  }
  // Which sides an edge leaves and enters by default. This used to answer
  // south/north unconditionally, so a `direction right` diagram — laid out in
  // columns — had every edge forced out of the bottom of one box and into the
  // top of the next, jogging vertically across a gap meant to be crossed
  // sideways. `20-multicloud-migration` came out 456px tall for a graph that
  // fits in 288, and its stubs had nowhere to run, which is where two of the
  // five DESIGN §4 violations came from.
  const flowsRight = view.layout.direction === "right";
  const sidesIn = (e: VEdge, dir: "down" | "right"): { from: Side; to: Side } => {
    const hint =
      routeExact.get(`${e.from}|${e.to}|${e.label}`) ?? routePair.get(`${e.from}|${e.to}`);
    const forward = rank.get(unitOf(e.from))! <= rank.get(unitOf(e.to))!;
    const [out, into]: [Side, Side] = dir === "right"
      ? forward ? ["east", "west"] : ["west", "east"]
      : forward ? ["south", "north"] : ["north", "south"];
    return { from: hint?.fromSide ?? out, to: hint?.toSide ?? into };
  };
  const sidesOf = (e: VEdge): { from: Side; to: Side } => sidesIn(e, flowsRight ? "right" : "down");

  // Coplanar label reservation, straight case (phase 2). A labelled same-rank
  // pair needs its in-layer gutter to be at least the pill plus breathing room,
  // and `elk.spacing.individual` honours exactly that (spiked: 48 → 120 on
  // request) — so even the router's edges get their space from ELK where ELK
  // owns the dimension. The left node of the pair (model order, which
  // forceNodeModelOrder makes the in-layer order) carries the override. A pair
  // that ends up routed around a blocker wastes a little width here; the lane
  // itself is below the band, where width is free.
  // ── flow badges are part of the label reservation ────────────────────────
  // A badge used to be placed after layout: docked to the left of its pill, or
  // walked out from the edge's start until it stopped overlapping something.
  // Both fail the same way — the badge is positioned relative to the *pill*, or
  // to nothing, and never to its own wire. `microservices#checkout` had one
  // land flush between two pills (so it read as the wrong edge's number) and
  // another land on a neighbouring async wire; neither overlapped anything
  // `checkLayout` asserts, because the failure is attachment, not collision.
  // So a badge is reserved together with its pill, as one rect on one wire, and
  // the annotation pass carves it back out. Sized from the FULL flow's numbers,
  // so walking a flow one hop at a time still cannot change the geometry.
  const BADGE_GAP = 4;
  const fx = (px: number) => Math.round(px * font.scale);
  const badgeW = (edgeId: string) => {
    const nums = graph.flow?.byEdge[edgeId];
    if (!nums?.length) return 0;
    return Math.max(9, Math.round(measure(nums.join("·"), fx(10), "500", font.metrics) / 2) + 5) * 2;
  };

  const coplanarGutter = new Map<string, number>();
  for (const e of coplanar) {
    if (!e.label) continue;
    const bw = badgeW(e.id);
    // frame pairs reserve extra: their anchors come from interior leaves, so
    // the run may jog at mid-gutter and the pill needs clearance past the jog
    const framePair = unitOf(e.from) !== e.from || unitOf(e.to) !== e.to;
    const need = pillDims(e.label, font).w + (bw ? bw + BADGE_GAP : 0) + (framePair ? 32 : 16);
    const [a, b] = [unitOf(e.from), unitOf(e.to)];
    const left = order.indexOf(a) <= order.indexOf(b) ? a : b;
    coplanarGutter.set(left, Math.max(coplanarGutter.get(left) ?? 0, need));
  }

  /** ELK port ids that carry no edge (a bus spine's reserved slot): kept out
   *  of the ports registry by id, never by naming convention. */
  const reservedPorts = new Set<string>();
  const leafChild = (p: string) => {
    const n = byPath.get(p)!;
    const { w, h } = sizeOf(n, font);
    const ports = elkEdges.flatMap((e) => {
      const out: any[] = [];
      if (e.from === p)
        out.push({ id: `${e.id}.src`, width: 0, height: 0, layoutOptions: { "elk.port.side": SIDE_UP[leafPortSide.get(`${e.id}.src`)!] } });
      if (e.to === p)
        out.push({ id: `${e.id}.dst`, width: 0, height: 0, layoutOptions: { "elk.port.side": SIDE_UP[leafPortSide.get(`${e.id}.dst`)!] } });
      return out;
    });
    // A folded fan's bus leaves the source's band-side face beside ELK's own
    // fan stubs, and nothing reserves it room there: a bus wire squeezed
    // between two stubs 23 apart is 11 from each. So hand ELK a port for it
    // and pin the order — an unconnected port under FIXED_SIDE sorts to the
    // end of the face (measured), so the source goes FIXED_ORDER with an
    // index per port: band 1's targets in column order with the bus slot in
    // the middle gap. ELK's index runs clockwise from the top-left, which is
    // right→left along a south face and top→bottom down an east one.
    const busSource = wrap?.kind === "fan" && p === wrap.source && bus.length > 0;
    let portOrder: Record<string, string> = {};
    if (busSource) {
      const n1 = wrap!.bands[1].length;
      const busSlot = Math.ceil(n1 / 2); // the gap right of column busSlot-1
      const slots = n1 + 1;
      const indexOf = (slot: number) => String(flowsRight ? slot : slots - 1 - slot);
      for (const port of ports) {
        const e = elkEdges.find((x) => `${x.id}.src` === port.id);
        const col = e ? wrap!.col.get(e.to) : undefined;
        if (col === undefined) continue;
        port.layoutOptions["elk.port.index"] = indexOf(col + (col >= busSlot ? 1 : 0));
      }
      // a reserved slot on the source's face for the bus spine — an ELK port
      // no edge uses, so the harvest below must know it by id, not by shape
      reservedPorts.add(`${p}.bus`);
      ports.push({
        id: `${p}.bus`, width: 0, height: 0,
        layoutOptions: { "elk.port.side": flowsRight ? "EAST" : "SOUTH", "elk.port.index": indexOf(busSlot) },
      });
      portOrder = { "elk.portConstraints": "FIXED_ORDER" };
    }
    const gutter = coplanarGutter.get(p);
    return {
      id: p, width: w, height: h, ports,
      layoutOptions: {
        "elk.portConstraints": "FIXED_SIDE",
        ...portOrder,
        ...(gutter ? { "elk.spacing.individual": `elk.spacing.nodeNode:${gutter}` } : {}),
        ...interiorSlot(p),
      },
    };
  };
  // The in-layer lever inside a compound, below its entry layer. Model order
  // is not it there: under INCLUDE_CHILDREN the model-order options are read
  // per graph and never inherited, so a child graph runs plain barycenter
  // crossing minimisation (a fed row follows the feeding node's port order),
  // and setting them on the compound crashes ELK's comparator on the
  // border-port dummies (measured, elkjs 0.12). What ELK does take, per
  // compound, is `semiInteractive` crossing minimisation with `elk.position`
  // on the children — the order of the positions is the order of the layer.
  // Only frames that carry an interior hint switch it on, so every other
  // compound is laid out exactly as before.
  const interiorSlot = (p: string): Record<string, string> => {
    const parent = byPath.get(p)?.frame ?? frameParent.get(p);
    const slots = parent ? frameOrder.get(parent) : undefined;
    if (!slots) return {};
    const i = slots.indexOf(p);
    return { "elk.position": downward ? `(${i * 1000},0)` : `(0,${i * 1000})` };
  };

  const frameLabels = new Map(graph.frames.map((f) => [f.path, f.label]));
  const frameColors = new Map(graph.frames.map((f) => [f.path, f.color]));
  // Child frames recurse through entityElk (defined below — mutual recursion
  // is safe here because nothing invokes either until the ELK graph is built),
  // so an `expand *` ladder reaches ELK as real nested compounds rather than
  // the childless 0×0 leaves the one-level rule used to guard against.
  // Model order is ELK's in-layer order, so a frame with interior hints hands
  // its children over in the order the hints asked for (`frameOrder`, above);
  // every other frame keeps child frames then leaves, in declaration order.
  const framedChildren = (framePath: string): any[] =>
    (frameOrder.get(framePath) ?? [
      ...graph.frames.filter((f) => f.frame === framePath).map((f) => f.path),
      ...graph.nodes.filter((n) => n.frame === framePath).map((n) => n.path),
    ]).map((p) => (frameLabels.has(p) ? entityElk(p) : leafChild(p)));

  const density = view.layout.density ?? "comfortable";
  // On the 8px grid (DESIGN §2), and the ladder is now regular: each step is
  // +8 between the two spacings. `spacious` was [72,84] — the only rung where
  // the gap was 12, and the only one off the grid.
  const SP = { compact: [32, 40], comfortable: [48, 56], spacious: [72, 80] }[density];

  // Only views that carry a cross-rank label pay the spacer scheme at all: a
  // label-free view keeps the classic spacing with zero dummies, and stays
  // byte-identical to what it rendered before any of this existed. (Gate 1b
  // taught this the hard way — spacers on a label-free canonical example split
  // its routing channels around dummy layers and inflated it 26%.)
  // Edge-anchored notes are layout citizens (the first of the note anchors to
  // become one): `note on a -> b` rides its own edge into ELK as a second
  // inline label, so the gap is sized for the pill *and* the note and the two
  // can never fight over the midpoint — which is exactly where both used to be
  // placed. The other anchors stay on the render-time resolver: `right-of`/
  // `left-of` provably cannot be side-controlled in ELK (comment boxes ignore
  // port sides; in-layer edges re-rank), corners are canvas chrome, and
  // `above`/`below` would insert whole layers — deferred, recorded in
  // docs/notes/note-placement.md.
  const noteDims = (text: string) => noteBox(text, font);
  const edgeNotes: { i: number; edgeId: string; w: number; h: number }[] = [];
  // `above`/`below` on a bare anchor join the layout as layer nodes: a plain
  // node with a directed invisible edge (note→anchor places it above,
  // anchor→note below — spiked before adoption). The note gets a real layer,
  // so it can never collide and the next rank makes room instead of being
  // dodged around. Framed/zoned anchors keep the resolver: a note node inside
  // a compound would join the compound's layering, which is not what a
  // human-facing annotation should do to a container's interior.
  const layerNotes: { i: number; id: string; anchor: string; above: boolean; w: number; h: number }[] = [];
  (view.notes ?? []).forEach((note, i) => {
    if (note.anchor.kind === "edge") {
      const e = edges.find((x) => x.from === (note.anchor as any).from && x.to === (note.anchor as any).to);
      if (e) edgeNotes.push({ i, edgeId: e.id, ...noteDims(note.text) });
      return;
    }
    if (note.anchor.kind !== "relpos") return;
    const rp = note.anchor.relpos;
    if (rp !== "above" && rp !== "below") return;
    const target = note.anchor.target;
    const n = byPath.get(target);
    if (!n || n.frame) return;
    layerNotes.push({ i, id: `note:${i}`, anchor: target, above: rp === "above", ...noteDims(note.text) });
  });
  // Badges deliberately do NOT switch this on. A flow view with no labels at
  // all has nothing for a badge to collide with, and its badge sits at the
  // midpoint of its own run; turning the scheme on just to anchor one rewrote
  // the layout of `12-flow-checkout`, which had no pills in it to begin with.
  const hasElkLabels = elkEdges.some((e) => !!e.label) || edgeNotes.length > 0 || layerNotes.length > 0;

  // ── per-container direction (`direction right` in the container's own
  //    layout block, SPEC §3) ──────────────────────────────────────────────
  // Under `elk.hierarchyHandling: INCLUDE_CHILDREN` a compound's own
  // `elk.direction` is ignored outright (re-measured: byte-identical geometry
  // with and without it — coplanar.md, attempt 4). The frame therefore becomes
  // its own ELK *call*: laid out first, alone, with its wall ports as external
  // ports on the sides asked for; the root run then sees it as a fixed-size
  // leaf with FIXED_POS ports at the positions that call produced. That is
  // what makes its direction take effect, and what cuts every edge crossing
  // its wall in two — a run cannot address a port inside another run; the
  // wall ports are ELK's hierarchical ports and `segments` is the cut
  // (coplanar.md, approach #7). Not `SEPARATE_CHILDREN` on the compound inside
  // the one root call: measured, ELK's parent run then ignores the port side
  // whenever the target lands left of the frame, and drags an EAST port to the
  // west wall — the interior segment ran straight through the row. A frame
  // whose declared direction is the one already in effect around it is left
  // alone: a separate call moves geometry, and a no-op declaration must not.
  const frameDir = new Map<string, "down" | "right">();
  {
    const depth = (f: string) => { let d = 0; for (let p = frameParent.get(f); p; p = frameParent.get(p)) d++; return d; };
    const enclosing = (f: string): "down" | "right" => {
      for (let p = frameParent.get(f); p; p = frameParent.get(p)) if (frameDir.has(p)) return frameDir.get(p)!;
      return flowsRight ? "right" : "down";
    };
    for (const f of [...graph.frames].sort((a, b) => depth(a.path) - depth(b.path))) {
      const d = model.containers.get(f.path)?.layout?.direction;
      if (d && d !== enclosing(f.path)) frameDir.set(f.path, d);
    }
  }
  /** Pass-1 results, one per directed frame: the ELK output of its own call,
   *  keyed by frame path. Filled deepest-first before the root call, so a
   *  nested directed frame is already a fixed leaf when its parent runs. */
  const laidOut = new Map<string, any>();
  /** The direction in effect inside a container: its own, else the nearest
   *  directed ancestor's, else the view's. "root" is the view. */
  const dirOf = (container: string): "down" | "right" => {
    for (let f: string | undefined = container; f && f !== "root"; f = frameParent.get(f))
      if (frameDir.has(f)) return frameDir.get(f)!;
    return flowsRight ? "right" : "down";
  };
  const entityElk = (p: string): any =>
    !frameLabels.has(p)
      ? leafChild(p)
      : laidOut.has(p)
      ? {
          // a directed frame, already laid out by its own call: a leaf of that
          // size whose wall ports sit exactly where that call put them
          id: p,
          width: laidOut.get(p).width,
          height: laidOut.get(p).height,
          layoutOptions: { "elk.portConstraints": "FIXED_POS" },
          ports: (laidOut.get(p).ports ?? []).map((pt: any) => ({
            id: pt.id, width: 0, height: 0, x: pt.x, y: pt.y, layoutOptions: pt.layoutOptions,
          })),
        }
      : {
          id: p,
          layoutOptions: {
            // Off the grid on purpose, like the zone padding below: 44 is what
            // seats the frame's title against its top border. 48 pushes the
            // contents down without moving the title, so the band above the
            // first row just reads as slack.
            "elk.padding": "[top=44,left=16,bottom=16,right=16]",
            // A labelled frame-coplanar edge widens the gutter to its pill,
            // exactly as leafChild does — spiked: elk.spacing.individual is
            // honoured on a compound under INCLUDE_CHILDREN (coplanar.md #5)
            ...(coplanarGutter.get(p)
              ? { "elk.spacing.individual": `elk.spacing.nodeNode:${coplanarGutter.get(p)}` }
              : {}),
            // interior hints: the children carry `elk.position` (see
            // interiorSlot) and this is what makes ELK read them
            ...(frameOrder.has(p) ? { "elk.layered.crossingMinimization.semiInteractive": "true" } : {}),
            ...interiorSlot(p),
            "elk.spacing.nodeNode": "32",
            "elk.layered.spacing.nodeNodeBetweenLayers": hasElkLabels ? String(LABEL_GAP) : "40",
            // Edge spacing has to be repeated on every compound. ELK does not
            // inherit it from the root, and its own default is 10 — below the
            // 16 DESIGN §4 requires, and below the 2×R_EDGE at which a corner
            // reaches full radius, so a 10px stub renders as ~5px of straight
            // line and reads as a diagonal escape from the box. Every stub
            // violation in the corpus was an edge routed inside a zone or an
            // expanded frame, falling through to that default.
            "elk.layered.spacing.edgeNodeBetweenLayers": "24",
            "elk.spacing.edgeNode": "24",
      // labels are layout citizens (see the elkEdges map) — repeated in every
      // bag for the same reason the edge spacing is: ELK does not inherit
      "elk.edgeLabels.inline": "true",
      "elk.spacing.edgeLabel": String(LABEL_GAP),
          },
          children: framedChildren(p),
        };
  /** A directed frame's own ELK call: the compound, with its wall ports on
   *  fixed sides and the edge segments that live inside it, as the *one child*
   *  of a padding-less root that carries the frame's direction. Not the root
   *  itself — elkjs 0.12 crashes on a root graph with ports (`null.o`, from
   *  its JSON import) — and the direction goes on that root because an
   *  included child's own direction is ignored. With nothing beside it in
   *  the wrapper, nothing can drag a port off its side. */
  const frameGraph = (p: string): any => {
    const compound = entityElk(p); // laidOut does not have p yet → the compound form
    return {
      id: `${p}#call`,
      layoutOptions: {
        ...rootOptions,
        "elk.direction": frameDir.get(p) === "right" ? "RIGHT" : "DOWN",
        // The wrapper hands the frame to ELK's recursive engine as a graph of
        // its own (SEPARATE_CHILDREN): the frame then runs INCLUDE_CHILDREN
        // with its own direction, which routes edges into its nested frames
        // and lands its external ports on the sides asked for. Measured, the
        // alternatives fail: a ported compound *included* in the wrapper
        // crashes elkjs 0.12 when it holds a nested compound (`undefined.a`),
        // and a SEPARATE_CHILDREN frame drops every edge into a nested one.
        "elk.hierarchyHandling": "SEPARATE_CHILDREN",
        "elk.padding": "[top=0,left=0,bottom=0,right=0]",
        // model order never reaches inside a compound anyway (coplanar.md,
        // levers table), and set here it crashes ELK's comparator on the
        // border-port dummies a ported child creates
        "elk.layered.considerModelOrder.strategy": "NONE",
        "elk.layered.crossingMinimization.forceNodeModelOrder": "false",
      },
      children: [{
        ...compound,
        layoutOptions: {
          ...compound.layoutOptions,
          "elk.hierarchyHandling": "INCLUDE_CHILDREN",
          "elk.direction": frameDir.get(p) === "right" ? "RIGHT" : "DOWN",
          "elk.portConstraints": "FIXED_SIDE",
        },
        ports: framePorts.get(p) ?? [],
        edges: segments.filter((sg) => sg.container === p).map(segElk),
      }],
    };
  };

  // zone compound: child zones (declaration order) then direct entities
  // (resolve order) — both deterministic. Inherits the view's density.
  const zoneElk = (z: LZone): any => ({
    id: z.id,
    layoutOptions: {
      // Deliberately off the 8px grid, and staying that way. 28/20 encodes a
      // proportion — the band above the contents is one notch more than the
      // sides, enough to seat the label chip without the boundary reading
      // top-heavy. Rounding them individually onto the grid (32/16) doubles
      // that gap to 16 and the zone goes lopsided: on-grid, proportionally
      // wrong. DESIGN §2's rule is about numbers chosen from a deliberate
      // scale, not arithmetic for its own sake, and this pair is the scale.
      "elk.padding": "[top=28,left=20,bottom=20,right=20]",
      // a labelled zone-coplanar edge widens the gutter to its pill, exactly
      // as entityElk does for frames — a zone is a unit, and the reservation
      // is keyed by unit
      ...(coplanarGutter.get(z.id)
        ? { "elk.spacing.individual": `elk.spacing.nodeNode:${coplanarGutter.get(z.id)}` }
        : {}),
      "elk.spacing.nodeNode": String(SP[0]),
      "elk.layered.spacing.nodeNodeBetweenLayers": hasElkLabels ? String(LABEL_GAP) : String(SP[1]),
      // see entityElk: ELK does not inherit edge spacing into a compound
      "elk.layered.spacing.edgeNodeBetweenLayers": "24",
      "elk.spacing.edgeNode": "24",
      // labels are layout citizens (see the elkEdges map) — repeated in every
      // bag for the same reason the edge spacing is: ELK does not inherit
      "elk.edgeLabels.inline": "true",
      "elk.spacing.edgeLabel": String(LABEL_GAP),
    },
    children: [
      ...zones.filter((c) => zoneParent.get(c.id) === z).map(zoneElk),
      ...entities.filter((e) => entityZone.get(e) === z).map(entityElk),
    ],
  });
  const zoneById = new Map(zones.map((z) => [z.id, z]));

  // Gap arithmetic: see LABEL_GAP. A labelled gap costs 4×B around the label,
  // so an unlabelled one needs a spacer of (density - 4B) to come out at the
  // same place; a frame's tighter interior (historically 40) is the same sum
  // against 40. A real pill is 18 tall and is drawn centred inside whatever was
  // reserved, so labelled gaps only exceed the standard where 18 + 4B beats the
  // density spacing — compact only.
  const spacerH = (inFrame: boolean) => Math.max(2, (inFrame ? 40 : SP[1]) - 4 * LABEL_GAP);
  const labelFor = (e: VEdge) => {
    const inFrame = !!byPath.get(e.from)?.frame && byPath.get(e.from)?.frame === byPath.get(e.to)?.frame;
    const bw = badgeW(e.id);
    // An unlabelled edge reserves nothing extra: its badge draws centred *on*
    // the wire, where the 2px spacer already sits, and the wire's own clearance
    // (edgeNode / edgeEdge) is the room it needs. Widening the spacer instead
    // pushed the badge off to one side and rearranged whole flow diagrams that
    // have no pills at all — paying layout for a bead that sat fine on the line.
    if (!e.label) return { text: " ", width: 2, height: spacerH(inFrame) };
    return {
      text: e.label,
      width: pillDims(e.label, font).w + (bw ? bw + BADGE_GAP : 0),
      height: Math.max(18, spacerH(inFrame)),
    };
  };

  /** The root graph's own options, minus what a call sets for itself
   *  (direction, padding, hierarchy): shared with every directed frame's own
   *  call, so an interior is laid out by the same algorithm and spacings a
   *  compound would inherit under INCLUDE_CHILDREN. */
  const rootOptions: Record<string, string> = {
    "elk.algorithm": "layered",
    "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
    "elk.layered.crossingMinimization.forceNodeModelOrder": "true",
    "elk.edgeRouting": "ORTHOGONAL",
    "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
    "elk.spacing.nodeNode": String(SP[0]),
    "elk.layered.spacing.nodeNodeBetweenLayers": hasElkLabels ? String(LABEL_GAP) : String(SP[1]),
    "elk.layered.spacing.edgeNodeBetweenLayers": "24",
    "elk.spacing.edgeNode": "24",
    // labels are layout citizens (see the elkEdges map) — repeated in every
    // bag for the same reason the edge spacing is: ELK does not inherit
    "elk.edgeLabels.inline": "true",
    "elk.spacing.edgeLabel": String(LABEL_GAP),
    "elk.spacing.edgeEdge": "16",
    // spiked: MEDIAN_LAYER puts the label mid-dogleg, closest to the old
    // nine-fraction midpoint aesthetic (TAIL hugs the source, HEAD the sink)
    "elk.layered.edgeLabels.centerLabelPlacementStrategy": "MEDIAN_LAYER",
  };

  // ── hierarchical edge segments (approach #7) ─────────────────────────────
  // A directed frame is laid out by its own ELK run (SEPARATE_CHILDREN), and a
  // run cannot see ports inside another run — ELK throws
  // UnsupportedGraphException for an edge from `src` to a port on
  // `pipe.ingest`. ELK's own answer is the hierarchical port: the edge stops at
  // a port ON the frame, and a second edge, declared inside the frame,
  // continues from that port to the leaf. Every edge is cut into segments, one
  // per run it crosses; with no directed frame there is exactly one segment at
  // root, and the ELK graph is the one built before this existed.
  type Seg = { id: string; index: number; container: string; sources: string[]; targets: string[]; edge: VEdge };
  const segments: Seg[] = [];
  const framePorts = new Map<string, any[]>();
  const leafPortSide = new Map<string, Side>();
  const addFramePort = (frame: string, id: string, side: Side) => {
    if (!framePorts.has(frame)) framePorts.set(frame, []);
    framePorts.get(frame)!.push({ id, width: 0, height: 0, layoutOptions: { "elk.port.side": SIDE_UP[side] } });
  };
  /** Directed frames enclosing an endpoint, outermost first (a frame endpoint
   *  counts its ancestors only — it is its own wall). */
  const directedAncestors = (p: string): string[] => {
    const chain: string[] = [];
    for (let f = byPath.get(p)?.frame ?? frameParent.get(p); f; f = frameParent.get(f))
      if (frameDir.has(f)) chain.unshift(f);
    return chain;
  };
  const containerOf = (frame: string): string => frameParent.get(frame) ?? "root";
  // The leaf-side port of an interior segment is on the frame's own flow side
  // (WEST into a RIGHT frame). Carrying the outer side through (NORTH) made
  // the interior run 48px taller and routed the wire along the title band to
  // reach the leaf's top.
  // The wall port's side is per edge: an edge into the head of the frame's own
  // interior — a leaf nothing inside the frame feeds — enters on the frame's
  // flow side (WEST into a RIGHT row), and an edge out of its tail leaves on
  // the flow side; anything reaching a mid-chain leaf uses the outer side, so
  // the root run routes it the way it routes every other edge. Measured:
  // outer-only parked the entry at the top-left corner with 80px of dead
  // interior; flow-only looped a mid-chain exit up and over the frame.
  const inside = (p: string, f: string) => p === f || p.startsWith(`${f}.`);
  /** The direct child of frame `f` on the way to `p` — a leaf, or the nested
   *  frame holding it; interior sources/sinks are judged at that grain. */
  const childUnitIn = (f: string, p: string) => `${f}.${p.slice(f.length + 1).split(".")[0]}`;
  const isSourceIn = (f: string, p: string) => {
    const u = childUnitIn(f, p);
    return !edges.some((x) => inside(x.to, u) && inside(x.from, f) && !inside(x.from, u));
  };
  const isSinkIn = (f: string, p: string) => {
    const u = childUnitIn(f, p);
    return !edges.some((x) => inside(x.from, u) && inside(x.to, f) && !inside(x.to, u));
  };
  const wallSide = (e: VEdge, f: string, end: "from" | "to"): Side => {
    const flow = sidesIn(e, dirOf(f))[end];
    const outer = sidesIn(e, dirOf(containerOf(f)))[end];
    return (end === "to" ? isSourceIn(f, e.to) : isSinkIn(f, e.from)) ? flow : outer;
  };
  for (const e of elkEdges) {
    const cf = directedAncestors(e.from), ct = directedAncestors(e.to);
    let common = 0;
    while (common < cf.length && common < ct.length && cf[common] === ct[common]) common++;
    const container = common ? cf[common - 1] : "root";
    const fromEnd = frameLabels.has(e.from) || zoneById.has(e.from) ? e.from : `${e.id}.src`;
    const toEnd = frameLabels.has(e.to) || zoneById.has(e.to) ? e.to : `${e.id}.dst`;
    const outer = sidesIn(e, dirOf(container));
    const fromChain = cf.slice(common), toChain = ct.slice(common);
    let index = 0;
    const seg = (c: string, sources: string[], targets: string[]) => {
      const primary = c === container;
      segments.push({ id: primary ? e.id : `${e.id}~${index}`, index, container: c, sources, targets, edge: e });
      index++;
    };
    // out of the source's directed frames, innermost first
    let prev = fromEnd;
    if (fromChain.length) {
      const inner = fromChain[fromChain.length - 1];
      leafPortSide.set(`${e.id}.src`, sidesIn(e, dirOf(inner)).from);
    } else leafPortSide.set(`${e.id}.src`, outer.from);
    for (let i = fromChain.length - 1; i >= 0; i--) {
      const f = fromChain[i];
      const port = `${e.id}.out@${f}`;
      addFramePort(f, port, wallSide(e, f, "from"));
      seg(f, [prev], [port]);
      prev = port;
    }
    // the segment in the common container carries the id, label and notes
    const entryPort = toChain.length ? `${e.id}.in@${toChain[0]}` : toEnd;
    seg(container, [prev], [entryPort]);
    for (let i = 0; i < toChain.length; i++) {
      const f = toChain[i];
      const port = `${e.id}.in@${f}`;
      addFramePort(f, port, wallSide(e, f, "to"));
      const next = i + 1 < toChain.length ? `${e.id}.in@${toChain[i + 1]}` : toEnd;
      seg(f, [port], [next]);
    }
    if (toChain.length) {
      const inner = toChain[toChain.length - 1];
      leafPortSide.set(`${e.id}.dst`, sidesIn(e, dirOf(inner)).to);
    } else leafPortSide.set(`${e.id}.dst`, outer.to);
  }
  const segElk = (sg: Seg) => ({
    id: sg.id,
    sources: sg.sources,
    targets: sg.targets,
    // the primary segment carries the pill and notes; every other segment
    // carries the invisible spacer, exactly as an unlabelled edge does —
    // without it the wall-port dummy layer sits 10px from the leaf (measured:
    // four "enters after 10" stub violations on the nested probe)
    ...(hasElkLabels
      ? sg.id === sg.edge.id
        ? { labels: [labelFor(sg.edge), ...edgeNotes.filter((nt) => nt.edgeId === sg.edge.id)
            .map((nt) => ({ text: `note:${nt.i}`, width: nt.w, height: nt.h }))] }
        : { labels: [{ text: " ", width: 2, height: spacerH(true) }] }
      : {}),
  });

  // pass 1: every directed frame, deepest first, as its own ELK call
  {
    const depth = (f: string) => { let d = 0; for (let q = frameParent.get(f); q; q = frameParent.get(q)) d++; return d; };
    const directed = [...frameDir.keys()].sort((a, b) => depth(b) - depth(a) || (a < b ? -1 : a > b ? 1 : 0));
    for (const p of directed) {
      const g = frameGraph(p);
      try {
        laidOut.set(p, (await new ELK().layout(g)).children[0]);
      } catch (err) {
        throw new Error(`layout of directed frame \`${p}\` failed inside ELK: ${(err as Error).message}`);
      }
    }
  }

  const children = order.map((p) => (zoneById.has(p) ? zoneElk(zoneById.get(p)!) : entityElk(p)));
  // `forceNodeModelOrder` drags a FIXED_POS port off its wall whenever the
  // edge's other end lands earlier in the next layer (measured on a directed
  // frame: an EAST port moved to x=0 with the option on, stayed at the wall
  // with it off; no per-node or per-port option escapes it). It is a root
  // option every shipped render depends on, so it is swapped out only when a
  // directed frame is present, for the lever the interior pass already uses:
  // semi-interactive crossing minimisation with each root child's position
  // set from the model order it would have been forced to.
  const directedPresent = laidOut.size > 0;
  if (directedPresent)
    children.forEach((c, i) => {
      c.layoutOptions = { ...(c.layoutOptions ?? {}), "elk.position": flowsRight ? `(0,${i * 1000})` : `(${i * 1000},0)` };
    });
  for (const n of layerNotes)
    children.push({ id: n.id, width: n.w, height: n.h, layoutOptions: {} });

  const elkGraph = {
    id: "root",
    layoutOptions: {
      ...rootOptions,
      "elk.direction": view.layout.direction === "right" ? "RIGHT" : "DOWN",
      // A folded fan wants every band centred under its source — that is what
      // puts band 1's middle gap under the source's face for the bus spine.
      // NETWORK_SIMPLEX parks a 6-way source over the third target (any
      // position between the two median targets costs the same), and SIMPLE
      // placement centres each layer on the widest. Fans only: a folded
      // chain's short last band must stay column-aligned, which the
      // column-mate scaffolds give under NETWORK_SIMPLEX and SIMPLE undoes.
      ...(wrap?.kind === "fan" ? { "elk.layered.nodePlacement.strategy": "SIMPLE" } : {}),
      "elk.padding": "[top=32,left=32,bottom=32,right=32]",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      ...(directedPresent
        ? {
            "elk.layered.crossingMinimization.forceNodeModelOrder": "false",
            "elk.layered.crossingMinimization.semiInteractive": "true",
          }
        : {}),
    },
    children,
    edges: [
      // Ports live on leaves. An endpoint that is an expanded frame (or a zone)
      // has none, so attach to the compound itself — otherwise ELK is handed a
      // port id that does not exist and throws a raw JsonImportException,
      // which is exactly the un-actionable failure CLAUDE.md forbids.
      ...segments.filter((sg) => sg.container === "root").map((sg) => ({
        id: sg.id,
        sources: sg.sources,
        targets: sg.targets,
        // Label space is reserved by the layout, not scavenged after it — but
        // an inline label dummy costs a whole extra layer at full spacing
        // (spiked: 56 → 130 for one 18px label), which read as giant gaps at
        // review. So the spacing is inverted: between-layers drops to 16 and
        // EVERY edge carries a label — real ones sized for their pill,
        // unlabelled ones an invisible spacer — so labelled and unlabelled
        // gaps come out at exactly the density spacing, and the pill lands
        // centred on its own wire, which is where pills always sat. The label
        // no longer costs anything; it just cannot be collided with.
        ...(hasElkLabels && sg.id === sg.edge.id
          ? { labels: [labelFor(sg.edge), ...edgeNotes.filter((n) => n.edgeId === sg.edge.id)
              .map((n) => ({ text: `note:${n.i}`, width: n.w, height: n.h }))] }
          : {}),
      })),
      ...scaffold.map((s) => ({ id: s.id, sources: [s.from], targets: [s.to], ...(hasElkLabels ? { labels: [{ text: " ", width: 2, height: spacerH(false) }] } : {}) })),
      // interior scaffolds live in a frame, so their spacer is the frame's
      ...innerScaffold.map((s) => ({ id: s.id, sources: [s.from], targets: [s.to], ...(hasElkLabels ? { labels: [{ text: " ", width: 2, height: spacerH(true) }] } : {}) })),
      ...layerNotes.map((n) => ({
        id: `noteedge.${n.i}`,
        sources: [n.above ? n.id : n.anchor],
        targets: [n.above ? n.anchor : n.id],
        ...(hasElkLabels ? { labels: [{ text: " ", width: 2, height: spacerH(false) }] } : {}),
      })),
    ],
  };

  let out: any;
  try {
    out = await new ELK().layout(elkGraph as any);
  } catch (err) {
    throw new Error(`layout of view \`${view.name}\` failed inside ELK: ${(err as Error).message}`);
  }
  const q = Math.round;

  // recursive extraction: compound (zone/frame) children carry parent-relative
  // coords
  const nodes: PNode[] = [];
  const frames: PFrame[] = [];
  const pZones: PZone[] = [];
  const ports: PPort[] = [];
  /** Where ELK put the folded fan's reserved bus port on its source. */
  let busPort: { x: number; y: number } | undefined;
  // ELK reports each edge in the coordinate system of its `container` node —
  // for edges living fully inside an expanded frame, that's the frame, so we
  // need every compound's absolute origin to translate them.
  const containerOffset = new Map<string, { x: number; y: number }>([["root", { x: 0, y: 0 }]]);
  const walk = (c: any, ox: number, oy: number, depth = 0) => {
    const x = q(ox + c.x), y = q(oy + c.y);
    if (zoneById.has(c.id)) {
      const z = zoneById.get(c.id)!;
      pZones.push({
        id: z.id, label: z.label, kind: z.kind, icon: z.icon, labelPos: z.labelPos,
        color: z.color, detail: z.detail,
        x, y, w: q(c.width), h: q(c.height), depth,
      });
      containerOffset.set(c.id, { x, y });
      for (const child of c.children ?? []) walk(child, x, y, depth + 1);
      return;
    }
    if (frameLabels.has(c.id)) {
      // depth counts the frame chain, not the walk's compound nesting — a
      // frame inside a zone is still depth 0, and keeps the recessed fill
      let fd = 0;
      for (let p = frameParent.get(c.id); p; p = frameParent.get(p)) fd++;
      frames.push({
        path: c.id, label: frameLabels.get(c.id)!, x, y, w: q(c.width), h: q(c.height), depth: fd,
        color: frameColors.get(c.id),
      });
      // a directed frame's wall ports are ports like any leaf's: the router's
      // free-port probe and the ports-never-stack invariant must see them
      for (const p of c.ports ?? [])
        ports.push({
          edge: p.id.replace(/\.(out|in)@.*$/, ""),
          node: c.id,
          side: SIDE_DOWN[p.layoutOptions?.["elk.port.side"] ?? "SOUTH"],
          x: q(x + p.x),
          y: q(y + p.y),
        });
      containerOffset.set(c.id, { x, y });
      // a directed frame came back as a leaf: its interior is the output of
      // its own call, in the frame's coordinate system
      const interior = laidOut.get(c.id)?.children ?? c.children ?? [];
      for (const child of interior) walk(child, x, y, depth + 1);
      return;
    }
    nodes.push({
      ...byPath.get(c.id)!,
      x, y, w: q(c.width), h: q(c.height),
      // unitOf, not entityOf: rank is keyed by unit, and for a *zoned* leaf the
      // entity is the leaf itself — entityOf handed every zoned node
      // `rank: undefined`, which made the router's blocker test treat all of
      // them as one rank and route coplanar wires straight through zones.
      rank: rank.get(unitOf(c.id))!,
    });
    for (const p of c.ports ?? []) {
      if (p.id.startsWith("scaffold.")) continue;
      if (reservedPorts.has(p.id)) { busPort = { x: q(x + p.x), y: q(y + p.y) }; continue; }
      ports.push({
        edge: p.id.replace(/\.(src|dst)$/, ""),
        node: c.id,
        side: SIDE_DOWN[p.layoutOptions?.["elk.port.side"] ?? "SOUTH"],
        x: q(x + p.x),
        y: q(y + p.y),
      });
    }
  };
  const noteBoxes = new Map<number, { x: number; y: number; w: number; h: number }>();
  for (const c of out.children) {
    if (c.id?.startsWith("note:")) {
      noteBoxes.set(+c.id.slice(5), { x: q(c.x), y: q(c.y), w: q(c.width), h: q(c.height) });
      continue;
    }
    walk(c, 0, 0);
  }
  const nodeById = new Map(nodes.map((n) => [n.path, n]));

  // a directed frame's segments come back inside the frame's own `edges`
  const allOutEdges: any[] = [];
  const gatherEdges = (c: any, home: string) => {
    for (const e of c.edges ?? []) allOutEdges.push({ ...e, container: e.container ?? home });
    for (const ch of c.children ?? []) gatherEdges(ch, ch.id);
  };
  gatherEdges(out, "root");
  for (const [p, o] of laidOut) gatherEdges(o, p);
  const elkPositioned = new Map<string, PEdge>(
    allOutEdges
      .filter((e: any) => !e.id.startsWith("scaffold.") && !e.id.startsWith("noteedge."))
      .map((e: any) => {
        const s = e.sections[0];
        const off = containerOffset.get(e.container ?? "root") ?? { x: 0, y: 0 };
        const pts = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map(
          (p: any) => ({ x: q(p.x + off.x), y: q(p.y + off.y) }),
        );
        const m = edges.find((me) => me.id === e.id.replace(/~\d+$/, ""))!;
        const noteLabels = (e.labels ?? []).filter((l: any) => String(l.text).startsWith("note:"));
        for (const l of noteLabels)
          noteBoxes.set(+String(l.text).slice(5), { x: q(l.x + off.x), y: q(l.y + off.y), w: q(l.width), h: q(l.height) });
        const lab = (e.labels ?? []).find((l: any) => !String(l.text).startsWith("note:"));
        const labelRect = lab
          ? { x: q(lab.x + off.x), y: q(lab.y + off.y), w: q(lab.width), h: q(lab.height) }
          : undefined;
        return [e.id, { id: e.id, from: m.from, to: m.to, label: m.label, async: m.async, animate: m.animate, style: m.style, count: m.count, tags: m.tags, color: m.color, heads: m.heads, points: pts, labelRect }];
      }),
  );

  // stitch each cut edge back into one polyline — segments meet at the
  // wall port, so the join point appears twice and a straight run through the
  // wall appears as three collinear points; both are dropped
  for (const e of edges) {
    const segs = segments.filter((sg) => sg.edge.id === e.id);
    if (segs.length <= 1) continue;
    const primary = elkPositioned.get(e.id);
    if (!primary) continue;
    const raw = segs.sort((a, b) => a.index - b.index)
      .flatMap((sg) => elkPositioned.get(sg.id)?.points ?? []);
    const pts: { x: number; y: number }[] = [];
    for (const pnt of raw) {
      const last = pts[pts.length - 1];
      if (last && last.x === pnt.x && last.y === pnt.y) continue;
      const prev = pts[pts.length - 2];
      if (last && prev && ((prev.x === last.x && last.x === pnt.x) || (prev.y === last.y && last.y === pnt.y))) pts.pop();
      pts.push(pnt);
    }
    elkPositioned.set(e.id, { ...primary, points: pts });
    for (const sg of segs) if (sg.id !== e.id) elkPositioned.delete(sg.id);
  }

  // ── coplanar router (ours): adjacent → straight; blocked → side-band ─────
  // Blocked edges of one rank share the band beside it, but never a lane when
  // their spans overlap: greedy interval packing, declaration order
  // (deterministic), 16px between lanes.
  //
  // Written along the rank rather than along x. A rank is a *row* under
  // `direction down` and a *column* under `direction right`, so the whole
  // router transposes: `along` is the axis nodes are spread on within a rank,
  // `cross` is the one the ranks advance on, and the band sits past the rank's
  // far edge on the cross axis. Under `down` this is exactly the old code —
  // along = x, cross = y, band below — and must stay byte-identical.
  const along = flowsRight ? "y" : "x";
  const cross = flowsRight ? "x" : "y";
  const alongSize = flowsRight ? "h" : "w";
  const crossSize = flowsRight ? "w" : "h";
  /** A point from (along, cross) coordinates, in the axis order SVG wants. */
  const pt = (a: number, c: number) => (flowsRight ? { x: c, y: a } : { x: a, y: c });
  /** The side an edge leaves on: past the rank's far edge, on the cross axis. */
  const bandSide: Side = flowsRight ? "east" : "south";
  const lowSide: Side = flowsRight ? "north" : "west";
  const highSide: Side = flowsRight ? "south" : "east";

  // DESIGN §4: edges on one side spread at even offsets, never stacked at a
  // point. ELK spreads the ports it owns, but it never sees a coplanar edge —
  // that route is ours and is added after ELK has finished — so a node with one
  // of each kind gets two ports on the same side at the same coordinate. A cold
  // agent hit it the first time one appeared: `email_handler ~> sns` crosses a
  // rank (ELK's) and `email_handler ~> dlq` stays in it (ours), and both left
  // the south face at the node's centre.
  //
  // Keep the natural centre when it is free and step along the side only when
  // it is not, so every diagram without a collision is byte-identical. Which
  // axis a side runs along is geometry, not direction: north/south run in x,
  // east/west in y, whichever way the diagram flows.
  const SIDE_AXIS = { north: "x", south: "x", east: "y", west: "y" } as const;
  const AXIS_SIZE = { x: "w", y: "h" } as const;
  const freePort = (n: { path: string; x: number; y: number; w: number; h: number }, side: Side, want: number): number => {
    const ax = SIDE_AXIS[side];
    const taken = ports.filter((p) => p.node === n.path && p.side === side).map((p) => p[ax]);
    const clear = (c: number) => taken.every((t) => Math.abs(t - c) >= 16);
    if (clear(want)) return want;
    // 8 of margin keeps the stub off the node's own rounded corner
    const [lo, hi] = [n[ax] + 8, n[ax] + n[AXIS_SIZE[ax]] - 8];
    for (let step = 16; step <= n[AXIS_SIZE[ax]]; step += 16)
      for (const c of [want + step, want - step])
        if (c >= lo && c <= hi && clear(c)) return c;
    return want; // a face with nowhere left to go: draw it rather than not
  };
  // Only the go-around branch uses this. The straight branch puts both ends at
  // the same cross-coordinate *because* the line is straight, so moving one end
  // would have to move the other and could not always — and two straight
  // coplanar edges cannot collide anyway: a second target on the same side is
  // either blocked by the first or overlapping it.

  // Routing rects: a bare leaf routes by its own rect; a leaf inside a unit
  // (or a frame endpoint) routes by its *outermost* unit's rect — frame or
  // zone — and the interior stays ELK's on both axes (coplanar.md, #5).
  type RRect = { path: string; x: number; y: number; w: number; h: number };
  const frameByPath = new Map<string, RRect>(frames.map((f) => [f.path, f]));
  const zoneRectById = new Map<string, RRect>(pZones.map((z) => [z.id, { path: z.id, ...z }]));
  // a frame or zone is its own unit, so try those rects first — the leaf
  // branch is only for endpoints that are genuinely bare nodes
  const routeRect = (p: string): RRect =>
    frameByPath.get(unitOf(p)) ?? zoneRectById.get(unitOf(p)) ?? nodeById.get(p)!;
  /** Every unit's rect on a rank — the obstacle set for blockedness. Unlike
   *  the old leaf-only scan this sees frames and zones too, so a coplanar
   *  wire no longer threads straight through a boundary it never noticed. */
  const unitRect = (u: string): RRect | undefined =>
    frameByPath.get(u) ?? zoneRectById.get(u) ?? nodeById.get(u);
  const edgeRank = (e: VEdge) => rank.get(unitOf(e.from))!;
  const blockedBy = (e: VEdge, a: RRect, b: RRect): boolean => {
    const [l, r] = a[along] <= b[along] ? [a, b] : [b, a];
    return units.some((u) => {
      if (u === unitOf(e.from) || u === unitOf(e.to)) return false;
      if (rank.get(u) !== edgeRank(e)) return false;
      const rect = unitRect(u);
      return !!rect && rect[along] > l[along] && rect[along] < r[along];
    });
  };

  const laneOf = new Map<string, number>();
  const lanesByRank = new Map<number, { lo: number; hi: number }[][]>();
  for (const e of coplanar) {
    const a = routeRect(e.from);
    const b = routeRect(e.to);
    if (!blockedBy(e, a, b)) continue;
    const span = {
      lo: Math.min(a[along] + a[alongSize] / 2, b[along] + b[alongSize] / 2),
      hi: Math.max(a[along] + a[alongSize] / 2, b[along] + b[alongSize] / 2),
    };
    const lanes = lanesByRank.get(edgeRank(e)) ?? [];
    let li = lanes.findIndex((spans) => spans.every((sp) => span.hi + 16 <= sp.lo || span.lo >= sp.hi + 16));
    if (li === -1) { li = lanes.length; lanes.push([]); }
    lanes[li].push(span);
    lanesByRank.set(edgeRank(e), lanes);
    laneOf.set(e.id, li);
  }

  const coplanarEdges: PEdge[] = coplanar.map((e) => {
    const a = routeRect(e.from);
    const b = routeRect(e.to);
    const blocked = blockedBy(e, a, b);
    const midCross = (n: RRect) => n[cross] + Math.round(n[crossSize] / 2);
    /** The cross-coordinate the wire wants at an endpoint: the interior leaf's
     *  own height, so the entry sits beside it, clamped into its unit's rect.
     *  Approach #5 clamped into the pair's *shared* band so a straight run could
     *  not miss the other rect; the jog handles any pair of heights, and the
     *  shared clamp is what parked an entry away from a low leaf and stopped
     *  the corridor below from ever reaching it. */
    const wantCross = (p: string, own: RRect): number => {
      const leaf = byPath.has(p) ? nodeById.get(p) : undefined;
      const raw = leaf ? midCross(leaf) : midCross(own);
      return Math.min(Math.max(raw, own[cross] + 12), own[cross] + own[crossSize] - 12);
    };
    /** Approach #6: walk a unit-wall entry inward to the leaf's own wall when
     *  the straight corridor between them is provably empty — no node but the
     *  leaf, no frame that does not enclose it, ±16 on the cross axis. Zone
     *  boundaries are not obstacles; ELK's wires cross them too. The port then
     *  sits on the leaf's face, so parallel wires spread *there* rather than
     *  converging on one point after the wall. Anything else keeps the wall as
     *  the end, exactly as approach #5 drew it — the wire never jogs inside a
     *  compound, that interior is ELK's. */
    const inward = (p: string, unit: RRect, side: Side, want: number) => {
      const wallOf = (r: RRect) => (side === highSide ? r[along] + r[alongSize] : r[along]);
      const atWall = () => {
        const c = freePort(unit, side, want);
        return { c, end: pt(wallOf(unit), c), node: unit.path };
      };
      const leaf = byPath.has(p) ? nodeById.get(p) : undefined;
      if (!leaf || leaf.path === unit.path) return atWall();
      const lo = Math.min(wallOf(unit), wallOf(leaf)), hi = Math.max(wallOf(unit), wallOf(leaf));
      const clear = (c: number) => {
        if (c < leaf[cross] + 8 || c > leaf[cross] + leaf[crossSize] - 8) return false;
        const hit = (r: { x: number; y: number; w: number; h: number }) =>
          r[along] < hi && r[along] + r[alongSize] > lo && r[cross] - 16 < c && r[cross] + r[crossSize] + 16 > c;
        return (
          !nodes.some((n) => n.path !== leaf.path && hit(n)) &&
          !frames.some((f) => !leaf.path.startsWith(`${f.path}.`) && hit(f))
        );
      };
      if (!clear(want)) return atWall();
      const c = freePort(leaf, side, want);
      if (!clear(c)) return atWall();
      return { c, end: pt(wallOf(leaf), c), node: leaf.path };
    };
    const carry = { label: e.label, async: e.async, animate: e.animate, style: e.style, count: e.count, tags: e.tags, color: e.color, heads: e.heads };
    // The router owns coplanar geometry, so it reserves and reports
    // label space the same way ELK does for cross-rank edges — labelRect is
    // where the pill draws, no search. Straight runs got their gutter widened
    // at graph build (elk.spacing.individual); lanes are below the band where
    // width is free.
    const rectOnRun = (alo: number, ahi: number, c: number) => {
      if (!e.label) return undefined;
      const bw = badgeW(e.id);
      // one rect for pill + badge, exactly as the ELK path reserves it
      const w = pillDims(e.label, font).w + (bw ? bw + BADGE_GAP : 0);
      const mid = Math.round((alo + ahi) / 2);
      const r = pt(mid - Math.round(w / 2), c - 9);
      return { x: r.x, y: r.y, ...(flowsRight ? { w: 18, h: w } : { w, h: 18 }) };
    };
    const bothBare = unitOf(e.from) === e.from && unitOf(e.to) === e.to;
    if (!blocked && bothBare) {
      // the pre-frames straight path, byte-for-byte: same-rank sibling leaves
      // share a cross-centre, the line is straight *because* both ends sit at
      // a's centre, and it never consults freePort (see the comment above it —
      // straight pairs cannot collide, and a port probe here could nudge an
      // existing diagram into a jog it never had)
      const c = midCross(a);
      const first = a[along] <= b[along];
      const pts = first
        ? [pt(a[along] + a[alongSize], c), pt(b[along], c)]
        : [pt(a[along], c), pt(b[along] + b[alongSize], c)];
      const labelRect = first
        ? rectOnRun(a[along] + a[alongSize], b[along], c)
        : rectOnRun(b[along] + b[alongSize], a[along], c);
      ports.push(
        { edge: e.id, node: a.path, side: first ? highSide : lowSide, x: pts[0].x, y: pts[0].y },
        { edge: e.id, node: b.path, side: first ? lowSide : highSide, x: pts[1].x, y: pts[1].y },
      );
      return { id: e.id, from: e.from, to: e.to, ...carry, points: pts, labelRect, coplanar: true as const };
    }
    if (!blocked) {
      const first = a[along] <= b[along];
      const [aSide, bSide]: [Side, Side] = first ? [highSide, lowSide] : [lowSide, highSide];
      // freePort spreads parallel entries 16 apart on whichever face the wire
      // ends on; when both entries stay put and agree, the run is straight —
      // otherwise it jogs at mid-gutter, which also gives every stub
      // gutter/2 ≥ 24 of clearance. The pill always sits on the gutter run,
      // between the two unit walls, whether or not the ends reached inward.
      const ia = inward(e.from, a, aSide, wantCross(e.from, a));
      const ib = inward(e.to, b, bSide, wantCross(e.to, b));
      const [aC, bC] = [ia.c, ib.c];
      const aWall = first ? a[along] + a[alongSize] : a[along];
      const bWall = first ? b[along] : b[along] + b[alongSize];
      if (aC === bC) {
        const pts = [ia.end, ib.end];
        const labelRect = rectOnRun(Math.min(aWall, bWall), Math.max(aWall, bWall), aC);
        ports.push(
          { edge: e.id, node: ia.node, side: aSide, x: pts[0].x, y: pts[0].y },
          { edge: e.id, node: ib.node, side: bSide, x: pts[1].x, y: pts[1].y },
        );
        return { id: e.id, from: e.from, to: e.to, ...carry, points: pts, labelRect, coplanar: true as const };
      }
      // jog: 4-point Z at mid-gutter — the pill sits on the crossing segment
      const mid = Math.round((Math.min(aWall, bWall) + Math.max(aWall, bWall)) / 2);
      const pts = [ia.end, pt(mid, aC), pt(mid, bC), ib.end];
      const labelRect = e.label
        ? (() => {
            const bw = badgeW(e.id);
            const w = pillDims(e.label!, font).w + (bw ? bw + BADGE_GAP : 0);
            const c = Math.round((aC + bC) / 2);
            const r = pt(mid - Math.round(w / 2), c - 9);
            return { x: r.x, y: r.y, ...(flowsRight ? { w: 18, h: w } : { w, h: 18 }) };
          })()
        : undefined;
      ports.push(
        { edge: e.id, node: ia.node, side: aSide, x: pts[0].x, y: pts[0].y },
        { edge: e.id, node: ib.node, side: bSide, x: pts[3].x, y: pts[3].y },
      );
      return { id: e.id, from: e.from, to: e.to, ...carry, points: pts, labelRect, coplanar: true as const };
    }
    // shelf: past the rank's far edge on the cross axis, measured over every
    // unit rect on the rank — a frame's border, not the leaves inside it
    const bandEdge = Math.max(
      ...units.filter((u) => rank.get(u) === edgeRank(e)).map((u) => unitRect(u))
        .filter((r): r is RRect => !!r).map((r) => r[cross] + r[crossSize]),
    );
    // 28 not 16 when lanes carry labels: a pill is 18 tall, and two labelled
    // lanes at the old pitch would overlap by 2px before margins
    const lanePitch = coplanar.some((c) => c.label && laneOf.has(c.id)) ? 28 : 16;
    const lane = bandEdge + 24 + (laneOf.get(e.id) ?? 0) * lanePitch;
    // exit at the interior leaf's along-centre where there is one, so the drop
    // reads as belonging to the thing it serves
    const wantAlong = (p: string, own: RRect) => {
      const leaf = byPath.has(p) ? nodeById.get(p) : undefined;
      const raw = leaf ? leaf[along] + Math.round(leaf[alongSize] / 2) : own[along] + Math.round(own[alongSize] / 2);
      return Math.min(Math.max(raw, own[along] + 8), own[along] + own[alongSize] - 8);
    };
    const aA = freePort(a, bandSide, wantAlong(e.from, a));
    const bA = freePort(b, bandSide, wantAlong(e.to, b));
    const pts = [
      pt(aA, a[cross] + a[crossSize]), pt(aA, lane),
      pt(bA, lane), pt(bA, b[cross] + b[crossSize]),
    ];
    ports.push(
      { edge: e.id, node: a.path, side: bandSide, x: pts[0].x, y: pts[0].y },
      { edge: e.id, node: b.path, side: bandSide, x: pts[3].x, y: pts[3].y },
    );
    return {
      id: e.id, from: e.from, to: e.to, ...carry, points: pts,
      labelRect: rectOnRun(Math.min(aA, bA), Math.max(aA, bA), lane),
      coplanar: true as const,
    };
  });

  // ── bus router (PoC, `wrap` on a fan-out): one spine, one trunk per band ─
  // The source's edges into every band past the first share a spine that
  // drops through band 1's middle gap (even N has one exactly under a centred
  // source; odd N, or a gap ELK did not leave clear, falls back to a lane
  // outside the widest band), a trunk in the gutter above each band, and a
  // drop into each target. Same geometry `channel` draws, mirrored: there the
  // sources merge into a target, here one source spreads to a band. The wires
  // carry `coplanar: true` so the invariant sweep holds them to crossing
  // nothing — the flag names the router, not the rank relation.
  const busEdges: PEdge[] = [];
  if (wrap?.kind === "fan" && bus.length) {
    const g = nodeById.get(wrap.source!)!;
    const entrySide: Side = flowsRight ? "west" : "north";
    const rectsOf = (i: number) =>
      wrap!.bands[i].map((p) => nodeById.get(p)!).sort((a, b) => a[along] - b[along]);
    const b1 = rectsOf(1);
    const li = Math.ceil(b1.length / 2) - 1; // even N: the middle gap; odd N: right of the middle card
    const gapMid = Math.round((b1[li][along] + b1[li][alongSize] + b1[li + 1][along]) / 2);
    const lastBand = Math.max(...bus.map((e) => wrapBand.get(e.to)!));
    const trunkOf = new Map<number, number>();
    for (let i = 2; i <= lastBand; i++) {
      const above = Math.max(...rectsOf(i - 1).map((r) => r[cross] + r[crossSize]));
      const below = Math.min(...rectsOf(i).map((r) => r[cross]));
      trunkOf.set(i, Math.round((above + below) / 2));
    }
    const deepest = trunkOf.get(lastBand)!;
    // The spine shares the source's face with ELK's own fan stubs, and nothing
    // reserved it there — so "inside" is a proven property, not a hope: sit
    // midway between the two ELK ports that straddle the gap (the fan's stubs
    // then split around it), inside the gap, on the face, ≥12 from every
    // port, through a corridor with no node in it, and crossed by no ELK
    // segment. Anything less takes the outside lane.
    const facePorts = ports.filter((p) => p.node === g.path && p.side === bandSide).map((p) => p[along]).sort((a, b) => a - b);
    const leftPort = facePorts.filter((c) => c < gapMid).at(-1);
    const rightPort = facePorts.find((c) => c > gapMid);
    const straddle = leftPort !== undefined && rightPort !== undefined ? Math.round((leftPort + rightPort) / 2) : gapMid;
    // prefer the port ELK reserved when it landed in the gap; the straddle
    // midpoint is the fallback for when ELK parked it at an end of the face
    const reserved = busPort?.[along];
    const spine = reserved !== undefined && Math.abs(reserved - gapMid) <= Math.abs(straddle - gapMid) ? reserved : straddle;
    const inGap = spine >= b1[li][along] + b1[li][alongSize] + 8 && spine <= b1[li + 1][along] - 8;
    const onFace = spine >= g[along] + 8 && spine <= g[along] + g[alongSize] - 8;
    const portClear = facePorts.every((c) => Math.abs(c - spine) >= 12);
    const corridorClear = !nodes.some((r) =>
      r.path !== g.path &&
      r[along] - 16 < spine && r[along] + r[alongSize] + 16 > spine &&
      r[cross] < deepest && r[cross] + r[crossSize] > g[cross] + g[crossSize]);
    const crossed = [...elkPositioned.values()].some((e) =>
      e.points.some((p, i) => {
        if (!i) return false;
        const q = e.points[i - 1];
        if (p[cross] !== q[cross]) return false; // only runs across the spine can cross it
        const lo = Math.min(p[along], q[along]), hi = Math.max(p[along], q[along]);
        return lo < spine && hi > spine && p[cross] > g[cross] + g[crossSize] && p[cross] < deepest;
      }));
    const inside = inGap && onFace && portClear && corridorClear && !crossed;
    // outside lane: past the widest band, at gutter distance
    const lane = Math.max(...nodes.map((r) => r[along] + r[alongSize])) + 48;
    const start = inside
      ? pt(spine, g[cross] + g[crossSize])
      : pt(g[along] + g[alongSize], freePort(g, highSide, g[cross] + Math.round(g[crossSize] / 2)));
    const spineAlong = inside ? spine : lane;
    for (const e of bus) {
      const t = nodeById.get(e.to)!;
      const trunk = trunkOf.get(wrapBand.get(e.to)!)!;
      const tc = t[along] + Math.round(t[alongSize] / 2);
      const pts = inside
        ? tc === spineAlong
          ? [start, pt(tc, t[cross])]
          : [start, pt(spineAlong, trunk), pt(tc, trunk), pt(tc, t[cross])]
        : [start, pt(spineAlong, flowsRight ? start.x : start.y), pt(spineAlong, trunk), pt(tc, trunk), pt(tc, t[cross])];
      const carry = { label: e.label, async: e.async, animate: e.animate, style: e.style, count: e.count, tags: e.tags, color: e.color, heads: e.heads };
      const labelRect = e.label
        ? (() => {
            const bw = badgeW(e.id);
            const w = pillDims(e.label!, font).w + (bw ? bw + BADGE_GAP : 0);
            const r = pt(tc - Math.round(w / 2), trunk - 9);
            return { x: r.x, y: r.y, ...(flowsRight ? { w: 18, h: w } : { w, h: 18 }) };
          })()
        : undefined;
      ports.push(
        { edge: e.id, node: g.path, side: inside ? bandSide : highSide, x: start.x, y: start.y },
        { edge: e.id, node: t.path, side: entrySide, x: pts[pts.length - 1].x, y: pts[pts.length - 1].y },
      );
      busEdges.push({ id: e.id, from: e.from, to: e.to, ...carry, points: pts, labelRect, coplanar: true as const, via: "bus" as const });
    }
  }

  const coplanarById = new Map([...coplanarEdges, ...busEdges].map((e) => [e.id, e]));
  const pEdges: PEdge[] = edges.map((e) => elkPositioned.get(e.id) ?? coplanarById.get(e.id)!);

  // ── annotation pass: chips and badges are layout citizens ────────────────
  // Moved verbatim from svg.ts (Positioned consolidation): placement is
  // geometry, geometry belongs here, and checkLayout can only assert what
  // Positioned carries. Order is the obstacle registry, as ever: pills
  // (labelRects) exist, then chips avoid them, then badges avoid both, and the
  // notes resolver downstream sees all three.
  // Carve each badge out of the left (or top) of the rect reserved for it, and
  // hand the remainder back as the pill's own rect — so everything downstream,
  // including the renderer, sees a labelRect that means "the pill draws here"
  // and nothing has to know a badge was ever involved.
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
  const hitR = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }, m = 4) =>
    a.x < b.x + b.w + m && a.x + a.w + m > b.x && a.y < b.y + b.h + m && a.y + a.h + m > b.y;

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


  // ── channels (SPEC §6 Tier 2): one trunk instead of N crossing lines ─────
  // Several edges into the same target drop to a shared horizontal trunk,
  // run along it, and enter the target as one line. Ours to compute: ELK
  // routes each edge independently and has no notion of a bus.
  for (const ch of view.layout.channels) {
    const target = nodes.find((n) => n.path === ch.target);
    const members = ch.sources
      .map((src) => ({
        src,
        node: nodes.find((n) => n.path === src),
        edge: pEdges.find((e) => e.from === src && e.to === ch.target),
      }))
      .filter((m) => m.node && m.edge);
    if (!target || members.length < 2) {
      diagnostics.push({
        severity: "warning",
        message: `channel into \`${ch.target}\`: ${
          !target ? "the target is not visible here" : "fewer than two of its edges are"
        }`,
        fix: "channels only apply where every member edge is visible in the view",
        loc: ch.loc,
      });
      continue;
    }
    // the trunk sits between the sources' lowest edge and the target
    const lowest = Math.max(...members.map((m) => m.node!.y + m.node!.h));
    const trunkY = Math.round((lowest + target.y) / 2);
    if (trunkY <= lowest || trunkY >= target.y) {
      diagnostics.push({
        severity: "warning",
        message: `channel into \`${ch.target}\` has no room for a trunk`,
        fix: "the sources must sit above the target — check `rows`",
        loc: ch.loc,
      });
      continue;
    }
    const entryX = target.x + Math.round(target.w / 2);
    for (const m of members) {
      const sx = m.node!.x + Math.round(m.node!.w / 2);
      m.edge!.points = [
        { x: sx, y: m.node!.y + m.node!.h },
        { x: sx, y: trunkY },
        { x: entryX, y: trunkY },
        { x: entryX, y: target.y },
      ];
      // ports move with the geometry, so labels and badges follow the wire
      for (const port of ports)
        if (port.edge === m.edge!.id)
          Object.assign(port, port.node === ch.target
            ? { x: entryX, y: target.y, side: "north" as Side }
            : { x: sx, y: m.node!.y + m.node!.h, side: "south" as Side });
    }
  }

  // ── align (SPEC §6): an exact shared axis ─────────────────────────────────
  // ELK gets within ~7px and no further (spiked: scaffold edges,
  // favorStraightEdges and straightness priority all plateau there), and
  // "almost aligned" is precisely what DESIGN §1.4 forbids — so the final
  // snap is ours, same boundary as the coplanar router. The first-listed
  // element is the anchor; the rest move onto its axis.
  // a column is an align group: its members share one exact vertical axis
  // `cols` is implemented as an align group, but the author wrote `cols` — the
  // warnings below have to say the word that is actually in their file.
  const alignGroups = [
    ...view.layout.align.map((g) => ({ ...g, from: "align" as const })),
    ...(view.layout.cols ?? [])
      .filter((c) => c.length > 1)
      .map((nodes) => ({ nodes, loc: view.loc, from: "cols" as const })),
  ];
  if (alignGroups.length) {
    const axis: "x" | "y" = view.layout.direction === "right" ? "y" : "x";
    const cross: "x" | "y" = axis === "x" ? "y" : "x";
    const span = axis === "x" ? "w" : "h";
    const nodeByPath = new Map(nodes.map((n) => [n.path, n]));
    const centre = (n: PNode) => n[axis] + Math.round(n[span] / 2);

    /** Shift the run of points anchored at one end of an edge. */
    const shiftEnd = (e: PEdge, atStart: boolean, d: number) => {
      const pts = e.points;
      const endVal = atStart ? pts[0][axis] : pts[pts.length - 1][axis];
      let run = 0;
      while (
        run < pts.length &&
        (atStart ? pts[run] : pts[pts.length - 1 - run])[axis] === endVal
      ) run++;
      if (run >= pts.length) {
        // a dead-straight edge: it must gain a jog, or it would go diagonal
        const a = atStart ? pts[0] : pts[pts.length - 1];
        const b = atStart ? pts[pts.length - 1] : pts[0];
        const mid = Math.round((a[cross] + b[cross]) / 2);
        const mk = (av: number, cv: number) =>
          (axis === "x" ? { x: av, y: cv } : { x: cv, y: av });
        const moved = [
          mk(a[axis] + d, a[cross]), mk(a[axis] + d, mid),
          mk(b[axis], mid), mk(b[axis], b[cross]),
        ];
        e.points = atStart ? moved : moved.reverse();
        return;
      }
      for (let i = 0; i < run; i++) {
        const pt = atStart ? pts[i] : pts[pts.length - 1 - i];
        pt[axis] += d;
      }
    };

    for (const group of alignGroups) {
      const anchor = nodeByPath.get(group.nodes[0]);
      if (!anchor) continue;
      const target = centre(anchor);
      // Round 13 finding. A cold agent asked for six collectors side by side in
      // the first column of a left-to-right flow and wrote `cols [c1 … c6]` —
      // reasonable, since on screen that *is* a column. But those six are
      // siblings on one rank, so no two of them can share an axis, and the
      // result was six near-identical warnings, none of which named the fix.
      // One mistake, one diagnostic, and it says which construct to reach for.
      const members = group.nodes.map((q) => nodeByPath.get(q)).filter(Boolean) as PNode[];
      // `rank` is the *unit's* rank, so two leaves inside one expanded frame
      // always share it whatever ELK layered them on — the "same rank" verdict
      // below was a lie for them, and its fix (`rows [a b]`) would have put
      // side by side two nodes that may well sit one above the other. Framed
      // members fall through to the loop, which names the real reason.
      if (members.length === group.nodes.length && members.length > 1
          && members.every((m) => m.rank === members[0].rank)
          && !members.some((m) => m.frame)) {
        const list = group.nodes.join(" ");
        diagnostics.push({
          severity: "warning",
          message: `${group.from} \`[${list}]\` — all ${members.length} sit on the same rank, so they cannot share an axis`,
          fix: `to put them side by side write \`rows [${list}]\`; \`${group.from}\` stacks nodes *across* ranks`,
          loc: group.loc,
        });
        continue;
      }
      for (const path of group.nodes.slice(1)) {
        const n = nodeByPath.get(path);
        if (!n) continue;
        const d = target - centre(n);
        if (d === 0) continue;
        if (byPath.get(path)?.frame) {
          // Two fixes for two situations: aligning across the frame wall means
          // "align the frame", but aligning two members of one frame means the
          // snap simply does not reach inside yet — `rows` orders them there.
          const within = byPath.get(path)!.frame === anchor.frame;
          diagnostics.push({
            severity: "warning",
            message: `${group.from} skipped \`${path}\` — it sits inside an expanded container` +
              (within ? `, and ${group.from} does not reach inside \`${entityOf(path)}\`` : ""),
            fix: within
              ? `\`rows\` and \`place\` order members inside an expanded container; or drop the expand in this view`
              : `align the container itself, or drop the expand in this view`,
            loc: group.loc,
          });
          continue;
        }
        // never create an overlap to satisfy a hint
        const moved = { ...n, [axis]: n[axis] + d } as PNode;
        // Zone frames are sized by ELK, long before this pass moves anything,
        // so an unchecked snap can leave a member drawn outside the boundary
        // that is supposed to contain it — the diagram then asserts something
        // false, silently, with check exiting 0. Purely geometric: whatever
        // encloses the node now must still enclose it after.
        const encloses = (z: PZone, m: { x: number; y: number; w: number; h: number }) =>
          m.x >= z.x && m.y >= z.y && m.x + m.w <= z.x + z.w && m.y + m.h <= z.y + z.h;
        const escaped = pZones.find((z) => encloses(z, n) && !encloses(z, moved));
        if (escaped) {
          diagnostics.push({
            severity: "warning",
            message: `${group.from} skipped \`${path}\` — moving it onto \`${group.nodes[0]}\`'s axis would take it outside zone \`${escaped.id}\``,
            fix: `align \`${path}\` with something inside \`${escaped.id}\`, or drop it from the zone`,
            loc: group.loc,
          });
          continue;
        }
        // Every node, not just same-rank ones. The rank filter assumed an
        // align move stays inside one band, but `place` chains under
        // `direction right` can put visually adjacent nodes on different
        // ranks — round 20 wrote `place idx right-of wh` + `align wh idx`,
        // the guard skipped the cross-rank pair, and the snap parked `idx`
        // exactly on top of `wh` with check exiting 0. The corpus invariant
        // sweep caught the overlap; a geometric check has no business
        // trusting rank labels.
        const clash = nodes.find(
          (o) =>
            o.path !== path &&
            moved.x < o.x + o.w + 16 && moved.x + moved.w + 16 > o.x &&
            moved.y < o.y + o.h + 16 && moved.y + moved.h + 16 > o.y,
        );
        if (clash) {
          diagnostics.push({
            severity: "warning",
            message: `${group.from} skipped \`${path}\` — moving it onto \`${group.nodes[0]}\`'s axis would collide with \`${clash.path}\``,
            fix: `reorder that row, or align \`${clash.path}\` too`,
            loc: group.loc,
          });
          continue;
        }
        n[axis] += d;
        for (const pt of ports) if (pt.node === path) pt[axis] += d;
        for (const e of pEdges) {
          if (e.from === path) shiftEnd(e, true, d);
          if (e.to === path) shiftEnd(e, false, d);
        }
      }
    }
  }

  // Stacked sheets bleed SHEET_BLEED past a container's right and bottom
  // edges, and they are drawn from the node rect rather than sized into it:
  // inflating the node would put ELK's ports on the inflated face, so every
  // edge would stop 8px short of the card it points at. The bleed lands in
  // gaps that are wider than it everywhere by construction (node spacing 32,
  // frame padding 16, zone padding 20, root padding 32) — the one place it
  // has no gap to land in is the canvas edge, which is what these two lines
  // fix. `checkLayout` asserts the rest of that claim over the corpus.
  const bleed = (n: PNode) => (n.kind === "card" || n.kind === "context-card" ? SHEET_BLEED : 0);
  const height = Math.max(
    q(out.height),
    ...pEdges.flatMap((e) => e.points.map((p) => p.y + 32)),
    ...nodes.map((n) => n.y + n.h + bleed(n) + 32),
  );
  // edge points count toward width exactly as they do toward height — under
  // `direction right` the router's lanes run along the east side, and a lane
  // the width never saw fell off the canvas
  const width = Math.max(
    q(out.width),
    ...pEdges.flatMap((e) => e.points.map((p) => p.x + 32)),
    ...nodes.map((n) => n.x + n.w + bleed(n) + 32),
  );

  // footer band + pill-extended height, exactly as the renderer computed them
  // when it owned note placement
  const drawnBottoms = pillRects.map((r) => r.y + r.h + 16);
  const heightForNotes = Math.max(height, ...drawnBottoms);
  const footer: { x: number; y: number; w: number; h: number }[] = [];
  if (view.legend || (view.titleblock && Object.keys(view.titleblock).length)) {
    const rows = Object.entries(view.titleblock ?? {});
    const tbH = rows.length || view.title
      ? 12 + (view.title ? 20 : 0) + rows.length * 15 + 6
      : 0;
    const bandH = Math.max(view.legend ? 24 : 0, tbH) + 16;
    footer.push({ x: 0, y: heightForNotes - bandH, w: width, h: bandH });
  }
  type Rect = { x: number; y: number; w: number; h: number };
  // ── the note resolver, moved here whole (Positioned consolidation) ───────
  // Same candidate ladders, same authored-side rule, same travel fallback —
  // docs/notes/note-placement.md is unchanged as the policy record. The
  // renderer draws these rects and computes its canvas pad from them exactly
  // as it did when it owned the placement, so the move is byte-identical.
  const pNotes: NonNullable<Positioned["notes"]> = [];
  {
  const out = pNotes;
  const list = view.notes ?? [];
  const p = { width, height: heightForNotes, nodes, edges: pEdges, noteBoxes } as any;
  const obstacles: { x: number; y: number; w: number; h: number }[] = [
    ...nodes, ...frames, ...pZones, ...pillRects, ...chips, ...badges, ...footer,
  ];
  const byPath = new Map(nodes.map((n) => [n.path, n]));
  // Notes are placed in declaration order and each joins the obstacle set, so
  // an earlier note wins a contested spot — the same tie-break pills use
  // (docs/notes/edge-labels.md), and what makes the output deterministic.
  const placed: Rect[] = [];
  const clear = (r: Rect) =>
    !obstacles.some((o) => hitR(o, r)) && !placed.some((q) => hitR(q, r));

  let noteIdx = -1;
  for (const note of list) {
    noteIdx++;
    // A note the layout reserved space for draws exactly there — the same
    // contract as labelRect. The candidate ladder never runs for it.
    const reserved = p.noteBoxes?.get(noteIdx);
    // `noteBox`, not a second copy of its arithmetic — see the comment there.
    // Integers, like every other rect (DESIGN §8): `measure` returns a float
    // and only x/y used to be rounded, so note widths once shipped as
    // `width="174.22411799999998"`.
    const { lines, w, h } = noteBox(note.text, font);

    // Candidates, in preference order. The authored side is never changed: an
    // author who wrote `right-of` gets right-of, further out or slid along it,
    // never flipped to the other side of the node.
    const cands: { x: number; y: number }[] = [];
    let anchor: PNode | undefined;
    let mid: { x: number; y: number } | undefined;

    if (note.anchor.kind === "relpos") {
      const n = byPath.get(note.anchor.target);
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
    if (reserved) { x = reserved.x; y = reserved.y; found = true; }
    for (const fit of fits) {
      for (const c of cands) {
        const r = { x: Math.round(c.x), y: Math.round(c.y), w, h };
        if (!fit(r) || !clear(r)) continue;
        x = r.x; y = r.y; found = true;
        break;
      }
      if (found) break;
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
      for (let guard = 0; guard < 50 && !clear({ x, y, w, h }); guard++) {
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
      const from = clamp(mid, noteRect);
      leader = { x1: from.x, y1: from.y, x2: mid.x, y2: mid.y };
    }

    // canvas pad/shift is the renderer's: it recomputes the extent from these
    // rects exactly as it did when it owned placement, so the move is inert
    out.push({
      i: noteIdx, x, y, w, h, lines,
      leader: leader
        ? { x1: Math.round(leader.x1), y1: Math.round(leader.y1), x2: Math.round(leader.x2), y2: Math.round(leader.y2) }
        : undefined,
    });
  }
  }

  // A frame title is text in the frame's padding, and a wire can legitimately
  // run through that padding — a directed frame's wall port sits at the wall,
  // and the enclosing run reaches it through the 16px strip the title lives in
  // (measured on the nested direction probe: through the "D" of "Data
  // Platform"; widening the padding only moved the letter). The title cannot
  // be an ELK obstacle, so it does what zone chips do: it is drawn last, on a
  // canvas halo, whenever a final wire segment crosses its rect.
  {
    const titleRect = (f: PFrame) => ({
      x: f.x + 14, y: f.y + 24 - 13,
      w: Math.round(measure(f.label, fx(13), "500", font.metrics)), h: 17,
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

  return {
    positioned: {
      name: view.name,
      width,
      height, nodes, edges: pEdges, ports, frames,
      zones: pZones,
      flow: graph.flow,
      lines: view.layout.lines ?? "orthogonal",
      noteBoxes,
      chips, badges,
      notes: pNotes,
    },
    diagnostics,
  };
}
