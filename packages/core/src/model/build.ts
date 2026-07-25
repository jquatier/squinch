// Lezer trees → semantic model + diagnostics. Every diagnostic follows SPEC §9:
// location + problem + likely fix. A project is one or more files merging into a
// single model namespace: declarations are collected per file, resolution runs
// across all of them (SPEC §2 "Projects").
import type { SyntaxNode } from "@lezer/common";
// @ts-ignore generated
import { parser } from "../grammar/parser.js";
import { iconExists, packExists, iconIds, allPackNames } from "./packs.js";
import { suggest } from "./suggest.js";
import type {
  ArrowKind, BuildResult, Diagnostic, Loc, RelPos, SContainer, SEdge, SModel, SNode, SNote, SView, Side,
} from "./types.js";

export interface ProjectFile {
  name: string;
  src: string;
}

interface Ctx {
  name: string;
  src: string;
  text: (n: SyntaxNode) => string;
  str: (n: SyntaxNode) => string;
  loc: (n: SyntaxNode) => Loc;
}

export function buildModel(src: string): BuildResult {
  return buildProject([{ name: "input", src }]);
}

export function buildProject(files: ProjectFile[]): BuildResult {
  const diagnostics: Diagnostic[] = [];
  const model: SModel = {
    packs: [],
    nodes: new Map(),
    containers: new Map(),
    edges: [],
    views: [],
  };

  const makeCtx = (name: string, src: string): Ctx => ({
    name,
    src,
    text: (n) => src.slice(n.from, n.to),
    str: (n) => src.slice(n.from + 1, n.to - 1),
    loc: (n) => {
      const before = src.slice(0, n.from);
      return {
        from: n.from,
        to: n.to,
        line: before.split("\n").length,
        col: n.from - before.lastIndexOf("\n"),
      };
    },
  });
  const error = (ctx: Ctx, at: SyntaxNode | Loc, message: string, fix?: string) =>
    diagnostics.push({
      severity: "error", message, fix, file: ctx.name,
      loc: "from" in at && "line" in at ? (at as Loc) : ctx.loc(at as SyntaxNode),
    });
  const warn = (ctx: Ctx, at: SyntaxNode | Loc, message: string, fix?: string) =>
    diagnostics.push({
      severity: "warning", message, fix, file: ctx.name,
      loc: "from" in at && "line" in at ? (at as Loc) : ctx.loc(at as SyntaxNode),
    });

  const attrsOf = (ctx: Ctx, block: SyntaxNode | null) => {
    const attrs: Record<string, string> = {};
    const tags: string[] = [];
    let description: string | undefined;
    if (block)
      for (const a of block.getChildren("Attr")) {
        const key = ctx.text(a.getChild("Ident")!);
        const v = a.getChild("Value")!;
        const tagNodes = v.getChildren("Tag");
        if (tagNodes.length) tags.push(...tagNodes.map((t) => ctx.text(t).slice(1)));
        else if (key === "description")
          description = v.getChild("String") ? ctx.str(v.getChild("String")!) : ctx.text(v);
        else attrs[key] = v.getChild("String") ? ctx.str(v.getChild("String")!) : ctx.text(v);
      }
    return { attrs, tags, description };
  };

  // ── phase A: declarations, per file ───────────────────────────────────────
  const rawEdges: { node: SyntaxNode; scope: string; ctx: Ctx }[] = [];
  const rawViews: { node: SyntaxNode; ctx: Ctx }[] = [];

  for (const f of files) {
    const ctx = makeCtx(f.name, f.src);
    const tree = parser.parse(f.src);

    tree.iterate({
      enter(n: any) {
        if (n.type.isError) {
          const at = f.src.slice(Math.max(0, n.from - 12), n.from + 12).replace(/\n/g, "⏎");
          error(ctx, n.node, `syntax error near \`${at}\``);
        }
      },
    });

    /** Declare one node; works at any depth, including the file top level. */
    function declareNode(decl: SyntaxNode, parentPath: string) {
      const name = ctx.text(decl.getChild("Ident")!);
      const path = parentPath ? `${parentPath}.${name}` : name;
      const clash = model.nodes.get(path) ?? model.containers.get(path);
      if (clash) {
        error(ctx, decl, `duplicate id \`${name}\` in ${parentPath || "file"}`,
          clash.file && clash.file !== ctx.name
            ? `already declared in ${clash.file}`
            : `ids must be unique within their container`);
        return;
      }
      const iconRef = decl.getChild("IconRef");
      let icon: SNode["icon"];
      if (!iconRef && decl.getChild("box")) icon = { pack: "builtin", id: "box" };
      if (iconRef && iconRef.getChildren("Ident").length === 2) {
        const [p, i] = iconRef.getChildren("Ident").map(ctx.text);
        if (!packExists(p)) {
          const s = suggest(p, allPackNames());
          error(ctx, iconRef, `unknown pack \`${p}\``, s ? `did you mean \`${s}\`?` : undefined);
        } else if (!iconExists(p, i)) {
          const s = suggest(i, iconIds(p));
          error(ctx, iconRef, `unknown icon \`${p}/${i}\``,
            s ? `did you mean \`${p}/${s}\`?` : `run \`squinch icons search ${i}\``);
        } else icon = { pack: p, id: i };
      }
      const meta = attrsOf(ctx, decl.getChild("AttrBlock"));
      const kinds = decl.getChildren("NodeKind").map((k) => ctx.text(k)) as SNode["kinds"];
      const labelNode = decl.getChild("String");
      model.nodes.set(path, {
        path, name,
        label: labelNode ? ctx.str(labelNode) : name,
        icon, kinds,
        description: meta.description,
        tags: meta.tags,
        attrs: meta.attrs,
        loc: ctx.loc(decl),
        file: ctx.name,
      });
      model.containers.get(parentPath)?.children.push(path);
    }

    function walkContainer(body: SyntaxNode, parentPath: string) {
      for (const decl of body.getChildren("NodeDecl")) declareNode(decl, parentPath);
      for (const sub of body.getChildren("Container")) walkContainerDecl(sub, parentPath);
      for (const e of body.getChildren("EdgeStmt")) rawEdges.push({ node: e, scope: parentPath, ctx });
      const meta = attrsOf(ctx, body);
      const c = model.containers.get(parentPath);
      if (c) {
        Object.assign(c.attrs, meta.attrs);
        if (meta.description) c.attrs["description"] = meta.description;
        c.tags.push(...meta.tags);
      }
    }

    function walkContainerDecl(decl: SyntaxNode, parentPath: string) {
      const name = ctx.text(decl.getChild("Ident")!);
      const path = parentPath ? `${parentPath}.${name}` : name;
      const clash = model.nodes.get(path) ?? model.containers.get(path);
      if (clash) {
        error(ctx, decl, `duplicate id \`${name}\``,
          clash.file && clash.file !== ctx.name ? `already declared in ${clash.file}` : undefined);
        return;
      }
      const labelNode = decl.getChild("String");
      const kind = decl.getChild("system") ? "system" : "container";
      model.containers.set(path, {
        path, name, kind: kind as SContainer["kind"],
        label: labelNode ? ctx.str(labelNode) : undefined,
        children: [], attrs: {}, tags: [], loc: ctx.loc(decl), file: ctx.name,
      });
      model.containers.get(parentPath)?.children.push(path);
      walkContainer(decl.getChild("ContainerBody")!, path);
    }

    const top = tree.topNode;
    for (const p of top.getChildren("PackStmt")) {
      const name = ctx.text(p.getChild("Ident")!);
      if (!packExists(name)) {
        const s = suggest(name, allPackNames());
        error(ctx, p, `unknown pack \`${name}\``, s ? `did you mean \`${s}\`?` : undefined);
      } else if (!model.packs.includes(name)) model.packs.push(name);
    }
    const ft = top.getChildren("FileTheme")[0];
    if (ft) model.fileTheme = ctx.text(ft.getChild("Ident")!);
    for (const p of top.getChildren("PersonDecl")) {
      const name = ctx.text(p.getChild("Ident")!);
      const labelNode = p.getChild("String");
      model.nodes.set(name, {
        path: name, name,
        label: labelNode ? ctx.str(labelNode) : name,
        icon: { pack: "builtin", id: "person" },
        kinds: ["person"], tags: [], attrs: {}, loc: ctx.loc(p), file: ctx.name,
      });
    }
    for (const decl of top.getChildren("NodeDecl")) declareNode(decl, "");
    for (const decl of top.getChildren("Container")) walkContainerDecl(decl, "");
    for (const e of top.getChildren("EdgeStmt")) rawEdges.push({ node: e, scope: "", ctx });
    for (const v of top.getChildren("View")) rawViews.push({ node: v, ctx });
  }

  // ── phase B: resolution across all files ─────────────────────────────────
  const allPaths = () => [...model.nodes.keys(), ...model.containers.keys()];

  function resolve(ref: string, scope: string, at: SyntaxNode, ctx: Ctx): string | undefined {
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
    // suggest full paths: a bare `create` that only exists as `a.b.create`
    // must be shown with its path, or the fix reads as a no-op.
    const leaf = ref.split(".").pop()!;
    const candidates = allPaths();
    const sameLeaf = candidates.filter((p) => p.split(".").pop() === leaf && p !== ref);
    const sug = sameLeaf[0] ?? suggest(ref, candidates) ?? suggest(leaf, candidates.map((p) => p.split(".").pop()!));
    const shown = sug && !candidates.includes(sug)
      ? candidates.find((p) => p.split(".").pop() === sug) ?? sug
      : sug;
    error(ctx, at, `unknown id \`${ref}\``, shown ? `did you mean \`${shown}\`?` : undefined);
    return undefined;
  }

  let edgeN = 0;
  for (const { node, scope, ctx } of rawEdges) {
    const fromPath = resolve(ctx.text(node.getChild("Path")!), scope, node, ctx);
    const arrow = ctx.text(node.getChild("Arrow")!) as ArrowKind;
    const labelNode = node.getChild("String");
    const meta = attrsOf(ctx, node.getChild("AttrBlock"));
    for (const target of node.getChild("PathList")!.getChildren("Path")) {
      const toPath = resolve(ctx.text(target), scope, target, ctx);
      edgeN++;
      if (!fromPath || !toPath) continue;
      model.edges.push({
        id: `e${edgeN}`,
        from: fromPath, to: toPath, arrow,
        label: labelNode ? ctx.str(labelNode) : undefined,
        attrs: meta.attrs, tags: meta.tags,
        loc: ctx.loc(node), file: ctx.name,
      });
    }
  }

  // duplicate edges (same endpoints + label) merge with a warning
  const seen = new Map<string, SEdge>();
  model.edges = model.edges.filter((e) => {
    const key = `${e.from}|${e.arrow}|${e.to}|${e.label ?? ""}`;
    if (seen.has(key)) {
      diagnostics.push({
        severity: "warning",
        message: `duplicate edge ${e.from} ${e.arrow} ${e.to} merged`,
        loc: e.loc, file: e.file,
      });
      return false;
    }
    seen.set(key, e);
    return true;
  });

  // ── phase C: views ────────────────────────────────────────────────────────
  for (const { node: v, ctx } of rawViews) {
    const name = ctx.text(v.getChild("Path")!);
    const body = v.getChild("ViewBody")!;
    const view: SView = {
      name,
      include: [], includeStar: false, exclude: [], expand: [],
      context: "auto", highlight: [], showDescriptions: false, notes: [],
      layout: { place: [], routes: [] },
      loc: ctx.loc(v), file: ctx.name,
    };
    const scopeStmt = body.getChildren("ScopeStmt")[0];
    if (scopeStmt) view.scope = resolve(ctx.text(scopeStmt.getChild("Path")!), "", scopeStmt, ctx);
    else if (model.containers.has(name)) view.scope = name; // auto: view <container>
    const title = body.getChildren("TitleStmt")[0];
    if (title) view.title = ctx.str(title.getChild("String")!);
    const theme = body.getChildren("ThemeStmt")[0];
    if (theme) view.theme = ctx.text(theme.getChild("Ident")!);
    const inScope = view.scope ?? "";

    for (const inc of body.getChildren("IncludeStmt")) {
      if (inc.getChild("Star")) view.includeStar = true;
      for (const t of inc.getChild("TargetList")?.getChildren("Target") ?? []) {
        const tag = t.getChild("Tag");
        if (tag) view.include.push({ tag: ctx.text(tag).slice(1) });
        else {
          const r = resolve(ctx.text(t.getChild("Path")!), inScope, t, ctx);
          if (r) view.include.push(r);
        }
      }
    }
    for (const exc of body.getChildren("ExcludeStmt")) {
      for (const t of exc.getChild("TargetList")?.getChildren("Target") ?? []) {
        const tag = t.getChild("Tag");
        if (tag) view.exclude.push({ tag: ctx.text(tag).slice(1) });
        else {
          const r = resolve(ctx.text(t.getChild("Path")!), inScope, t, ctx);
          if (r) view.exclude.push(r);
        }
      }
    }
    for (const ex of body.getChildren("ExpandStmt")) {
      const r = resolve(ctx.text(ex.getChild("Path")!), inScope, ex, ctx);
      if (r) view.expand.push(r);
    }
    const ctxStmt = body.getChildren("ContextStmt")[0];
    if (ctxStmt) view.context = ctxStmt.getChild("off") ? "off" : "auto";
    for (const h of body.getChildren("HighlightStmt"))
      view.highlight.push(...h.getChildren("Tag").map((t) => ctx.text(t).slice(1)));
    if (body.getChildren("ShowStmt").length) view.showDescriptions = true;
    for (const n of body.getChildren("NoteStmt")) {
      const anchorNode = n.getChild("NoteAnchor")!;
      const noteText = ctx.str(n.getChild("String")!);
      const meta = attrsOf(ctx, n.getChild("AttrBlock"));
      let anchor: SNote["anchor"] | undefined;
      const relpos = anchorNode.getChild("RelPos");
      const corner = anchorNode.getChild("Corner");
      if (relpos) {
        const r = resolve(ctx.text(anchorNode.getChild("Path")!), inScope, anchorNode, ctx);
        if (r) anchor = { kind: "relpos", relpos: ctx.text(relpos) as any, target: r };
      } else if (corner) {
        anchor = { kind: "corner", corner: ctx.text(corner) as any };
      } else {
        const [a, b] = anchorNode.getChildren("Path");
        const from = resolve(ctx.text(a), inScope, a, ctx);
        const to = resolve(ctx.text(b), inScope, b, ctx);
        if (from && to) anchor = { kind: "edge", from, to };
      }
      if (anchor)
        view.notes.push({ anchor, text: noteText, style: meta.attrs["style"], loc: ctx.loc(n) });
    }

    for (const lb of body.getChildren("LayoutBlock")) {
      const dir = lb.getChildren("DirectionStmt")[0];
      if (dir) view.layout.direction = ctx.text(dir.lastChild!) as "down" | "right";
      const den = lb.getChildren("DensityStmt")[0];
      if (den) {
        const val = ctx.text(den.getChild("Ident")!);
        if (val === "compact" || val === "comfortable" || val === "spacious")
          view.layout.density = val;
        else error(ctx, den, `unknown density \`${val}\``, "use compact | comfortable | spacious");
      }
      const lin = lb.getChildren("LinesStmt")[0];
      if (lin) {
        const val = ctx.text(lin.getChild("Ident")!);
        if (val === "orthogonal" || val === "curved" || val === "straight")
          view.layout.lines = val;
        else error(ctx, lin, `unknown lines style \`${val}\``, "use orthogonal | curved | straight");
      }
      for (const al of lb.getChildren("AlignStmt"))
        warn(ctx, al, "`align` is not implemented yet — parsed and ignored for now");
      const rowsStmt = lb.getChildren("RowsStmt")[0];
      if (rowsStmt) {
        const rows: string[][] = [];
        const placed = new Set<string>();
        for (const rank of rowsStmt.getChildren("Rank")) {
          const row: string[] = [];
          for (const pathNode of rank.getChildren("Path")) {
            const r = resolve(ctx.text(pathNode), inScope, pathNode, ctx);
            if (!r) continue;
            if (placed.has(r)) {
              error(ctx, pathNode, `\`${ctx.text(pathNode)}\` appears in \`rows\` twice`,
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
        const node = resolve(ctx.text(a), inScope, a, ctx);
        const target = resolve(ctx.text(b), inScope, b, ctx);
        if (node && target)
          view.layout.place.push({
            node, target,
            relpos: ctx.text(pl.getChild("RelPos")!) as RelPos,
            loc: ctx.loc(pl),
          });
      }
      for (const rt of lb.getChildren("RouteStmt")) {
        const [a, b] = rt.getChildren("Path");
        const from = resolve(ctx.text(a), inScope, a, ctx);
        const to = resolve(ctx.text(b), inScope, b, ctx);
        const sidesNodes = rt.getChildren("Side");
        const labelNode = rt.getChild("String");
        if (from && to)
          view.layout.routes.push({
            from, to,
            label: labelNode ? ctx.str(labelNode) : undefined,
            fromSide: sidesNodes[0] ? (ctx.text(sidesNodes[0]) as Side) : undefined,
            toSide: sidesNodes[1] ? (ctx.text(sidesNodes[1]) as Side) : undefined,
            loc: ctx.loc(rt),
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
          loc: pl.loc, file: ctx.name,
        });
      if ((view.layout.rows && pl.relpos === "right-of") || pl.relpos === "left-of") {
        const inRows = view.layout.rows?.flat().includes(pl.node);
        if (inRows)
          diagnostics.push({
            severity: "error",
            message: `\`${pl.node}\` is placed via \`place\` but also listed in \`rows\``,
            fix: "a node takes hints from one source; remove it from rows or drop the place",
            loc: pl.loc, file: ctx.name,
          });
      }
    }
    model.views.push(view);
  }

  // SPEC §5: every container gets a default view, so zoom navigation always has
  // somewhere to land. Declaring `view <path>` explicitly customizes that view.
  const scoped = new Set(model.views.map((v) => v.scope).filter(Boolean) as string[]);
  for (const path of model.containers.keys()) {
    if (scoped.has(path)) continue;
    model.views.push({
      name: path,
      scope: path,
      auto: true,
      include: [], includeStar: false, exclude: [], expand: [],
      context: "auto", highlight: [], showDescriptions: false, notes: [],
      layout: { place: [], routes: [] },
      loc: model.containers.get(path)!.loc,
      file: model.containers.get(path)!.file,
    });
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
      return `${d.file ?? file}:${d.loc.line}:${d.loc.col}  ${d.severity}: ${d.message}${fix}`;
    })
    .join("\n");
}
