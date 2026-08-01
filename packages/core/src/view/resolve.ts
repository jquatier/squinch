// SPEC §5 visibility resolution + edge lifting. Pure: (model, view) → ViewGraph.
// Rule order: scope children → expand → only → context neighbors → detail →
// include → exclude (exclude wins last) → edges/notes derive from what survived.
// `scope` is the view's *where*; `only` is its *which*. They are separate axes
// because a tag is a cross-cutting concern and can never be a place.
import type { Diagnostic, SModel, SView } from "../model/types.js";

export interface VNode {
  path: string;
  kind: "leaf" | "card" | "context-card" | "context-leaf";
  label: string;
  icon?: { pack: string; id: string };
  glyph?: { pack: string; id: string };
  tagline?: string;
  preview: { pack: string; id: string }[];
  tags: string[]; // effective (container-inherited)
  /** someone else's system — DESIGN §3's hatched surface. A property of the
   *  thing itself, so a container carries it for its whole card. */
  external?: boolean;
  description?: string;
  frame?: string; // parent frame path when inside an expanded container
}

export interface VFrame {
  path: string;
  label: string;
}

export interface VEdge {
  id: string; // original edge id, or agg:<from>|<to>
  from: string;
  to: string;
  label?: string;
  async: boolean;
  animate: boolean; // async edges animate unless `animate: false` (SPEC §edges)
  count: number; // >1 = aggregate
  /** Effective tags. An aggregate carries the union of what it merged, so a
   *  lens over a tag still finds the trunk that hides a tagged edge inside it. */
  tags: string[];
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

  // expand: inline the container's children inside a rendered frame
  const frames: VFrame[] = [];
  const frameOf = new Map<string, string>(); // child path → frame path
  for (const ex of view.expand) {
    const i = visible.indexOf(ex);
    const c = model.containers.get(ex);
    if (i >= 0 && c) {
      frames.push({ path: ex, label: c.label ?? c.name });
      for (const child of c.children) frameOf.set(child, ex);
      visible.splice(i, 1, ...c.children);
    }
  }

  const visSet = () => new Set(visible);

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
      // a match keeps itself and every visible ancestor holding it
      for (const t of targets)
        for (const p of visible)
          if (p === t || t.startsWith(`${p}.`)) keep.add(p);
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
    const v = visSet();
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
  const v = visSet();
  interface Group { edges: typeof model.edges; from: string; to: string }
  const groups = new Map<string, Group>();
  const edges: VEdge[] = [];
  const groupSlot = new Map<string, number>(); // key → index in edges[]
  for (const e of model.edges) {
    const f = liftIn(e.from, v);
    const t = liftIn(e.to, v);
    if (!f || !t || f === t) continue;
    const lifted = f !== e.from || t !== e.to;
    if (!lifted) {
      edges.push({
        id: e.id, from: f, to: t, label: e.label, async: e.arrow === "~>",
        animate: e.arrow === "~>" && e.attrs.animate !== "false", count: 1,
        tags: e.tags, heads: headsOf(e.arrow),
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
        animate: e.arrow === "~>" && e.attrs.animate !== "false", count: 1,
        tags: e.tags, heads: headsOf(e.arrow),
      };
    } else {
      edges[slot] = {
        id: `agg:${g.from}|${g.to}`,
        from: g.from, to: g.to,
        label: `×${g.edges.length}`,
        async: g.edges.every((e) => e.arrow === "~>"),
        animate: g.edges.every((e) => e.arrow === "~>" && e.attrs.animate !== "false"),
        count: g.edges.length,
        tags: [...new Set(g.edges.flatMap((e) => e.tags))],
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
  const finalEdges = scopeEdges.filter((e) => visSet().has(e.from) && visSet().has(e.to));

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
      const preview =
        previewMode === "none"
          ? []
          : leaves
              .map((l) => model.nodes.get(l)?.icon)
              .filter((i): i is NonNullable<typeof i> => !!i)
              .slice(0, 3);
      const glyphRef = container.attrs["glyph"];
      const glyph = glyphRef?.includes("/")
        ? { pack: glyphRef.split("/")[0], id: glyphRef.split("/")[1] }
        : undefined;
      return {
        path,
        kind: isContext ? "context-card" : "card",
        label: container.label ?? container.name,
        glyph,
        tagline:
          container.attrs["description"] ??
          `${leaves.length} component${leaves.length === 1 ? "" : "s"}`,
        preview,
        tags: effectiveTags(path),
        external: container.kinds.includes("external") || undefined,
        frame: frameOf.get(path),
      };
    }
    const n = model.nodes.get(path)!;
    return {
      path,
      kind: isContext ? "context-leaf" : "leaf",
      label: n.label,
      icon: n.icon,
      preview: [],
      tags: effectiveTags(path),
      external: n.kinds.includes("external") || undefined,
      description: n.description,
      frame: frameOf.get(path),
    };
  });

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

  return { nodes, edges: finalEdges, frames, flow, diagnostics };
}
