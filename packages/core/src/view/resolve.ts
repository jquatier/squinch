// SPEC §5 visibility resolution + edge lifting. Pure: (model, view) → ViewGraph.
// Rule order: scope children → expand → context neighbors → include → exclude
// (exclude wins last) → edges/notes derive from what survived.
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
}

export interface ViewGraph {
  nodes: VNode[];
  edges: VEdge[];
  frames: VFrame[];
  diagnostics: Diagnostic[];
}

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

  /** Nearest visible ancestor-or-self, given the current visible set. */
  const liftIn = (path: string, v: Set<string>): string | undefined => {
    let p = path;
    while (p) {
      if (v.has(p)) return p;
      p = parentOf(p);
    }
    return undefined;
  };

  // ── 2. context neighbors (top-level lift, edge-earning) ──────────────────
  const contextSet = new Set<string>();
  if (view.context === "auto") {
    const v = visSet();
    for (const e of model.edges) {
      const fIn = liftIn(e.from, v);
      const tIn = liftIn(e.to, v);
      if (!!fIn === !!tIn) continue; // both in or both out
      const outside = fIn ? e.to : e.from;
      const candidate = liftIn(outside, v) ?? topOf(outside);
      if (!v.has(candidate)) contextSet.add(candidate);
    }
  }
  visible.push(...contextSet);

  // ── 3. include (explicit adds override the top-level context lift) ───────
  for (const inc of view.include) {
    if (typeof inc !== "string") {
      diagnostics.push({
        severity: "warning",
        message: `include #${inc.tag}: tag-based include is not built yet (v1.1)`,
        loc: view.loc,
      });
      continue;
    }
    if (!visible.includes(inc)) {
      visible.push(inc);
      // a deeper explicit include supersedes its lifted top-level context card
      const top = topOf(inc);
      if (contextSet.has(top) && top !== inc) {
        contextSet.delete(top);
        visible = visible.filter((p) => p !== top);
      }
      if (!scope || !inc.startsWith(`${scope}.`)) contextSet.add(inc);
    }
  }

  // ── 4. exclude wins last (removes whole subtrees) ─────────────────────────
  for (const exc of view.exclude) {
    if (typeof exc !== "string") {
      diagnostics.push({
        severity: "warning",
        message: `exclude #${exc.tag}: tag-based exclude is not built yet (v1.1)`,
        loc: view.loc,
      });
      continue;
    }
    visible = visible.filter((p) => p !== exc && !p.startsWith(`${exc}.`));
    contextSet.delete(exc);
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
      };
    } else {
      edges[slot] = {
        id: `agg:${g.from}|${g.to}`,
        from: g.from, to: g.to,
        label: `×${g.edges.length}`,
        async: g.edges.every((e) => e.arrow === "~>"),
        animate: g.edges.every((e) => e.arrow === "~>" && e.attrs.animate !== "false"),
        count: g.edges.length,
      };
    }
  }

  // Context exists to show how the scope connects outward. An edge between two
  // *outsiders* is their business, not this view's — suppress it, or zooming
  // into one service drags in the whole neighbourhood's wiring.
  const scopeEdges = edges.filter((e) => !(contextSet.has(e.from) && contextSet.has(e.to)));

  // context cards must earn their spot: drop any without a surviving edge
  for (const c of [...contextSet]) {
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
      description: n.description,
      frame: frameOf.get(path),
    };
  });

  return { nodes, edges: finalEdges, frames, diagnostics };
}
