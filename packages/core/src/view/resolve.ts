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
}

export interface VEdge {
  id: string; // original edge id, or agg:<from>|<to>
  from: string;
  to: string;
  label?: string;
  async: boolean;
  count: number; // >1 = aggregate
}

export interface ViewGraph {
  nodes: VNode[];
  edges: VEdge[];
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

  // expand: v1 slice — inline children without a container frame (recession later)
  for (const ex of view.expand) {
    const i = visible.indexOf(ex);
    const c = model.containers.get(ex);
    if (i >= 0 && c) {
      diagnostics.push({
        severity: "warning",
        message: `expand \`${ex}\`: inlined without a container frame (recession rendering is coming)`,
        loc: view.loc,
      });
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
  const v = visSet();
  interface Group { edges: typeof model.edges; from: string; to: string }
  const groups = new Map<string, Group>();
  for (const e of model.edges) {
    const f = liftIn(e.from, v);
    const t = liftIn(e.to, v);
    if (!f || !t || f === t) continue;
    const key = `${f}|${t}`;
    if (!groups.has(key)) groups.set(key, { edges: [], from: f, to: t });
    groups.get(key)!.edges.push(e);
  }
  const edges: VEdge[] = [...groups.values()].map((g) => {
    if (g.edges.length === 1) {
      const e = g.edges[0];
      return {
        id: e.id, from: g.from, to: g.to,
        label: e.label, async: e.arrow === "~>", count: 1,
      };
    }
    return {
      id: `agg:${g.from}|${g.to}`,
      from: g.from, to: g.to,
      label: `×${g.edges.length}`,
      async: g.edges.every((e) => e.arrow === "~>"),
      count: g.edges.length,
    };
  });

  // context cards must earn their spot: drop any without a surviving edge
  for (const c of [...contextSet]) {
    if (!edges.some((e) => e.from === c || e.to === c)) {
      contextSet.delete(c);
      visible = visible.filter((p) => p !== c);
    }
  }
  const finalEdges = edges.filter((e) => visSet().has(e.from) && visSet().has(e.to));

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
    };
  });

  return { nodes, edges: finalEdges, diagnostics };
}
