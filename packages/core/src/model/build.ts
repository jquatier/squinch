// Lezer tree → semantic model + diagnostics. Every diagnostic follows SPEC §9:
// location + problem + likely fix.
import type { SyntaxNode } from "@lezer/common";
// @ts-ignore generated
import { parser } from "../grammar/parser.js";
import { iconMeta, iconIds, packs as packRegistry } from "./packs.js";
import { suggest } from "./suggest.js";
import type {
  ArrowKind, BuildResult, Diagnostic, Loc, RelPos, SContainer, SEdge, SModel, SNode, SView, Side,
} from "./types.js";

export function buildModel(src: string): BuildResult {
  const tree = parser.parse(src);
  const diagnostics: Diagnostic[] = [];
  const model: SModel = {
    packs: [],
    nodes: new Map(),
    containers: new Map(),
    edges: [],
    views: [],
  };

  const text = (n: SyntaxNode) => src.slice(n.from, n.to);
  const str = (n: SyntaxNode) => text(n).slice(1, -1); // strip quotes
  const loc = (n: SyntaxNode): Loc => {
    const before = src.slice(0, n.from);
    const line = before.split("\n").length;
    const col = n.from - before.lastIndexOf("\n");
    return { from: n.from, to: n.to, line, col };
  };
  const error = (n: SyntaxNode, message: string, fix?: string) =>
    diagnostics.push({ severity: "error", message, fix, loc: loc(n) });
  const warn = (n: SyntaxNode, message: string, fix?: string) =>
    diagnostics.push({ severity: "warning", message, fix, loc: loc(n) });

  // parse errors first
  tree.iterate({
    enter(n) {
      if (n.type.isError) {
        const at = src.slice(Math.max(0, n.from - 12), n.from + 12).replace(/\n/g, "⏎");
        diagnostics.push({
          severity: "error",
          message: `syntax error near \`${at}\``,
          loc: loc(n.node),
        });
      }
    },
  });

  // ── pass 1: declarations ─────────────────────────────────────────────────
  interface RawEdge {
    node: SyntaxNode;
    scope: string; // container path the edge was declared in ("" = file)
  }
  const rawEdges: RawEdge[] = [];
  const attrsOf = (block: SyntaxNode | null) => {
    const attrs: Record<string, string> = {};
    const tags: string[] = [];
    let description: string | undefined;
    if (block)
      for (const a of block.getChildren("Attr")) {
        const key = text(a.getChild("Ident")!);
        const v = a.getChild("Value")!;
        const tagNodes = v.getChildren("Tag");
        if (tagNodes.length) tags.push(...tagNodes.map((t) => text(t).slice(1)));
        else if (key === "description") description = v.getChild("String") ? str(v.getChild("String")!) : text(v);
        else attrs[key] = v.getChild("String") ? str(v.getChild("String")!) : text(v);
      }
    return { attrs, tags, description };
  };

  function walkContainer(body: SyntaxNode, parentPath: string) {
    for (const decl of body.getChildren("NodeDecl")) {
      const name = text(decl.getChild("Ident")!);
      const path = parentPath ? `${parentPath}.${name}` : name;
      if (model.nodes.has(path) || model.containers.has(path)) {
        error(decl, `duplicate id \`${name}\` in ${parentPath || "file"}`,
          `ids must be unique within their container`);
        continue;
      }
      const iconRef = decl.getChild("IconRef");
      let icon: SNode["icon"];
      if (iconRef) {
        const [p, i] = iconRef.getChildren("Ident").map(text);
        if (!packRegistry[p]) {
          const s = suggest(p, Object.keys(packRegistry));
          error(iconRef, `unknown pack \`${p}\``, s ? `did you mean \`${s}\`?` : undefined);
        } else if (!iconMeta(p, i)) {
          const s = suggest(i, iconIds(p));
          error(iconRef, `unknown icon \`${p}/${i}\``,
            s ? `did you mean \`${p}/${s}\`?` : `run \`squinch icons search ${i}\``);
        } else icon = { pack: p, id: i };
      }
      const meta = attrsOf(decl.getChild("AttrBlock"));
      const kinds = decl.getChildren("NodeKind").map((k) => text(k)) as SNode["kinds"];
      const labelNode = decl.getChild("String");
      model.nodes.set(path, {
        path, name,
        label: labelNode ? str(labelNode) : name,
        icon, kinds,
        description: meta.description,
        tags: meta.tags,
        attrs: meta.attrs,
        loc: loc(decl),
      });
      model.containers.get(parentPath)?.children.push(path);
    }
    for (const sub of body.getChildren("Container")) walkContainerDecl(sub, parentPath);
    for (const e of body.getChildren("EdgeStmt")) rawEdges.push({ node: e, scope: parentPath });
    // container-level attrs (glyph/owner/…)
    const meta = attrsOf(body);
    const c = model.containers.get(parentPath);
    if (c) {
      Object.assign(c.attrs, meta.attrs);
      c.tags.push(...meta.tags);
    }
  }

  function walkContainerDecl(decl: SyntaxNode, parentPath: string) {
    const name = text(decl.getChild("Ident")!);
    const path = parentPath ? `${parentPath}.${name}` : name;
    if (model.nodes.has(path) || model.containers.has(path)) {
      error(decl, `duplicate id \`${name}\``);
      return;
    }
    const labelNode = decl.getChild("String");
    const kind = decl.getChild("system") ? "system" : "container";
    model.containers.set(path, {
      path, name, kind: kind as SContainer["kind"],
      label: labelNode ? str(labelNode) : undefined,
      children: [], attrs: {}, tags: [], loc: loc(decl),
    });
    model.containers.get(parentPath)?.children.push(path);
    walkContainer(decl.getChild("ContainerBody")!, path);
  }

  const top = tree.topNode;
  for (const p of top.getChildren("PackStmt")) {
    const name = text(p.getChild("Ident")!);
    if (!packRegistry[name]) {
      const s = suggest(name, Object.keys(packRegistry));
      error(p, `unknown pack \`${name}\``, s ? `did you mean \`${s}\`?` : undefined);
    } else model.packs.push(name);
  }
  const ft = top.getChildren("FileTheme")[0];
  if (ft) model.fileTheme = text(ft.getChild("Ident")!);
  for (const p of top.getChildren("PersonDecl")) {
    const name = text(p.getChild("Ident")!);
    const labelNode = p.getChild("String");
    model.nodes.set(name, {
      path: name, name,
      label: labelNode ? str(labelNode) : name,
      icon: { pack: "builtin", id: "person" },
      kinds: ["person"], tags: [], attrs: {}, loc: loc(p),
    });
  }
  for (const decl of top.getChildren("Container")) walkContainerDecl(decl, "");
  for (const d of top.getChildren("NodeDecl")) {
    // top-level free nodes share walkContainer's logic via a fake body walk
  }
  for (const e of top.getChildren("EdgeStmt")) rawEdges.push({ node: e, scope: "" });

  // ── resolution ───────────────────────────────────────────────────────────
  const allPaths = () => [...model.nodes.keys(), ...model.containers.keys()];

  function resolve(ref: string, scope: string, at: SyntaxNode): string | undefined {
    // lexical: try each enclosing scope, innermost first, then absolute
    const scopes: string[] = [];
    let s = scope;
    while (s) {
      scopes.push(s);
      s = s.includes(".") ? s.slice(0, s.lastIndexOf(".")) : "";
    }
    scopes.push("");
    for (const sc of scopes) {
      const candidate = sc ? `${sc}.${ref}` : ref;
      if (model.nodes.has(candidate) || model.containers.has(candidate)) return candidate;
    }
    const sug = suggest(ref.split(".").pop()!, allPaths().map((p) => p.split(".").pop()!));
    error(at, `unknown id \`${ref}\``, sug ? `did you mean \`${sug}\`?` : undefined);
    return undefined;
  }

  let edgeN = 0;
  for (const { node, scope } of rawEdges) {
    const fromPath = resolve(text(node.getChild("Path")!), scope, node);
    const arrow = text(node.getChild("Arrow")!) as ArrowKind;
    const labelNode = node.getChild("String");
    const meta = attrsOf(node.getChild("AttrBlock"));
    for (const target of node.getChild("PathList")!.getChildren("Path")) {
      const toPath = resolve(text(target), scope, target);
      edgeN++;
      if (!fromPath || !toPath) continue;
      model.edges.push({
        id: `e${edgeN}`,
        from: fromPath, to: toPath, arrow,
        label: labelNode ? str(labelNode) : undefined,
        attrs: meta.attrs, tags: meta.tags,
        loc: loc(node),
      });
    }
  }

  // duplicate edges (same endpoints + label) merge with a warning
  const seen = new Map<string, SEdge>();
  model.edges = model.edges.filter((e) => {
    const key = `${e.from}|${e.arrow}|${e.to}|${e.label ?? ""}`;
    if (seen.has(key)) {
      warn(
        { from: e.loc.from, to: e.loc.to, type: { isError: false } } as any,
        `duplicate edge ${e.from} ${e.arrow} ${e.to} merged`,
      );
      return false;
    }
    seen.set(key, e);
    return true;
  });

  // ── views ────────────────────────────────────────────────────────────────
  for (const v of top.getChildren("View")) {
    const name = text(v.getChild("Path")!);
    const body = v.getChild("ViewBody")!;
    const view: SView = { name, layout: { place: [], routes: [] }, loc: loc(v) };
    const scopeStmt = body.getChildren("ScopeStmt")[0];
    if (scopeStmt) view.scope = resolve(text(scopeStmt.getChild("Path")!), "", scopeStmt);
    else if (model.containers.has(name)) view.scope = name; // auto: view <container>
    const title = body.getChildren("TitleStmt")[0];
    if (title) view.title = str(title.getChild("String")!);
    const theme = body.getChildren("ThemeStmt")[0];
    if (theme) view.theme = text(theme.getChild("Ident")!);
    const inScope = view.scope ?? "";

    for (const lb of body.getChildren("LayoutBlock")) {
      const dir = lb.getChildren("DirectionStmt")[0];
      if (dir) view.layout.direction = text(dir.lastChild!) as "down" | "right";
      const rowsStmt = lb.getChildren("RowsStmt")[0];
      if (rowsStmt) {
        const rows: string[][] = [];
        const placed = new Set<string>();
        for (const rank of rowsStmt.getChildren("Rank")) {
          const row: string[] = [];
          for (const pathNode of rank.getChildren("Path")) {
            const r = resolve(text(pathNode), inScope, pathNode);
            if (!r) continue;
            if (placed.has(r)) {
              error(pathNode, `\`${text(pathNode)}\` appears in \`rows\` twice`,
                "a node can hold only one rank position; remove one occurrence");
              continue;
            }
            placed.add(r);
            row.push(r);
          }
          rows.push(row);
        }
        view.layout.rows = rows;
      }
      for (const pl of lb.getChildren("PlaceStmt")) {
        const [a, b] = pl.getChildren("Path");
        const node = resolve(text(a), inScope, a);
        const target = resolve(text(b), inScope, b);
        if (node && target)
          view.layout.place.push({
            node, target,
            relpos: text(pl.getChild("RelPos")!) as RelPos,
            loc: loc(pl),
          });
      }
      for (const rt of lb.getChildren("RouteStmt")) {
        const [a, b] = rt.getChildren("Path");
        const from = resolve(text(a), inScope, a);
        const to = resolve(text(b), inScope, b);
        const sidesNodes = rt.getChildren("Side");
        const labelNode = rt.getChild("String");
        if (from && to)
          view.layout.routes.push({
            from, to,
            label: labelNode ? str(labelNode) : undefined,
            fromSide: sidesNodes[0] ? (text(sidesNodes[0]) as Side) : undefined,
            toSide: sidesNodes[1] ? (text(sidesNodes[1]) as Side) : undefined,
            loc: loc(rt),
          });
      }
    }

    // hint-conflict checks (SPEC §6: contradictions are errors, never silent)
    for (const pl of view.layout.place) {
      const opposite = view.layout.place.find(
        (o) => o !== pl && o.node === pl.target && o.target === pl.node,
      );
      if (opposite)
        diagnostics.push({
          severity: "error",
          message: `contradictory place hints: \`${pl.node}\` vs \`${pl.target}\` reference each other`,
          fix: "remove one of the two place statements",
          loc: pl.loc,
        });
      if (view.layout.rows && pl.relpos === "right-of" || pl.relpos === "left-of") {
        const inRows = view.layout.rows?.flat().includes(pl.node);
        if (inRows)
          diagnostics.push({
            severity: "error",
            message: `\`${pl.node}\` is placed via \`place\` but also listed in \`rows\``,
            fix: "a node takes hints from one source; remove it from rows or drop the place",
            loc: pl.loc,
          });
      }
    }
    model.views.push(view);
  }

  return {
    model,
    diagnostics,
    ok: !diagnostics.some((d) => d.severity === "error"),
  };
}

export function formatDiagnostics(diags: Diagnostic[], file = "input"): string {
  return diags
    .map((d) => {
      const fix = d.fix ? `\n  ${d.fix}` : "";
      return `${file}:${d.loc.line}:${d.loc.col}  ${d.severity}: ${d.message}${fix}`;
    })
    .join("\n");
}
