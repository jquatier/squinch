// SPEC §5 visibility resolution + edge lifting. Pure: (model, view) → ViewGraph.
// Rule order: scope children → expand → only → context neighbors → detail →
// include → exclude (exclude wins last) → edges/notes derive from what survived.
// `scope` is the view's *where*; `only` is its *which*. They are separate axes
// because a tag is a cross-cutting concern and can never be a place.
import type { Diagnostic, EdgeAnimate, Hue, SEdge, SModel, SView } from "../model/types.js";

export interface VNode {
  path: string;
  /** `person` is a leaf the restyle draws differently (a solid actor tile, no
   *  border): the initiating human is not a service, and the shape says so
   *  before the icon does. Context keeps the muted leaf treatment either way —
   *  a periphery card is scenery, and scenery does not need a second shape. */
  kind: "leaf" | "person" | "card" | "context-card" | "context-leaf";
  label: string;
  icon?: { pack: string; id: string };
  glyph?: { pack: string; id: string };
  /** Vendor mark composited onto the icon plate's corner (leaf nodes) — the
   *  licence-clean vocabulary for platforms with no icon pack (SPEC §nodes). */
  badge?: { pack: string; id: string };
  tagline?: string;
  preview: { pack: string; id: string }[];
  /** Leaves beyond the ones `preview` shows — the shelf's `+N`. Counted from
   *  the icons that would have been drawn, so it never claims more than the
   *  strip actually left out. */
  more?: number;
  /** A short ownership label for the card's shelf: the team, domain or
   *  namespace a system belongs to (`domain: "payments"`). Free text. */
  domain?: string;
  tags: string[]; // effective (container-inherited)
  /** someone else's system — DESIGN §3's hatched surface. A property of the
   *  thing itself, so a container carries it for its whole card. */
  external?: boolean;
  description?: string;
  frame?: string; // parent frame path when inside an expanded container
  /** Effective hue: the view's `color #tag` if one matches, else the element's
   *  own `color:`. Context cards ignore it — scenery stays muted. */
  color?: Hue;
}

export interface VFrame {
  path: string;
  label: string;
  /** Immediate enclosing frame — same field, same meaning as `VNode.frame`.
   *  Only `expand *` produces it: explicit expands never nest (SPEC §5). */
  frame?: string;
  /** Same resolution as `VNode.color`; drawn as the frame's stroke. */
  color?: Hue;
}

export interface VEdge {
  id: string; // original edge id, or agg:<from>|<to>
  from: string;
  to: string;
  label?: string;
  async: boolean;
  /** Which animation, if any (SPEC §edges). Async edges default to `flow`
   *  unless `animate: false`; sync edges are still unless they opt in. */
  animate?: EdgeAnimate;
  /** Dash pattern beyond each arrow's default: async is dashed already, so
   *  only `dotted` changes it; sync edges can declare either. */
  style?: "dashed" | "dotted";
  count: number; // >1 = aggregate
  /** Effective tags. An aggregate carries the union of what it merged, so a
   *  lens over a tag still finds the trunk that hides a tagged edge inside it. */
  tags: string[];
  /** Effective hue (view `color #tag` over the edge's own `color:`). A trunk
   *  keeps one only when every member agrees, like `animate`/`style`. */
  color?: Hue;
  /** Which ends get an arrowhead: `->`/`~>` one, `<->` both, `--` none. The
   *  view graph used to reduce every arrow to `async: boolean`, so two of the
   *  four kinds the grammar accepts drew as a plain one-way arrow. */
  heads: "one" | "both" | "none";
}

export interface ViewGraph {
  nodes: VNode[];
  edges: VEdge[];
  frames: VFrame[];
  /** `show flow` badges: edge id → step numbers (a lifted edge can carry
   *  several); numbering is the flow's own — steps hidden at this altitude
   *  keep their numbers out of the sequence, truthfully. */
  flow?: { label: string; byEdge: Record<string, number[]> };
  diagnostics: Diagnostic[];
}

/** `->`/`~>` point one way, `<->` both, `--` neither. */
const headsOf = (a: string): "one" | "both" | "none" =>
  a === "<->" ? "both" : a === "--" ? "none" : "one";

/** Effective animation for a declared edge. Values were validated at build
 *  time, so anything present is trusted here. */
const animateOf = (e: SEdge): EdgeAnimate | undefined => {
  const a = e.attrs.animate;
  if (a === "false") return undefined;
  if (a) return a as EdgeAnimate;
  return e.arrow === "~>" ? "flow" : undefined;
};

/** Effective dash pattern. `packets` supplies its own, so it needs no style;
 *  `solid` normalizes to undefined (it is the sync default, and build errors
 *  it on async edges before this runs). */
const styleOf = (e: SEdge): "dashed" | "dotted" | undefined => {
  const s = e.attrs.style;
  if (s === "dashed" || s === "dotted") return s;
  return e.arrow === "~>" ? "dashed" : undefined;
};

const parentOf = (p: string) => (p.includes(".") ? p.slice(0, p.lastIndexOf(".")) : "");
const topOf = (p: string) => p.split(".")[0];

export function resolveView(model: SModel, view: SView): ViewGraph {
  const diagnostics: Diagnostic[] = [];
  const scope = view.scope ?? "";

  const effectiveTags = (path: string): string[] => {
    const own = model.nodes.get(path)?.tags ?? model.containers.get(path)?.tags ?? [];
    const tags = [...own];
    let p = parentOf(path);
    while (p) {
      tags.push(...(model.containers.get(p)?.tags ?? []));
      p = parentOf(p);
    }
    return [...new Set(tags)];
  };

  // a tag target expands to every element whose EFFECTIVE tags match —
  // inherited tags count (SPEC: tags inherit to everything inside).
  // Deterministic order: containers in declaration order, then nodes.
  const tagMatches = (tag: string): string[] => [
    ...[...model.containers.keys()].filter((p) => p && effectiveTags(p).includes(tag)),
    ...[...model.nodes.keys()].filter((p) => effectiveTags(p).includes(tag)),
  ];

  // ── 1. scope children ────────────────────────────────────────────────────
  let visible: string[] = scope
    ? [...(model.containers.get(scope)?.children ?? [])]
    : [
        ...[...model.nodes.keys()].filter((p) => !p.includes(".")),
        ...[...model.containers.keys()].filter((p) => !p.includes(".")),
      ];

  // expand: inline the container's children inside a rendered frame.
  // One level only, by the rule-stack design (§5 rule 1): frames do not nest —
  // unless the view says `expand *`, the one deliberate ladder, which opens
  // every visible container to leaf depth and lets the frames it creates nest.
  // For explicit expands the rule stands: the layout's single-level flattening
  // of a *partial* ladder would leave "which levels am I looking at?"
  // ambiguous, so the depth an author wants piecemeal is a deeper view.
  const frames: VFrame[] = [];
  const frameOf = new Map<string, string>(); // child path → frame path
  if (view.expandStar) {
    if (view.expand.length)
      diagnostics.push({
        severity: "warning",
        message: "`expand *` already opens every container — the explicit `expand` lines are redundant",
        fix: "drop the explicit expand lines",
        loc: view.loc,
      });
    // Recursively open everything. An empty container stays a card: a
    // childless frame is the 0×0 ELK failure the one-level rule was built
    // against, and the "everything" view must never silently drop an element.
    const opened: string[] = [];
    const open = (path: string, parent?: string) => {
      const c = model.containers.get(path);
      if (!c || c.children.length === 0) {
        opened.push(path);
        return;
      }
      frames.push({ path, label: c.label ?? c.name, frame: parent, color: c.color });
      for (const child of c.children) {
        frameOf.set(child, path);
        open(child, path);
      }
    };
    for (const p of visible) open(p);
    visible = opened;
    if (frames.length === 0)
      diagnostics.push({
        severity: "warning",
        message: "`expand *` opened nothing — no containers are visible here",
        fix: "drop the line; every element is already at full depth",
        loc: view.loc,
      });
  } else {
    const expandSet = new Set(view.expand);
    for (const ex of view.expand) {
      let outer: string | undefined;
      for (let p = parentOf(ex); p; p = parentOf(p)) if (expandSet.has(p)) outer = p;
      if (outer) {
        diagnostics.push({
          severity: "error",
          message: `expand \`${ex}\` sits inside \`${outer}\`, which this view also expands — a view opens one level of depth`,
          fix: `give the inner container its own view: \`scope ${outer}\` + \`expand ${ex.slice(outer.length + 1)}\` — its card here dives there. Or open every level at once with \`expand *\``,
          loc: view.loc,
        });
        continue;
      }
      const i = visible.indexOf(ex);
      const c = model.containers.get(ex);
      if (i >= 0 && c) {
        frames.push({ path: ex, label: c.label ?? c.name, color: c.color });
        for (const child of c.children) frameOf.set(child, ex);
        visible.splice(i, 1, ...c.children);
      } else if (!c && model.nodes.has(ex)) {
        diagnostics.push({
          severity: "warning",
          message: `expand \`${ex}\` targets a leaf — only containers open`,
          fix: `drop the line; a leaf is already drawn at full depth`,
          loc: view.loc,
        });
      } else if (c) {
        diagnostics.push({
          severity: "warning",
          message: `expand \`${ex}\` is not among the scope's direct children — nothing opens`,
          fix: `\`expand\` opens the scope's own children; an outside element is drawn at depth with \`detail ${ex}\``,
          loc: view.loc,
        });
      }
    }
  }

  const visSet = () => new Set(visible);
  /** Lift targets: the visible set plus expanded frames that still hold at
   *  least one visible member. An expanded container is spliced out of
   *  `visible`, but its frame is a real drawable entity — an edge naming the
   *  container attaches to the frame border (layout hands ELK the compound
   *  id, layout.ts's "ports live on leaves" comment). A frame `only` or
   *  `exclude` has emptied is dead: it must neither render nor catch lifts. */
  const liveFramePaths = () =>
    frames.filter((f) => visible.some((p) => p.startsWith(`${f.path}.`))).map((f) => f.path);

  // ── 3. only: the view's filter ───────────────────────────────────────────
  // `scope` answers *where I stand*; `only` answers *which of that I keep*.
  // The language had no second axis, so a cross-cutting concern — the entire
  // reason tags exist — could not be selected at all: `include #pci` adds to a
  // set that already contains it, `highlight` decorates without removing, and
  // an auditor was left enumerating the complement by id.
  //
  // It runs after `expand` so it filters an expanded interior too, and before
  // context so neighbours are earned against the *reduced* interior. That
  // second ordering is not a special case — it is the existing rule that
  // derived content follows visibility. Shrink the interior and fewer edges
  // cross, so fewer neighbours qualify, automatically.
  //
  // A container survives if it or anything beneath it matches: at a high
  // altitude the tagged things are usually leaves inside the cards, and a
  // filter that dropped every card because the card itself is untagged would
  // render an empty diagram for the most natural way to ask the question.
  if (view.only?.length) {
    const keep = new Set<string>();
    for (const on of view.only) {
      const targets = typeof on === "string" ? [on] : tagMatches(on.tag);
      if (targets.length === 0)
        diagnostics.push({
          severity: "warning",
          message: typeof on === "string"
            ? `only \`${on}\`: no such element`
            : `only #${on.tag}: nothing is tagged #${on.tag}`,
          loc: view.loc,
        });
      // a match keeps itself, every visible ancestor holding it, and every
      // visible descendant inside it — naming a container in an expanded view
      // must keep its opened interior, not strand an empty frame
      for (const t of targets)
        for (const p of visible)
          if (p === t || t.startsWith(`${p}.`) || p.startsWith(`${t}.`)) keep.add(p);
    }
    const dropped = visible.filter((p) => !keep.has(p));
    visible = visible.filter((p) => keep.has(p));
    if (!visible.length)
      diagnostics.push({
        severity: "warning",
        message: "`only` filtered out everything — this view renders empty",
        fix: "check the ids and tags; `only` keeps matches, it does not add them",
        loc: view.loc,
      });
    else if (!dropped.length)
      diagnostics.push({
        severity: "warning",
        message: "`only` changed nothing — everything here already matches",
        fix: "drop the line, or narrow it further",
        loc: view.loc,
      });
  }

  /** Nearest visible ancestor-or-self, given the current visible set. */
  const liftIn = (path: string, v: Set<string>): string | undefined => {
    let p = path;
    while (p) {
      if (v.has(p)) return p;
      p = parentOf(p);
    }
    return undefined;
  };

  // ── 4. context neighbors (top-level lift, earned against the filtered interior) ──────────────────
  const contextSet = new Set<string>();
  if (view.context === "auto") {
    // frames count as inside: `client -> cluster` with the cluster expanded
    // must still earn `client` its context card, exactly as a leaf target would
    const v = new Set([...visible, ...liveFramePaths()]);
    for (const e of model.edges) {
      const fIn = liftIn(e.from, v);
      const tIn = liftIn(e.to, v);
      if (!!fIn === !!tIn) continue; // both in or both out
      const outside = fIn ? e.to : e.from;
      const candidate = liftIn(outside, v) ?? topOf(outside);
      // Context shows how the scope connects *outward*, so the scope itself can
      // never be its own neighbour. Before `only` this was unreachable: the one
      // way to lose a sibling was `exclude`, which runs after this. Filtering
      // the interior makes it reachable — an edge to a filtered-out sibling
      // lifts to the container we are standing in, and the view would draw a
      // muted card of itself. A sibling removed on purpose is simply gone.
      if (scope && (candidate === scope || scope.startsWith(`${candidate}.`))) continue;
      if (!v.has(candidate)) contextSet.add(candidate);
    }
  }
  visible.push(...contextSet);

  // Explicitly named elements are exempt from the context rules below: they
  // never have to EARN their spot, and edges among them render even though both
  // endpoints are context-styled — the user asked for them.
  const explicitSet = new Set<string>();

  // ── 5. detail: draw an outside element at its own depth ──────────────────
  // This was `include`'s second, unadvertised job. One verb meaning both "add
  // this element" and "…and redraw its whole branch at a different altitude" is
  // why `include` could never be redefined to narrow: flipping it would have
  // turned every altitude override into "delete the rest of the diagram". Split
  // out, each verb has exactly one job and `only` above became possible.
  for (const d of view.detail ?? []) {
    if (!visible.includes(d)) {
      visible.push(d);
      if (!scope || !d.startsWith(`${scope}.`)) contextSet.add(d);
    }
    explicitSet.add(d);
    const top = topOf(d);
    if (contextSet.has(top) && top !== d) {
      contextSet.delete(top);
      visible = visible.filter((p) => p !== top);
    }
  }

  // ── 6. include: purely additive ──────────────────────────────────────────
  for (const inc of view.include) {
    const targets = typeof inc === "string" ? [inc] : tagMatches(inc.tag);
    if (typeof inc !== "string" && targets.length === 0)
      diagnostics.push({
        severity: "warning",
        message: `include #${inc.tag}: nothing is tagged #${inc.tag}`,
        loc: view.loc,
      });
    let added = 0;
    for (const target of targets) {
      explicitSet.add(target);
      if (visible.includes(target)) continue;
      added++;
      visible.push(target);
      if (!scope || !target.startsWith(`${scope}.`)) contextSet.add(target);
      // The element is now drawn *and* so is the top-level card standing in for
      // its branch — two cards for one thing. That is what `detail` is for.
      const top = topOf(target);
      if (contextSet.has(top) && top !== target)
        diagnostics.push({
          severity: "warning",
          message: `\`${target}\` is included, but \`${top}\` is already here as a context card`,
          fix: `use \`detail ${target}\` to draw it at that depth instead of \`${top}\``,
          loc: view.loc,
        });
    }
    // `include` ADDS to a view (SPEC §5 rule stack); it cannot narrow one.
    // Reading it as a filter is the natural mistake — a cold-run agent wrote
    // `include #pci` for "show only the PCI parts", got a clean check and an
    // unfiltered diagram. Silence there is the bug.
    if (added === 0 && targets.length > 0)
      diagnostics.push({
        severity: "warning",
        message: typeof inc === "string"
          ? `include \`${inc}\` changed nothing — it is already visible here`
          : `include #${inc.tag} changed nothing — every match is already visible here`,
        fix: typeof inc === "string"
          ? "`include` adds elements to a view; drop the line, or did you mean `exclude`?"
          : `\`include\` adds elements, it cannot narrow a view. For only the ` +
            `#${inc.tag} parts use \`only #${inc.tag}\`; to keep the whole picture with ` +
            `those emphasised use \`highlight #${inc.tag}\``,
        loc: view.loc,
      });
  }

  // ── 7. exclude wins last (removes whole subtrees) ─────────────────────────
  for (const exc of view.exclude) {
    const targets = typeof exc === "string" ? [exc] : tagMatches(exc.tag);
    if (typeof exc !== "string" && targets.length === 0)
      diagnostics.push({
        severity: "warning",
        message: `exclude #${exc.tag}: nothing is tagged #${exc.tag}`,
        loc: view.loc,
      });
    for (const target of targets) {
      visible = visible.filter((p) => p !== target && !p.startsWith(`${target}.`));
      contextSet.delete(target);
    }
  }

  // ── 5. edge lifting + aggregation over the final visible set ─────────────
  // Native edges (endpoints unchanged by lifting) always render individually —
  // parallel edges are legal and distinct at their own altitude. Only LIFTED
  // edges aggregate into count-badged neutrals.
  const liveFrames = frames.filter((f) => visible.some((p) => p.startsWith(`${f.path}.`)));
  const frameSet = new Set(liveFrames.map((f) => f.path));
  const v = new Set([...visible, ...frameSet]);
  interface Group { edges: typeof model.edges; from: string; to: string }
  const groups = new Map<string, Group>();
  const edges: VEdge[] = [];
  const groupSlot = new Map<string, number>(); // key → index in edges[]
  for (const e of model.edges) {
    const f = liftIn(e.from, v);
    const t = liftIn(e.to, v);
    // `f === t` covers two different things. An edge whose ends both lift into
    // one card is genuinely internal at this altitude and drops on purpose. An
    // edge a node draws to *itself* is not: it parsed, validated, sits in the
    // model, and then vanished with nothing said — and a self-edge is the one
    // shape where "from and to landed in the same place" is what the author
    // wrote rather than a consequence of altitude.
    if (f && t && f === t && e.from === e.to) {
      diagnostics.push({
        severity: "warning",
        message: `\`${e.from}\` connects to itself — a self-edge is not drawn`,
        fix: `say it on the node instead: a \`note right-of ${e.from} "${e.label ?? "…"}"\`, `
          + `or fold it into the label`,
        loc: view.loc,
      });
      continue;
    }
    if (!f || !t || f === t) continue;
    // One end is an expanded frame and the other lifted to something inside
    // it: internal at this altitude — the same silent drop as both ends
    // lifting into one card (SPEC §5 lifting), just with the card held open.
    if (frameSet.has(f) && t.startsWith(`${f}.`)) continue;
    if (frameSet.has(t) && f.startsWith(`${t}.`)) continue;
    const lifted = f !== e.from || t !== e.to;
    if (!lifted) {
      edges.push({
        id: e.id, from: f, to: t, label: e.label, async: e.arrow === "~>",
        animate: animateOf(e), style: styleOf(e), count: 1,
        tags: e.tags, color: e.color, heads: headsOf(e.arrow),
      });
      continue;
    }
    const key = `${f}|${t}`;
    if (!groups.has(key)) {
      groups.set(key, { edges: [], from: f, to: t });
      groupSlot.set(key, edges.push(null as any) - 1); // reserve slot in declaration order
    }
    groups.get(key)!.edges.push(e);
  }
  for (const [key, g] of groups) {
    const slot = groupSlot.get(key)!;
    if (g.edges.length === 1) {
      const e = g.edges[0];
      edges[slot] = {
        id: e.id, from: g.from, to: g.to, label: e.label, async: e.arrow === "~>",
        animate: animateOf(e), style: styleOf(e), count: 1,
        tags: e.tags, color: e.color, heads: headsOf(e.arrow),
      };
    } else {
      // A trunk only claims styling every member agrees on (same rule as
      // `heads` below): all-agree keeps the animation and pattern, any
      // disagreement falls back to neutral rather than asserting something
      // only some constituents said. SPEC §lifting rule 4 states this.
      const agreedAnimate = animateOf(g.edges[0]);
      const agreedStyle = styleOf(g.edges[0]);
      edges[slot] = {
        id: `agg:${g.from}|${g.to}`,
        from: g.from, to: g.to,
        label: `×${g.edges.length}`,
        async: g.edges.every((e) => e.arrow === "~>"),
        animate: g.edges.every((e) => animateOf(e) === agreedAnimate) ? agreedAnimate : undefined,
        style: g.edges.every((e) => styleOf(e) === agreedStyle) ? agreedStyle : undefined,
        count: g.edges.length,
        tags: [...new Set(g.edges.flatMap((e) => e.tags))],
        color: g.edges.every((e) => e.color === g.edges[0].color) ? g.edges[0].color : undefined,
        // A trunk only claims a shape every member agrees on; a mixed bundle
        // falls back to the plain arrow rather than asserting something false.
        heads: g.edges.every((e) => e.arrow === "<->") ? "both"
          : g.edges.every((e) => e.arrow === "--") ? "none" : "one",
      };
    }
  }

  // Context exists to show how the scope connects outward. An edge between two
  // *outsiders* is their business, not this view's — suppress it, or zooming
  // into one service drags in the whole neighbourhood's wiring.
  const scopeEdges = edges.filter(
    (e) =>
      !(
        contextSet.has(e.from) && contextSet.has(e.to) &&
        !explicitSet.has(e.from) && !explicitSet.has(e.to)
      ),
  );

  // context cards must earn their spot: drop any without a surviving edge —
  // except explicit includes, which were asked for by name
  for (const c of [...contextSet]) {
    if (explicitSet.has(c)) continue;
    if (!scopeEdges.some((e) => e.from === c || e.to === c)) {
      contextSet.delete(c);
      visible = visible.filter((p) => p !== c);
    }
  }
  // frames are drawable endpoints too — an edge lifted to an expanded
  // container attaches to its frame border
  const drawable = new Set([...visible, ...frameSet]);
  const finalEdges = scopeEdges.filter((e) => drawable.has(e.from) && drawable.has(e.to));

  // ── 6. materialize nodes ──────────────────────────────────────────────────
  const leafDescendants = (path: string): string[] => {
    const c = model.containers.get(path);
    if (!c) return [path];
    return c.children.flatMap(leafDescendants);
  };

  const nodes: VNode[] = visible.map((path) => {
    const isContext = contextSet.has(path);
    const container = model.containers.get(path);
    if (container) {
      const leaves = leafDescendants(path);
      const previewMode = container.attrs["preview"] ?? "auto";
      const icons = leaves
        .map((l) => model.nodes.get(l)?.icon)
        .filter((i): i is NonNullable<typeof i> => !!i);
      const preview = previewMode === "none" ? [] : icons.slice(0, 3);
      const glyphRef = container.attrs["glyph"];
      const glyph = glyphRef?.includes("/")
        ? { pack: glyphRef.split("/")[0], id: glyphRef.split("/")[1] }
        : undefined;
      // The card's own mark. Authored `icon:` wins; otherwise the first leaf
      // icon stands in, so a system that never named one still gets a plate
      // instead of a bare label — the same icon the preview strip leads with,
      // which is what a reader already associates with that card.
      const iconRef = container.attrs["icon"];
      const icon = iconRef?.includes("/")
        ? { pack: iconRef.split("/")[0], id: iconRef.split("/")[1] }
        : icons[0];
      return {
        path,
        kind: isContext ? "context-card" : "card",
        label: container.label ?? container.name,
        glyph,
        icon,
        more: icons.length - preview.length || undefined,
        domain: container.attrs["domain"],
        tagline:
          container.attrs["description"] ??
          `${leaves.length} component${leaves.length === 1 ? "" : "s"}`,
        preview,
        tags: effectiveTags(path),
        external: container.kinds.includes("external") || undefined,
        frame: frameOf.get(path),
        color: container.color,
      };
    }
    const n = model.nodes.get(path)!;
    // Lenient like the container glyph split: validation happened at check
    // time, and a half-typed value in the editor must not throw here.
    const badgeRef = n.attrs["badge"];
    const badge = badgeRef?.includes("/")
      ? { pack: badgeRef.split("/")[0], id: badgeRef.split("/")[1] }
      : undefined;
    return {
      path,
      kind: isContext ? "context-leaf" : n.kinds.includes("person") ? "person" : "leaf",
      label: n.label,
      icon: n.icon,
      badge,
      preview: [],
      tags: effectiveTags(path),
      external: n.kinds.includes("external") || undefined,
      description: n.description,
      frame: frameOf.get(path),
      color: n.color,
    };
  });

  // ── view colour lens (`color #tag hue`) ───────────────────────────────────
  // A lens over the model, so it wins over an element's own `color:`; among
  // statements, declaration order and the last one wins — but two different
  // hues landing on one element is almost always two tags that were meant to
  // be disjoint, so it is said once per element rather than resolved silently.
  // tolerant of a hand-built SView with no `colors` (tests, older callers)
  const colorStmts = view.colors ?? [];
  const viewHue = (tags: string[], subject: string): Hue | undefined => {
    const hits = colorStmts.filter((c) => tags.includes(c.tag));
    if (!hits.length) return undefined;
    const hues = new Set(hits.map((h) => h.hue));
    if (hues.size > 1) {
      const last = hits[hits.length - 1];
      const other = hits.find((h) => h.hue !== last.hue)!;
      diagnostics.push({
        severity: "warning",
        message: `${subject} is tagged #${other.tag} (${other.hue}) and #${last.tag} (${last.hue}) — #${last.tag} wins`,
        fix: `give both tags the same hue, or narrow one of them`,
        loc: last.loc,
      });
    }
    return hits[hits.length - 1].hue;
  };
  if (colorStmts.length) {
    for (const n of nodes) n.color = viewHue(n.tags, `\`${n.path}\``) ?? n.color;
    for (const e of finalEdges) e.color = viewHue(e.tags, `${e.from} → ${e.to}`) ?? e.color;
    for (const f of frames) f.color = viewHue(effectiveTags(f.path), `\`${f.path}\``) ?? f.color;
    for (const c of colorStmts)
      if (!nodes.some((n) => n.tags.includes(c.tag))
          && !finalEdges.some((e) => e.tags.includes(c.tag))
          && !frames.some((f) => effectiveTags(f.path).includes(c.tag)))
        diagnostics.push({
          severity: "warning",
          message: `color #${c.tag}: nothing visible here is tagged #${c.tag}`,
          fix: `nothing would take the colour — check the tag, or the view's \`include\`/\`only\``,
          loc: c.loc,
        });
  }

  // ── flow badges (SPEC §Flows): map each step onto the edge that renders
  // it at this altitude — steps whose endpoints lift into the same card
  // simply don't appear here.
  let flow: ViewGraph["flow"];
  if (view.showFlow) {
    const f = model.flows.find((fl) => fl.id === view.showFlow);
    if (f) {
      const v = visSet();
      const byEdge: Record<string, number[]> = {};
      f.steps.forEach((step, i) => {
        const from = liftIn(step.from, v);
        const to = liftIn(step.to, v);
        if (!from || !to || from === to) return;
        const edge = finalEdges.find(
          (e) => (e.from === from && e.to === to) || (e.from === to && e.to === from),
        );
        if (!edge) return;
        (byEdge[edge.id] ??= []).push(i + 1);
      });
      flow = { label: f.label ?? f.id, byEdge };
    }
  }

  // `highlight` never came through here. `include`, `exclude` and `only` each
  // warn when a tag matches nothing — the same typo, caught three times out of
  // four — but `highlight` is collected by the parser and handed straight to
  // the renderer, so `highlight #pcii` dimmed the whole diagram and emphasised
  // nothing, silently. Match against what this view can actually see: a tag
  // that exists elsewhere in the model is still useless here.
  // Edges count. `highlight #hot-path` on an edge-only tag is a documented and
  // working idiom — `api -> create { tags: #hot-path }` — and the first cut of
  // this warning checked nodes alone, so it fired on a correct diagram the very
  // next gauntlet round. A guard that is narrower than the thing it guards is
  // worse than none.
  for (const tag of view.highlight)
    if (!nodes.some((n) => n.tags.includes(tag))
        && !finalEdges.some((e) => e.tags.includes(tag)))
      diagnostics.push({
        severity: "warning",
        message: `highlight #${tag}: nothing visible here is tagged #${tag}`,
        fix: `everything would dim and nothing would stand out — check the tag, or the view's \`include\`/\`only\``,
        loc: view.loc,
      });

  // A view that resolves to nothing renders a blank canvas. The empty-container
  // case is caught at build time, but that is one cause of many: excluding
  // everything, scoping to something that isn't there, or a filter that keeps
  // nothing all land here too.
  if (!nodes.length)
    diagnostics.push({
      severity: "warning",
      message: `view \`${view.name}\` has nothing to draw`,
      fix: "every element is filtered out — check `scope`, `include`, `only` and `exclude`",
      loc: view.loc,
    });

  // liveFrames, not frames: a frame `exclude`/`only` emptied has no members
  // to size it and would reach ELK as a childless compound — a 0×0 rect.
  return { nodes, edges: finalEdges, frames: liveFrames, flow, diagnostics };
}
