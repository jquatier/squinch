// ViewGraph → positioned diagram. Phase-0-proven architecture:
//   - declared ranks (rows/place) are ours, enforced via invisible scaffold edges
//   - same-rank ("coplanar") edges bypass ELK → our deterministic coplanar router
//   - one port per edge endpoint with FIXED_SIDE → ELK spreads ports + stubs
// ELK owns between-rank; we own within-rank. Keep that boundary crisp.
import ELKModule from "elkjs/lib/elk.bundled.js";

// elkjs ships a CJS class with no construct signature in its types
const ELK = ELKModule as unknown as { new (): { layout(graph: unknown): Promise<any> } };
import { fit, measure, type FontFamily } from "../metrics.js";
import { resolveView } from "../view/resolve.js";
import type { VNode, VEdge } from "../view/resolve.js";
import type { SModel, SView, Side, Diagnostic, RelPos, ZoneColor, ZoneKind, ZoneLabelPos } from "../model/types.js";
import type { ThemeFont } from "../themes/index.js";

const LEAF_TIERS = [120, 160, 200, 240];
const CARD_TIERS = [200, 240, 280, 320];
const LEAF_H = 64;
const CARD_H = 88;
const PLATE = 40;
const PAD = 12;
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

const SIDE_UP: Record<string, string> = { north: "NORTH", south: "SOUTH", east: "EAST", west: "WEST" };
const SIDE_DOWN: Record<string, Side> = { NORTH: "north", SOUTH: "south", EAST: "east", WEST: "west" };

export interface PNode extends VNode {
  x: number; y: number; w: number; h: number;
  rank: number;
}
export interface PPort { edge: string; node: string; side: Side; x: number; y: number }
export interface PFrame { path: string; label: string; x: number; y: number; w: number; h: number }
export interface PZone {
  id: string; label: string; kind: ZoneKind;
  icon?: { pack: string; id: string };
  labelPos: ZoneLabelPos;
  color?: ZoneColor;
  x: number; y: number; w: number; h: number;
  depth: number; // nesting depth, outermost = 0 (render order)
}
export interface PEdge {
  id: string; from: string; to: string;
  label?: string; async: boolean; animate: boolean; count: number;
  tags: string[];
  heads: "one" | "both" | "none";
  points: { x: number; y: number }[];
  /** Label space reserved by ELK at layout time (cross-rank edges). The pill
   *  is drawn exactly here — no search, no fallback, no way to collide: the
   *  room exists because the layout made it. Coplanar edges get theirs from
   *  the router (phase 2); until then they are undefined and the renderer's
   *  search still covers them. */
  labelRect?: { x: number; y: number; w: number; h: number };
}
export interface Positioned {
  name: string;
  width: number; height: number;
  nodes: PNode[]; edges: PEdge[]; ports: PPort[]; frames: PFrame[];
  zones: PZone[];
  flow?: { label: string; byEdge: Record<string, number[]> };
  lines: "orthogonal" | "curved" | "straight";
}

// Node width depends on the theme's font (sketch measures hand-lettered
// Caveat at its own scale) — the theme is a determinism input, so this is
// still a pure function of (source, theme).
const INTER: Pick<ThemeFont, "metrics" | "scale"> = { metrics: "inter", scale: 1 };

function sizeOf(n: VNode, font: Pick<ThemeFont, "metrics" | "scale">): { w: number; h: number } {
  const fam = font.metrics as FontFamily;
  const fx = (px: number) => Math.round(px * font.scale);
  const isCard = n.kind === "card" || n.kind === "context-card";
  if (isCard) {
    const need = PAD + Math.max(
      measure(n.label, fx(15), "500", fam),
      measure(n.tagline ?? "", fx(11), "400", fam),
    ) + PAD + 28;
    return { w: CARD_TIERS.find((t) => t >= need) ?? CARD_TIERS[CARD_TIERS.length - 1], h: CARD_H };
  }
  const need = PAD + PLATE + PAD + measure(n.label, fx(13), "500", fam) + PAD;
  return { w: LEAF_TIERS.find((t) => t >= need) ?? LEAF_TIERS[LEAF_TIERS.length - 1], h: LEAF_H };
}

export async function layoutView(
  model: SModel,
  view: SView,
  font: Pick<ThemeFont, "metrics" | "scale"> = INTER,
): Promise<{ positioned: Positioned; diagnostics: Diagnostic[] }> {
  const graph = resolveView(model, view);
  const diagnostics = [...graph.diagnostics];
  const byPath = new Map(graph.nodes.map((n) => [n.path, n]));
  const memberPaths = graph.nodes.map((n) => n.path);
  const edges: VEdge[] = graph.edges;

  // Top "entities": frames count as one unit for ranking/order; framed nodes
  // project to their frame. Inside frames, ELK's natural layering rules.
  const entityOf = (p: string) => byPath.get(p)?.frame ?? p;
  const entities = [
    ...graph.frames.map((f) => f.path),
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
    color?: ZoneColor;
    set: Set<string>;
  }
  const zones: LZone[] = [];
  for (const z of model.zones) {
    const set = new Set(entities.filter((e) => z.members.some((m) => memberMatch(e, m))));
    for (const n of graph.nodes) {
      if (!n.frame || set.has(n.frame)) continue;
      if (z.members.some((m) => memberMatch(n.path, m)))
        diagnostics.push({
          severity: "error",
          message: `zone \`${z.id}\` cuts through expanded container \`${n.frame}\` (member \`${n.path}\`)`,
          fix: `contain the whole container (\`contains ${n.frame}\`), or don't expand it in this view`,
          loc: z.loc,
        });
    }
    if (set.size > 0)
      zones.push({
        id: z.id, label: z.label ?? z.id, kind: z.kind,
        icon: z.icon, labelPos: z.labelPos, color: z.color, set,
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
  const declared = new Map<string, number>();
  view.layout.rows?.forEach((row, i) =>
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
   *  predecessors of a pinned node float above it (possibly negative). */
  const relax = (pins: Map<string, number>): Map<string, number> => {
    const out = new Map(pins);
    for (let pass = 0; pass < units.length + 2; pass++) {
      let changed = false;
      for (const [a, b] of crossEdges) {
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
    for (const p of units) if (!out.has(p)) out.set(p, 0);
    return out;
  };

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
    (view.layout.rows ?? []).forEach((row, i) =>
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
  for (const p of (view.layout.rows ?? []).flat().map(unitOf))
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

  // ── edge classes: inner (same entity) | coplanar (same rank, both bare) |
  //    cross-rank (ELK's) ────────────────────────────────────────────────────
  const inner = (e: VEdge) => entityOf(e.from) === entityOf(e.to) && byPath.get(e.from)?.frame;
  // the coplanar router only handles bare nodes: unframed AND unzoned
  const coplanar = edges.filter(
    (e) =>
      !inner(e) &&
      rank.get(unitOf(e.from)) === rank.get(unitOf(e.to)) &&
      unitOf(e.from) === e.from &&
      unitOf(e.to) === e.to,
  );
  const coplanarSet = new Set(coplanar.map((e) => e.id));
  for (const e of edges) {
    if (
      !inner(e) && !coplanarSet.has(e.id) &&
      unitOf(e.from) !== unitOf(e.to) &&
      rank.get(unitOf(e.from)) === rank.get(unitOf(e.to))
    )
      diagnostics.push({
        severity: "warning",
        message: `same-rank edge ${e.from} → ${e.to} crosses an expanded container or zone — layout quality may degrade`,
        loc: view.loc,
      });
  }
  const elkEdges = edges.filter((e) => !coplanarSet.has(e.id));

  const natural = new Map(units.map((p) => [p, 0]));
  for (let i = 0; i < units.length; i++)
    for (const e of elkEdges) {
      const ef = unitOf(e.from), et = unitOf(e.to);
      if (ef !== et) natural.set(et, Math.max(natural.get(et)!, natural.get(ef)! + 1));
    }
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
        fix: `put ${named(e.to, b)} in a row below ${named(e.from, a)}, or drop one of them from \`rows\``,
        loc: view.loc,
      });
    }
  }

  const scaffold: { id: string; from: string; to: string }[] = [];
  for (const p of order) {
    const want = rank.get(p)!;
    const nat = natural.get(p)!;
    if (nat < want) {
      const feeder = order.find((f) => rank.get(f)! === want - 1);
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
  const sidesOf = (e: VEdge): { from: Side; to: Side } => {
    const hint =
      routeExact.get(`${e.from}|${e.to}|${e.label}`) ?? routePair.get(`${e.from}|${e.to}`);
    const forward = rank.get(unitOf(e.from))! <= rank.get(unitOf(e.to))!;
    const [out, into]: [Side, Side] = flowsRight
      ? forward ? ["east", "west"] : ["west", "east"]
      : forward ? ["south", "north"] : ["north", "south"];
    return { from: hint?.fromSide ?? out, to: hint?.toSide ?? into };
  };

  const leafChild = (p: string) => {
    const n = byPath.get(p)!;
    const { w, h } = sizeOf(n, font);
    const ports = elkEdges.flatMap((e) => {
      const s = sidesOf(e);
      const out: any[] = [];
      if (e.from === p)
        out.push({ id: `${e.id}.src`, width: 0, height: 0, layoutOptions: { "elk.port.side": SIDE_UP[s.from] } });
      if (e.to === p)
        out.push({ id: `${e.id}.dst`, width: 0, height: 0, layoutOptions: { "elk.port.side": SIDE_UP[s.to] } });
      return out;
    });
    return { id: p, width: w, height: h, ports, layoutOptions: { "elk.portConstraints": "FIXED_SIDE" } };
  };

  const frameLabels = new Map(graph.frames.map((f) => [f.path, f.label]));
  const framedChildren = (framePath: string) =>
    graph.nodes.filter((n) => n.frame === framePath).map((n) => leafChild(n.path));

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
  const hasElkLabels = elkEdges.some((e) => !!e.label);

  const entityElk = (p: string): any =>
    frameLabels.has(p)
      ? {
          id: p,
          layoutOptions: {
            // Off the grid on purpose, like the zone padding below: 44 is what
            // seats the frame's title against its top border. 48 pushes the
            // contents down without moving the title, so the band above the
            // first row just reads as slack.
            "elk.padding": "[top=44,left=16,bottom=16,right=16]",
            "elk.spacing.nodeNode": "32",
            "elk.layered.spacing.nodeNodeBetweenLayers": hasElkLabels ? "8" : "40",
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
      "elk.spacing.edgeLabel": "8",
          },
          children: framedChildren(p),
        }
      : leafChild(p);

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
      "elk.spacing.nodeNode": String(SP[0]),
      "elk.layered.spacing.nodeNodeBetweenLayers": hasElkLabels ? "8" : String(SP[1]),
      // see entityElk: ELK does not inherit edge spacing into a compound
      "elk.layered.spacing.edgeNodeBetweenLayers": "24",
      "elk.spacing.edgeNode": "24",
      // labels are layout citizens (see the elkEdges map) — repeated in every
      // bag for the same reason the edge spacing is: ELK does not inherit
      "elk.edgeLabels.inline": "true",
      "elk.spacing.edgeLabel": "8",
    },
    children: [
      ...zones.filter((c) => zoneParent.get(c.id) === z).map(zoneElk),
      ...entities.filter((e) => entityZone.get(e) === z).map(entityElk),
    ],
  });
  const zoneById = new Map(zones.map((z) => [z.id, z]));

  // Gap arithmetic: gap = 8 + labelHeight + 8 — two grid notches tighter than
  // the classic density gap, chosen at gate review. An unlabelled gap needs a
  // spacer of SP[1]-32 to come out at the density spacing, and a frame's
  // tighter interior (historically 40) needs 8. A real pill is 18 tall and is
  // drawn centred inside whatever was reserved, so labelled gaps only exceed
  // the standard where 18 + 32 > SP[1] — compact only, by 10px.
  const spacerH = (inFrame: boolean) => Math.max(2, (inFrame ? 40 : SP[1]) - 32);
  const labelFor = (e: VEdge) => {
    const inFrame = !!byPath.get(e.from)?.frame && byPath.get(e.from)?.frame === byPath.get(e.to)?.frame;
    if (!e.label) return { text: " ", width: 2, height: spacerH(inFrame) };
    return { text: e.label, width: pillDims(e.label, font).w, height: Math.max(18, spacerH(inFrame)) };
  };

  const children = order.map((p) => (zoneById.has(p) ? zoneElk(zoneById.get(p)!) : entityElk(p)));
  const elkGraph = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": view.layout.direction === "right" ? "RIGHT" : "DOWN",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.layered.crossingMinimization.forceNodeModelOrder": "true",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.spacing.nodeNode": String(SP[0]),
      "elk.layered.spacing.nodeNodeBetweenLayers": hasElkLabels ? "8" : String(SP[1]),
      "elk.layered.spacing.edgeNodeBetweenLayers": "24",
      "elk.spacing.edgeNode": "24",
      // labels are layout citizens (see the elkEdges map) — repeated in every
      // bag for the same reason the edge spacing is: ELK does not inherit
      "elk.edgeLabels.inline": "true",
      "elk.spacing.edgeLabel": "8",
      "elk.spacing.edgeEdge": "16",
      "elk.padding": "[top=32,left=32,bottom=32,right=32]",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      // spiked: MEDIAN_LAYER puts the label mid-dogleg, closest to the old
      // nine-fraction midpoint aesthetic (TAIL hugs the source, HEAD the sink)
      "elk.layered.edgeLabels.centerLabelPlacementStrategy": "MEDIAN_LAYER",
    },
    children,
    edges: [
      // Ports live on leaves. An endpoint that is an expanded frame (or a zone)
      // has none, so attach to the compound itself — otherwise ELK is handed a
      // port id that does not exist and throws a raw JsonImportException,
      // which is exactly the un-actionable failure CLAUDE.md forbids.
      ...elkEdges.map((e) => ({
        id: e.id,
        sources: [frameLabels.has(e.from) || zoneById.has(e.from) ? e.from : `${e.id}.src`],
        targets: [frameLabels.has(e.to) || zoneById.has(e.to) ? e.to : `${e.id}.dst`],
        // Label space is reserved by the layout, not scavenged after it — but
        // an inline label dummy costs a whole extra layer at full spacing
        // (spiked: 56 → 130 for one 18px label), which read as giant gaps at
        // review. So the spacing is inverted: between-layers drops to 16 and
        // EVERY edge carries a label — real ones sized for their pill,
        // unlabelled ones an invisible spacer — so labelled and unlabelled
        // gaps come out at exactly the density spacing, and the pill lands
        // centred on its own wire, which is where pills always sat. The label
        // no longer costs anything; it just cannot be collided with.
        ...(hasElkLabels ? { labels: [labelFor(e)] } : {}),
      })),
      ...scaffold.map((s) => ({ id: s.id, sources: [s.from], targets: [s.to], ...(hasElkLabels ? { labels: [{ text: " ", width: 2, height: spacerH(false) }] } : {}) })),
    ],
  };

  const out: any = await new ELK().layout(elkGraph as any);
  const q = Math.round;

  // recursive extraction: compound (zone/frame) children carry parent-relative
  // coords
  const nodes: PNode[] = [];
  const frames: PFrame[] = [];
  const pZones: PZone[] = [];
  const ports: PPort[] = [];
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
        color: z.color,
        x, y, w: q(c.width), h: q(c.height), depth,
      });
      containerOffset.set(c.id, { x, y });
      for (const child of c.children ?? []) walk(child, x, y, depth + 1);
      return;
    }
    if (frameLabels.has(c.id)) {
      frames.push({ path: c.id, label: frameLabels.get(c.id)!, x, y, w: q(c.width), h: q(c.height) });
      containerOffset.set(c.id, { x, y });
      for (const child of c.children ?? []) walk(child, x, y, depth + 1);
      return;
    }
    nodes.push({
      ...byPath.get(c.id)!,
      x, y, w: q(c.width), h: q(c.height),
      rank: rank.get(entityOf(c.id))!,
    });
    for (const p of c.ports ?? []) {
      if (p.id.startsWith("scaffold.")) continue;
      ports.push({
        edge: p.id.replace(/\.(src|dst)$/, ""),
        node: c.id,
        side: SIDE_DOWN[p.layoutOptions?.["elk.port.side"] ?? "SOUTH"],
        x: q(x + p.x),
        y: q(y + p.y),
      });
    }
  };
  for (const c of out.children) walk(c, 0, 0);
  const nodeById = new Map(nodes.map((n) => [n.path, n]));

  const elkPositioned = new Map<string, PEdge>(
    out.edges
      .filter((e: any) => !e.id.startsWith("scaffold."))
      .map((e: any) => {
        const s = e.sections[0];
        const off = containerOffset.get(e.container ?? "root") ?? { x: 0, y: 0 };
        const pts = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map(
          (p: any) => ({ x: q(p.x + off.x), y: q(p.y + off.y) }),
        );
        const m = edges.find((me) => me.id === e.id)!;
        const lab = e.labels?.[0];
        const labelRect = lab
          ? { x: q(lab.x + off.x), y: q(lab.y + off.y), w: q(lab.width), h: q(lab.height) }
          : undefined;
        return [e.id, { id: e.id, from: m.from, to: m.to, label: m.label, async: m.async, animate: m.animate, count: m.count, tags: m.tags, heads: m.heads, points: pts, labelRect }];
      }),
  );

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
  const freePort = (n: PNode, side: Side, want: number): number => {
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

  const laneOf = new Map<string, number>();
  const lanesByRank = new Map<number, { lo: number; hi: number }[][]>();
  for (const e of coplanar) {
    const a = nodeById.get(e.from)!;
    const b = nodeById.get(e.to)!;
    const [l, r] = a[along] <= b[along] ? [a, b] : [b, a];
    const isBlocked = nodes.some(
      (n) => n.path !== a.path && n.path !== b.path && n.rank === a.rank
        && n[along] > l[along] && n[along] < r[along],
    );
    if (!isBlocked) continue;
    const span = {
      lo: Math.min(a[along] + a[alongSize] / 2, b[along] + b[alongSize] / 2),
      hi: Math.max(a[along] + a[alongSize] / 2, b[along] + b[alongSize] / 2),
    };
    const lanes = lanesByRank.get(a.rank) ?? [];
    let li = lanes.findIndex((spans) => spans.every((sp) => span.hi + 16 <= sp.lo || span.lo >= sp.hi + 16));
    if (li === -1) { li = lanes.length; lanes.push([]); }
    lanes[li].push(span);
    lanesByRank.set(a.rank, lanes);
    laneOf.set(e.id, li);
  }

  const coplanarEdges: PEdge[] = coplanar.map((e) => {
    const a = nodeById.get(e.from)!;
    const b = nodeById.get(e.to)!;
    const [l, r] = a[along] <= b[along] ? [a, b] : [b, a];
    const blocked = nodes.some(
      (n) => n.path !== a.path && n.path !== b.path && n.rank === a.rank
        && n[along] > l[along] && n[along] < r[along],
    );
    const midCross = (n: PNode) => n[cross] + Math.round(n[crossSize] / 2);
    const carry = { label: e.label, async: e.async, animate: e.animate, count: e.count, tags: e.tags, heads: e.heads };
    if (!blocked) {
      const c = midCross(a);
      const first = a[along] <= b[along];
      const pts = first
        ? [pt(a[along] + a[alongSize], c), pt(b[along], c)]
        : [pt(a[along], c), pt(b[along] + b[alongSize], c)];
      ports.push(
        { edge: e.id, node: a.path, side: first ? highSide : lowSide, x: pts[0].x, y: pts[0].y },
        { edge: e.id, node: b.path, side: first ? lowSide : highSide, x: pts[1].x, y: pts[1].y },
      );
      return { id: e.id, from: e.from, to: e.to, ...carry, points: pts };
    }
    const bandEdge = Math.max(...nodes.filter((n) => n.rank === a.rank).map((n) => n[cross] + n[crossSize]));
    const lane = bandEdge + 24 + (laneOf.get(e.id) ?? 0) * 16;
    const aA = freePort(a, bandSide, a[along] + Math.round(a[alongSize] / 2));
    const bA = freePort(b, bandSide, b[along] + Math.round(b[alongSize] / 2));
    const pts = [
      pt(aA, a[cross] + a[crossSize]), pt(aA, lane),
      pt(bA, lane), pt(bA, b[cross] + b[crossSize]),
    ];
    ports.push(
      { edge: e.id, node: a.path, side: bandSide, x: pts[0].x, y: pts[0].y },
      { edge: e.id, node: b.path, side: bandSide, x: pts[3].x, y: pts[3].y },
    );
    return { id: e.id, from: e.from, to: e.to, ...carry, points: pts };
  });

  const coplanarById = new Map(coplanarEdges.map((e) => [e.id, e]));
  const pEdges: PEdge[] = edges.map((e) => elkPositioned.get(e.id) ?? coplanarById.get(e.id)!);

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
  const alignGroups = [
    ...view.layout.align,
    ...(view.layout.cols ?? []).filter((c) => c.length > 1).map((nodes) => ({ nodes, loc: view.loc })),
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
      for (const path of group.nodes.slice(1)) {
        const n = nodeByPath.get(path);
        if (!n) continue;
        const d = target - centre(n);
        if (d === 0) continue;
        if (byPath.get(path)?.frame) {
          diagnostics.push({
            severity: "warning",
            message: `align skipped \`${path}\` — it sits inside an expanded container`,
            fix: `align the container itself, or drop the expand in this view`,
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
            message: `align skipped \`${path}\` — moving it onto \`${group.nodes[0]}\`'s axis would take it outside zone \`${escaped.id}\``,
            fix: `align \`${path}\` with something inside \`${escaped.id}\`, or drop it from the zone`,
            loc: group.loc,
          });
          continue;
        }
        const clash = nodes.find(
          (o) =>
            o.path !== path && o.rank === n.rank &&
            moved.x < o.x + o.w + 16 && moved.x + moved.w + 16 > o.x &&
            moved.y < o.y + o.h + 16 && moved.y + moved.h + 16 > o.y,
        );
        if (clash) {
          diagnostics.push({
            severity: "warning",
            message: `align skipped \`${path}\` — moving it onto \`${group.nodes[0]}\`'s axis would collide with \`${clash.path}\``,
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

  const height = Math.max(
    q(out.height),
    ...pEdges.flatMap((e) => e.points.map((p) => p.y + 32)),
  );

  return {
    positioned: {
      name: view.name,
      width: Math.max(q(out.width), ...nodes.map((n) => n.x + n.w + 32)),
      height, nodes, edges: pEdges, ports, frames,
      zones: pZones,
      flow: graph.flow,
      lines: view.layout.lines ?? "orthogonal",
    },
    diagnostics,
  };
}
