// Lezer trees → semantic model + diagnostics. Every diagnostic follows SPEC §9:
// location + problem + likely fix. A project is one or more files merging into a
// single model namespace: declarations are collected per file, resolution runs
// across all of them (SPEC §2 "Projects").
import type { SyntaxNode } from "@lezer/common";
// @ts-ignore generated
import { parser } from "../grammar/parser.js";
import { iconExists, packExists, iconIds, allPackNames } from "./packs.js";
import { suggest } from "./suggest.js";
import { normalizeFiles } from "./source.js";
import { themes } from "../themes/index.js";
import type {
  ArrowKind, BuildResult, Diagnostic, Loc, RelPos, SContainer, SEdge, SModel, SNode, SNote, SView, Side, SFlow, SZone, ZoneColor, ZoneKind, ZoneLabelPos,
} from "./types.js";
import { ZONE_KINDS, ZONE_COLORS, EDGE_STYLES, EDGE_ANIMATE } from "./types.js";

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

export function buildProject(input: ProjectFile[]): BuildResult {
  // LF space from here down: every Loc, label and description a caller gets
  // back is measured against normalized source (see model/source.ts).
  const files = normalizeFiles(input);
  const diagnostics: Diagnostic[] = [];
  const model: SModel = {
    packs: [],
    nodes: new Map(),
    containers: new Map(),
    edges: [],
    zones: [],
    flows: [],
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

  /**
   * A declared theme name is static — it can be checked the moment the model is
   * built. It used to be validated only inside `render`, and `check` renders
   * every view with an explicit `light`, so a typo'd `theme` passed `check`
   * with "1 file(s) OK" and then failed the very next `render`. For a tool
   * whose loop is check-then-render, check has to be the authority.
   */
  const checkTheme = (ctx: Ctx, at: SyntaxNode, name: string) => {
    if (name in themes) return;
    const s = suggest(name, Object.keys(themes));
    error(ctx, at, `unknown theme \`${name}\``,
      s ? `did you mean \`${s}\`?` : `themes: ${Object.keys(themes).join(" | ")}`);
  };

  const attrsOf = (ctx: Ctx, block: SyntaxNode | null) => {
    const attrs: Record<string, string> = {};
    const tags: string[] = [];
    let description: string | undefined;
    if (block)
      for (const a of block.getChildren("Attr")) {
        // Both halves are optional in a *partial* parse, which is the state the
        // editor is in for most of the time anyone is typing: `tags:` with the
        // value not written yet leaves an Attr with no Value, and `tags` with
        // no colon leaves one with no Ident. Asserting either non-null threw
        // `Cannot read properties of null`, killing the build — and with it the
        // language server, on a keystroke. Same class as the round-4 crash on
        // `scope`/`title`/`theme`; this pair was missed because nothing had
        // ever fed the builder a half-written attribute.
        const identNode = a.getChild("Ident");
        const v = a.getChild("Value");
        if (!identNode || !v) continue;
        const key = ctx.text(identNode);
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
  const rawZones: { node: SyntaxNode; ctx: Ctx }[] = [];
  const rawFlows: { node: SyntaxNode; ctx: Ctx }[] = [];

  for (const f of files) {
    const ctx = makeCtx(f.name, f.src);
    const tree = parser.parse(f.src);

    let sawSyntaxError = false;
    const errorLines = new Set<number>(); // one syntax error per line, not a cascade
    tree.iterate({
      enter(n: any) {
        if (n.type.isError) {
          sawSyntaxError = true;
          const line = f.src.slice(0, n.from).split("\n").length;
          if (errorLines.has(line)) return;
          errorLines.add(line);
          const at = f.src.slice(Math.max(0, n.from - 12), n.from + 12).replace(/\n/g, "⏎");
          error(ctx, n.node, `syntax error near \`${at}\``);
        }
      },
    });
    // The most common authoring mistake: a `layout { }` block inside a
    // system/container. It only manifests as cascading syntax errors, so name
    // it explicitly with the fix.
    if (sawSyntaxError) {
      for (const c of tree.topNode.getChildren("Container")) {
        const bodyText = f.src.slice(c.from, c.to);
        const m = /^[ \t]*layout[ \t]*\{/m.exec(bodyText);
        if (!m) continue;
        const identNode = c.getChild("Ident");
        const sys = identNode ? ctx.text(identNode) : "NAME";
        const from = c.from + m.index + (m[0].length - m[0].trimStart().length);
        error(ctx, ctx.loc({ from, to: from + "layout".length } as SyntaxNode),
          `\`layout\` block inside \`${sys}\` — layout hints live in views, not systems`,
          `move it below the system: view ${sys} { layout { … } }`);
      }
      // The same mistake one level out: a `layout` block at the top of the
      // file, belonging to no view. It fell through to a bare syntax error
      // pointing at whatever preceded it, which names neither the problem nor
      // the fix. `layout` is only ever legal inside a `view`.
      const containers = tree.topNode.getChildren("Container");
      const views = tree.topNode.getChildren("View");
      for (const m of f.src.matchAll(/^[ \t]*layout[ \t]*\{/gm)) {
        const at = m.index! + (m[0].length - m[0].trimStart().length);
        if ([...containers, ...views].some((n) => at >= n.from && at < n.to)) continue;
        // if the file already declares a view, put it there; otherwise name one
        const first = views[0]?.getChild("Path");
        const into = first ? ctx.text(first) : "main";
        error(ctx, ctx.loc({ from: at, to: at + "layout".length } as SyntaxNode),
          "`layout` block at the top level — layout hints live inside a view",
          first
            ? `move it inside \`view ${into}\``
            : `wrap it: view ${into} { include *  layout { … } }`);
        // One mistake, one diagnostic. The stray block derails the parser for
        // the rest of the file, so it also produced a bare `syntax error near`
        // for every line of itself — noise in front of the message that
        // actually names the cause.
        const end = f.src.indexOf("\n}", at);
        const stop = end === -1 ? f.src.length : end + 2;
        for (let i = diagnostics.length - 1; i >= 0; i--) {
          const d = diagnostics[i];
          if (d.file === ctx.name && d.message.startsWith("syntax error near")
              && d.loc.from >= at && d.loc.from <= stop)
            diagnostics.splice(i, 1);
        }
      }
    }

    /** Declare one node; works at any depth, including the file top level. */
    function declareNode(decl: SyntaxNode, parentPath: string) {
      const identNode = decl.getChild("Ident");
      if (!identNode) return; // partial node from error recovery
      const name = ctx.text(identNode);
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
      // `badge:` is an icon reference like `glyph:` and gets the same two
      // errors — an unchecked ref would draw a blank plate, exit 0, and leave
      // the typo to be noticed by eye. The value is in practice a `logos/*`
      // brand mark composited onto the icon plate (SPEC §nodes): the sanctioned
      // way to say "this thing is Databricks'" for vendors that publish no
      // icon grant.
      if (meta.attrs["badge"]) {
        const [p, i] = meta.attrs["badge"].split("/");
        if (!p || !i || !packExists(p)) {
          const s = p && suggest(p, allPackNames());
          error(ctx, decl, `unknown pack \`${p ?? meta.attrs["badge"]}\` in badge`,
            s ? `did you mean \`${s}/${i ?? ""}\`?` : `use \`badge: <pack>/<id>\``);
        } else if (!iconExists(p, i)) {
          const s = suggest(i, iconIds(p));
          error(ctx, decl, `unknown icon \`${p}/${i}\` in badge`,
            s ? `did you mean \`${p}/${s}\`?` : `run \`squinch icons search ${i}\``);
        }
      }
      const kinds = decl.getChildren("NodeKind").map((k) => ctx.text(k)) as SNode["kinds"];
      // `= person "Name"` is the same node the top-level `person id "Label"`
      // form builds. Only a direct child matches here — a `person` used as a
      // kind sits inside a `NodeKind`, so the two never collide.
      if (!iconRef && decl.getChild("person")) {
        icon = { pack: "builtin", id: "person" };
        if (!kinds.includes("person")) kinds.push("person");
      }
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
        // `glyph:` used to be the one icon reference nobody checked: the view
        // layer splits it on `/` and shrugs, so a typo drew a `?` plate, exited
        // 0, and left you to notice by eye. Same two errors as a zone `icon:`.
        if (meta.attrs["glyph"]) {
          const [p, i] = meta.attrs["glyph"].split("/");
          if (!p || !i || !packExists(p)) {
            const s = p && suggest(p, allPackNames());
            error(ctx, body, `unknown pack \`${p ?? meta.attrs["glyph"]}\` in glyph`,
              s ? `did you mean \`${s}/${i ?? ""}\`?` : `use \`glyph: <pack>/<id>\``);
          } else if (!iconExists(p, i)) {
            const s = suggest(i, iconIds(p));
            error(ctx, body, `unknown icon \`${p}/${i}\` in glyph`,
              s ? `did you mean \`${p}/${s}\`?` : `run \`squinch icons search ${i}\``);
          }
        }
      }
    }

    function walkContainerDecl(decl: SyntaxNode, parentPath: string) {
      const identNode = decl.getChild("Ident");
      if (!identNode) return; // partial node from error recovery; syntax error already reported
      const name = ctx.text(identNode);
      const path = parentPath ? `${parentPath}.${name}` : name;
      const clash = model.nodes.get(path) ?? model.containers.get(path);
      if (clash) {
        error(ctx, decl, `duplicate id \`${name}\``,
          clash.file && clash.file !== ctx.name ? `already declared in ${clash.file}` : undefined);
        return;
      }
      const labelNode = decl.getChild("String");
      const kind = decl.getChild("system") ? "system" : "container";
      // Only `external` means anything on a container: DESIGN §3 gives it the
      // hatched card surface, and "someone else's system" is a fact about the
      // whole system. `datastore` and `person` describe a single node and have
      // no card treatment, so they are refused rather than quietly kept.
      const kinds: SContainer["kinds"] = [];
      for (const k of decl.getChildren("NodeKind")) {
        const word = ctx.text(k);
        if (word === "external") { if (!kinds.length) kinds.push("external"); }
        else
          error(ctx, k, `\`${word}\` on \`${kind} ${name}\` — only \`external\` applies to a ${kind}`,
            `\`${word}\` describes one node: put it on a node inside \`${name}\`, or drop it`);
      }
      model.containers.set(path, {
        path, name, kind: kind as SContainer["kind"], kinds,
        label: labelNode ? ctx.str(labelNode) : undefined,
        children: [], attrs: {}, tags: [], loc: ctx.loc(decl), file: ctx.name,
      });
      model.containers.get(parentPath)?.children.push(path);
      const body = decl.getChild("ContainerBody");
      if (body) walkContainer(body, path);
    }

    const top = tree.topNode;
    for (const p of top.getChildren("PackStmt")) {
      const identNode = p.getChild("Ident"); // `pack` alone, mid-typing
      if (!identNode) continue;
      const name = ctx.text(identNode);
      if (!packExists(name)) {
        const s = suggest(name, allPackNames());
        error(ctx, p, `unknown pack \`${name}\``, s ? `did you mean \`${s}\`?` : undefined);
      } else if (!model.packs.includes(name)) model.packs.push(name);
    }
    const ft = top.getChildren("FileTheme")[0];
    const ftIdent = ft?.getChild("Ident");
    if (ft && !ftIdent) error(ctx, ft, "`theme` needs a theme name", "theme dark");
    else if (ftIdent) {
      model.fileTheme = ctx.text(ftIdent);
      checkTheme(ctx, ftIdent, model.fileTheme);
    }
    for (const p of top.getChildren("PersonDecl")) {
      const identNode = p.getChild("Ident");
      if (!identNode) continue; // partial node from error recovery
      const name = ctx.text(identNode);
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
    for (const z of top.getChildren("ZoneDecl")) rawZones.push({ node: z, ctx });
    for (const fl of top.getChildren("FlowDecl")) rawFlows.push({ node: fl, ctx });
    for (const v of top.getChildren("View")) rawViews.push({ node: v, ctx });
  }

  // ── phase B: resolution across all files ─────────────────────────────────
  const allPaths = () => [...model.nodes.keys(), ...model.containers.keys()];
  // id → the names it lists, read straight off the parse tree rather than from
  // `model.zones`, which is not built until phase C: the outer boundary is
  // normally written first, so by the time its `contains` is resolved the inner
  // zone it names has not been seen yet, and a fix that cannot list the members
  // to copy is barely a fix.
  const zoneMemberNames = new Map<string, string[]>();
  for (const { node, ctx } of rawZones) {
    const i = node.getChild("Ident");
    const body = node.getChild("ZoneBody");
    if (!i) continue;
    zoneMemberNames.set(
      ctx.text(i),
      (body?.getChildren("ContainsStmt") ?? []).flatMap(
        (c) => c.getChild("PathList")?.getChildren("Path").map((p) => ctx.text(p)) ?? [],
      ),
    );
  }

  /** `zones: true` for the three ranking hints. A zone is one unit for layout —
   *  SPEC §5: "ranks apply to the zone as a whole … `rows` can pin a zone by its
   *  id" — and `unitOf` has always mapped a zone id to itself, so the engine
   *  could rank one all along. Only this function said otherwise, which made a
   *  documented capability a hard error and cost agents a `check` in three
   *  separate rounds. Everywhere else a zone id is still wrong: you cannot draw
   *  an edge to a boundary, and `contains` takes nodes. */
  function resolve(
    ref: string, scope: string, at: SyntaxNode, ctx: Ctx,
    opts: { zones?: boolean } = {},
  ): string | undefined {
    if (opts.zones && zoneMemberNames.has(ref)) return ref;
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
    // Naming a zone where a node belongs is the one wrong guess that reads as
    // right: zones nest by *sharing members*, so the outer one repeats the
    // inner one's leaves rather than naming it. Two of twenty round-5 agents
    // wrote `zone account { contains gw, vnet }` with `vnet` a zone of its own,
    // and "unknown id `vnet`" — with no suggestion, since no node is remotely
    // like it — told them nothing about which of the two ideas was wrong.
    // Every zone id, not just the ones declared above this point: zone order in
    // the file is free, and the outer boundary is usually written first.
    if (zoneMemberNames.has(ref)) {
      const inner = zoneMemberNames.get(ref)!;
      error(ctx, at, `\`${ref}\` is a zone, not a node`,
        `zones nest by containing the same members — list ${
          inner.length ? `\`${inner.join("`, `")}\`` : `\`${ref}\`'s own members`
        } here too, rather than naming \`${ref}\``);
      return undefined;
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
    const pathNode = node.getChild("Path");
    const arrowNode = node.getChild("Arrow");
    if (!pathNode || !arrowNode) continue; // partial node from error recovery
    const fromPath = resolve(ctx.text(pathNode), scope, node, ctx);
    const arrow = ctx.text(arrowNode) as ArrowKind;
    const labelNode = node.getChild("String");
    const meta = attrsOf(ctx, node.getChild("AttrBlock"));
    // an edge mid-typing (`a -> `) parses without a PathList — the editor
    // asks us to build on every keystroke, so partial trees must not throw
    const targets = node.getChild("PathList")?.getChildren("Path") ?? [];
    // Attr validation, once per statement. Attrs used to be stored verbatim
    // with no checking, so `animate: banana` rendered as ordinary flow and
    // `animte: false` was a silent no-op — exactly the dropped-hint class the
    // check contract forbids. Values follow the zone-colour pattern; keys get
    // a warning because SPEC names attrs (`description`, `color`) that parse
    // ahead of being wired.
    const EDGE_ATTR_KEYS = ["description", "animate", "style", "color"];
    for (const key of Object.keys(meta.attrs)) {
      if (EDGE_ATTR_KEYS.includes(key)) continue;
      const sug = suggest(key, EDGE_ATTR_KEYS);
      warn(ctx, node, `unknown edge attribute \`${key}\``,
        sug ? `did you mean \`${sug}\`?` : `one of: ${EDGE_ATTR_KEYS.join(", ")}`);
    }
    const style = meta.attrs.style;
    if (style !== undefined && !(EDGE_STYLES as readonly string[]).includes(style)) {
      const sug = suggest(style, [...EDGE_STYLES]);
      error(ctx, node, `unknown edge style \`${style}\``,
        sug ? `did you mean \`${sug}\`?` : `one of: ${EDGE_STYLES.join(", ")}`);
    }
    const animate = meta.attrs.animate;
    if (animate !== undefined && !(EDGE_ANIMATE as readonly string[]).includes(animate)) {
      const sug = suggest(animate, [...EDGE_ANIMATE]);
      error(ctx, node, `unknown animate value \`${animate}\``,
        sug ? `did you mean \`${sug}\`?` : `one of: ${EDGE_ANIMATE.join(", ")}`);
    }
    if (arrow === "~>" && style === "solid")
      error(ctx, node, "async edges are dashed by design — `style: solid` would erase the convention",
        "use `style: dotted` for a different pattern, or a sync arrow `->` if the call is synchronous");
    const travels = animate === "flow" || animate === "reverse" || animate === "slow" || animate === "fast";
    if (arrow !== "~>" && travels && style !== "dashed" && style !== "dotted")
      error(ctx, node, `\`animate: ${animate}\` needs a visible pattern to travel, and this edge is solid`,
        "add `style: dashed` (or `dotted`), or use `animate: pulse`, which works on solid lines");
    if (animate === "packets" && style !== undefined)
      error(ctx, node, "`animate: packets` draws its own sparse pattern — `style:` has nothing to add",
        "drop the `style:` attribute");
    for (const target of targets) {
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

  // DESIGN §3: "Lint nudges labels > ~40 chars." A label wraps to at most two
  // lines and is then ellipsized, so past this it is not a styling preference —
  // the reader loses text that is still in the source, and only a `<title>` or
  // a hover recovers it. 40 is DESIGN's number and it is well chosen: across
  // the 456 labels this repo owns, exactly 4 exceed it, all of them in the
  // lookbook case that exists to stress long labels.
  const LABEL_MAX = 40;
  for (const n of [...model.nodes.values(), ...model.containers.values()]) {
    const label = ("label" in n && n.label) || n.name;
    if (label.length <= LABEL_MAX) continue;
    warn(
      { name: n.file ?? "input" } as Ctx, n.loc,
      `label is ${label.length} characters — it will be cut off`,
      "labels wrap to two lines then ellipsize: shorten it and put the detail in `description:`",
    );
  }

  // An empty container is legal but almost never meant. It still gets an auto
  // view (SPEC §5), and that view has nothing in it — which used to render a
  // 0×0 SVG that `render` called ok and resvg then refused. A cold agent wrote
  // `system partner "Partner System" external { }` as a stand-in for someone
  // else's estate, which is a node, not a system: you are not modelling its
  // insides, so there is no altitude to descend to.
  for (const c of model.containers.values()) {
    if (c.children.length) continue;
    const label = c.label ? `"${c.label}"` : `"${c.name}"`;
    warn(
      { name: c.file ?? "input" } as Ctx, c.loc,
      `\`${c.kind} ${c.name}\` is empty`,
      `a ${c.kind} you are not breaking down is a node: `
        + `\`${c.name} = box ${label}${c.kinds.includes("external") ? " external" : ""}\``,
    );
  }

  // ── phase C: views ────────────────────────────────────────────────────────
  // flows: chains resolve against the finished namespace AND must walk
  // existing edges — a flow annotates structure, it never creates it
  for (const { node: fl, ctx } of rawFlows) {
    const identNode = fl.getChild("Ident");
    const bodyNode = fl.getChild("FlowBody");
    if (!identNode || !bodyNode) continue; // partial node from error recovery
    const id = ctx.text(identNode);
    if (model.flows.some((f) => f.id === id)) {
      error(ctx, fl, `duplicate flow \`${id}\``);
      continue;
    }
    const labelNode = fl.getChild("String");
    // flows read best with bare ids (SPEC example: api -> create -> db) — a
    // bare ref binds when exactly one node path ends with it
    const resolveFlowPath = (ref: string, at: SyntaxNode): string | undefined => {
      if (model.nodes.has(ref) || model.containers.has(ref)) return ref;
      if (!ref.includes(".")) {
        const matches = [...model.nodes.keys()].filter((k) => k.endsWith(`.${ref}`));
        if (matches.length === 1) return matches[0];
        if (matches.length > 1) {
          error(ctx, at, `ambiguous flow step \`${ref}\``,
            `use a full path: ${matches.join(" | ")}`);
          return undefined;
        }
      }
      return resolve(ref, "", at, ctx);
    };
    const steps: SFlow["steps"] = [];
    for (const chain of bodyNode.getChildren("FlowChain")) {
      const paths = chain.getChildren("Path").map((p) => resolveFlowPath(ctx.text(p), p));
      for (let i = 0; i < paths.length - 1; i++) {
        const from = paths[i], to = paths[i + 1];
        if (!from || !to) continue;
        const exists = model.edges.some(
          (e) =>
            (e.from === from && e.to === to) ||
            (e.arrow === "<->" && e.from === to && e.to === from),
        );
        if (!exists) {
          error(ctx, chain, `flow \`${id}\` step ${steps.length + 1}: no edge \`${from}\` → \`${to}\``,
            `flows number existing edges — declare \`${from} -> ${to}\` first`);
          continue;
        }
        steps.push({ from, to });
      }
    }
    if (steps.length === 0)
      warn(ctx, fl, `flow \`${id}\` has no steps`);
    model.flows.push({
      id, steps,
      label: labelNode ? ctx.str(labelNode) : undefined,
      loc: ctx.loc(fl), file: ctx.name,
    });
  }

  // zones: members resolve against the finished namespace (SPEC §Zones)
  for (const { node: z, ctx } of rawZones) {
    const identNode = z.getChild("Ident");
    const bodyNode = z.getChild("ZoneBody");
    if (!identNode || !bodyNode) continue; // partial node from error recovery
    const id = ctx.text(identNode);
    if (model.zones.some((existing) => existing.id === id)) {
      error(ctx, z, `duplicate zone \`${id}\``,
        `zone ids are global — rename one of the declarations`);
      continue;
    }
    const labelNode = z.getChild("String");
    const kindNode = z.getChild("ZoneKind");
    let kind: ZoneKind = "custom";
    if (kindNode) {
      const raw = ctx.text(kindNode);
      if ((ZONE_KINDS as readonly string[]).includes(raw)) kind = raw as ZoneKind;
      else {
        const sug = suggest(raw, [...ZONE_KINDS]);
        error(ctx, kindNode, `unknown zone kind \`${raw}\``,
          sug ? `did you mean \`${sug}\`?` : `one of: ${ZONE_KINDS.join(", ")}`);
        continue;
      }
    }
    const members: string[] = [];
    // `contains <zone-id>` is sugar for the inner zone's own members. Zones
    // nest by *sharing* leaves, and agents reach for naming the inner zone
    // instead — the diagnostic below `resolve` teaches the expansion, and this
    // just performs it, which is what that fix text already tells them to type.
    // Recursive, because the inner zone may itself be written that way; `seen`
    // makes a cycle (or a zone naming itself) terminate as an empty expansion,
    // caught downstream by the has-no-members warning.
    const expandZone = (ref: string, seen: Set<string>): string[] => {
      if (seen.has(ref)) return [];
      seen.add(ref);
      return (zoneMemberNames.get(ref) ?? []).flatMap((m) =>
        zoneMemberNames.has(m) ? expandZone(m, seen) : [m],
      );
    };
    const viaSugar = new Set<string>();
    for (const c of bodyNode.getChildren("ContainsStmt")) {
      const list = c.getChild("PathList");
      if (!list) continue;
      for (const p of list.getChildren("Path")) {
        const raw = ctx.text(p);
        const sugar = zoneMemberNames.has(raw);
        for (const ref of sugar ? expandZone(raw, new Set([id])) : [raw]) {
          const resolved = resolve(ref, "", p, ctx);
          if (!resolved) continue;
          if (members.includes(resolved)) {
            // an expansion overlapping something listed by hand is nesting
            // working as designed, not a mistake — only warn when the author
            // wrote the same leaf twice themselves
            if (!sugar && !viaSugar.has(resolved))
              warn(ctx, p, `\`${resolved}\` listed twice in zone \`${id}\``);
          } else {
            members.push(resolved);
            if (sugar) viaSugar.add(resolved);
          }
        }
      }
    }
    if (members.length === 0)
      warn(ctx, z, `zone \`${id}\` has no members`, `add \`contains <path>, …\``);
    // optional chip attrs: icon (pack/id, validated like node icons) and
    // label (which border corner the chip straddles)
    const zAttrs = attrsOf(ctx, bodyNode);
    let icon: SZone["icon"];
    if (zAttrs.attrs.icon) {
      const [p, i] = zAttrs.attrs.icon.split("/");
      if (!p || !i || !packExists(p)) {
        const s = p && suggest(p, allPackNames());
        error(ctx, z, `unknown pack \`${p ?? zAttrs.attrs.icon}\` in zone icon`,
          s ? `did you mean \`${s}/${i ?? ""}\`?` : `use \`icon: <pack>/<id>\``);
      } else if (!iconExists(p, i)) {
        const s = suggest(i, iconIds(p));
        error(ctx, z, `unknown icon \`${p}/${i}\``,
          s ? `did you mean \`${p}/${s}\`?` : `run \`squinch icons search ${i}\``);
      } else icon = { pack: p, id: i };
    }
    let color: ZoneColor | undefined;
    if (zAttrs.attrs.color) {
      if ((ZONE_COLORS as readonly string[]).includes(zAttrs.attrs.color)) color = zAttrs.attrs.color as ZoneColor;
      else {
        const s = suggest(zAttrs.attrs.color, [...ZONE_COLORS]);
        error(ctx, z, `unknown zone color \`${zAttrs.attrs.color}\` — theme roles only, never hex`,
          s ? `did you mean \`${s}\`?` : `one of: ${ZONE_COLORS.join(", ")}`);
      }
    }
    const LABEL_POS: ZoneLabelPos[] = ["top-left", "top-right", "bottom-left", "bottom-right"];
    let labelPos: ZoneLabelPos = "top-left";
    if (zAttrs.attrs.label) {
      if ((LABEL_POS as string[]).includes(zAttrs.attrs.label)) labelPos = zAttrs.attrs.label as ZoneLabelPos;
      else {
        const s = suggest(zAttrs.attrs.label, LABEL_POS);
        error(ctx, z, `unknown zone label position \`${zAttrs.attrs.label}\``,
          s ? `did you mean \`${s}\`?` : `one of: ${LABEL_POS.join(", ")}`);
      }
    }
    model.zones.push({
      id, kind, members, icon, labelPos, color,
      label: labelNode ? ctx.str(labelNode) : undefined,
      loc: ctx.loc(z), file: ctx.name,
    });
  }

  for (const { node: v, ctx } of rawViews) {
    const nameNode = v.getChild("Path");
    const bodyNode = v.getChild("ViewBody");
    if (!nameNode || !bodyNode) continue; // partial node from error recovery
    const name = ctx.text(nameNode);
    const body = bodyNode;
    const view: SView = {
      name,
      only: [], include: [], includeStar: false, exclude: [], expand: [], detail: [],
      context: "auto", highlight: [], showDescriptions: false, legend: false, notes: [],
      layout: { place: [], routes: [], align: [], channels: [] },
      loc: ctx.loc(v), file: ctx.name,
    };
    // These three took their operand with a `!`, and every one of them threw a
    // raw `Cannot read properties of null` — exit 2, no location, no fix — the
    // moment the operand was missing or the wrong shape. That is any keystroke
    // between typing `title` and typing its string, so it crashed the language
    // server too, and it is what a cold agent hit by writing `scope *` (which
    // parses as a ScopeStmt with no Path). Same class as the `layout`-inside-a-
    // system crash from round 2: a `!` on a node that invalid input makes null.
    const scopeStmt = body.getChildren("ScopeStmt")[0];
    const scopePath = scopeStmt?.getChild("Path");
    if (scopeStmt && !scopePath)
      error(ctx, scopeStmt, "`scope` needs a single container path",
        "scope narrows a view to one container; to widen a view to everything use `include *`");
    else if (scopePath) view.scope = resolve(ctx.text(scopePath), "", scopeStmt!, ctx);
    else if (model.containers.has(name)) view.scope = name; // auto: view <container>
    const title = body.getChildren("TitleStmt")[0];
    const titleStr = title?.getChild("String");
    if (title && !titleStr) error(ctx, title, "`title` needs a quoted string", 'title "My Diagram"');
    else if (titleStr) view.title = ctx.str(titleStr);
    const theme = body.getChildren("ThemeStmt")[0];
    const themeIdent = theme?.getChild("Ident");
    if (theme && !themeIdent) error(ctx, theme, "`theme` needs a theme name", "theme dark");
    else if (themeIdent) {
      view.theme = ctx.text(themeIdent);
      checkTheme(ctx, themeIdent, view.theme);
    }
    const inScope = view.scope ?? "";

    // `only` is the view's filter — the *which* axis, where `scope` is *where*.
    for (const on of body.getChildren("OnlyStmt")) {
      for (const t of on.getChild("TargetList")?.getChildren("Target") ?? []) {
        const tag = t.getChild("Tag");
        if (tag) view.only.push({ tag: ctx.text(tag).slice(1) });
        else {
          const path = t.getChild("Path");
          const r = path && resolve(ctx.text(path), inScope, t, ctx);
          if (r) view.only.push(r);
        }
      }
    }
    for (const inc of body.getChildren("IncludeStmt")) {
      if (inc.getChild("Star")) view.includeStar = true;
      for (const t of inc.getChild("TargetList")?.getChildren("Target") ?? []) {
        const tag = t.getChild("Tag");
        if (tag) view.include.push({ tag: ctx.text(tag).slice(1) });
        else {
          const path = t.getChild("Path");
          const r = path && resolve(ctx.text(path), inScope, t, ctx);
          if (r) view.include.push(r);
        }
      }
    }
    for (const exc of body.getChildren("ExcludeStmt")) {
      for (const t of exc.getChild("TargetList")?.getChildren("Target") ?? []) {
        const tag = t.getChild("Tag");
        if (tag) view.exclude.push({ tag: ctx.text(tag).slice(1) });
        else {
          const path = t.getChild("Path");
          const r = path && resolve(ctx.text(path), inScope, t, ctx);
          if (r) view.exclude.push(r);
        }
      }
    }
    // `detail` carries what `include` used to smuggle: draw an outside element
    // at its own depth rather than as its top-level context card.
    for (const d of body.getChildren("DetailStmt")) {
      const path = d.getChild("Path");
      if (!path) {
        error(ctx, d, "`detail` needs a path", "detail web.app");
        continue;
      }
      const r = resolve(ctx.text(path), inScope, d, ctx);
      if (r) view.detail.push(r);
    }
    for (const ex of body.getChildren("ExpandStmt")) {
      const path = ex.getChild("Path");
      const r = path && resolve(ctx.text(path), inScope, ex, ctx);
      if (r) view.expand.push(r);
    }
    const ctxStmt = body.getChildren("ContextStmt")[0];
    if (ctxStmt) view.context = ctxStmt.getChild("off") ? "off" : "auto";
    for (const h of body.getChildren("HighlightStmt"))
      view.highlight.push(...h.getChildren("Tag").map((t) => ctx.text(t).slice(1)));
    for (const show of body.getChildren("ShowStmt")) {
      const flowKw = show.getChild("flow");
      if (!flowKw) { view.showDescriptions = true; continue; }
      const idNode = show.getChildren("Ident").pop();
      if (!idNode) continue;
      const flowId = ctx.text(idNode);
      if (!model.flows.some((f) => f.id === flowId)) {
        const s = suggest(flowId, model.flows.map((f) => f.id));
        error(ctx, show, `unknown flow \`${flowId}\``,
          s ? `did you mean \`${s}\`?` : `declare it: flow ${flowId} { a -> b -> c }`);
        continue;
      }
      view.showFlow = flowId;
    }
    const legendStmt = body.getChildren("LegendStmt")[0];
    if (legendStmt) view.legend = !legendStmt.getChild("off");
    const tb = body.getChildren("TitleBlockStmt")[0];
    if (tb) view.titleblock = attrsOf(ctx, tb.getChild("AttrBlock")).attrs;
    for (const n of body.getChildren("NoteStmt")) {
      // half-typed `note` — anchor and text both arrive later
      const anchorNode = n.getChild("NoteAnchor");
      const textNode = n.getChild("String");
      if (!anchorNode || !textNode) continue;
      const noteText = ctx.str(textNode);
      const meta = attrsOf(ctx, n.getChild("AttrBlock"));
      let anchor: SNote["anchor"] | undefined;
      const relpos = anchorNode.getChild("RelPos");
      const corner = anchorNode.getChild("Corner");
      if (relpos) {
        const pathNode = anchorNode.getChild("Path");
        if (!pathNode) continue; // `note right-of` with the target unwritten
        const r = resolve(ctx.text(pathNode), inScope, anchorNode, ctx);
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
      const denIdent = den?.getChild("Ident");
      if (denIdent) {
        const val = ctx.text(denIdent);
        if (val === "compact" || val === "comfortable" || val === "spacious")
          view.layout.density = val;
        else error(ctx, den, `unknown density \`${val}\``, "use compact | comfortable | spacious");
      }
      const lin = lb.getChildren("LinesStmt")[0];
      const linIdent = lin?.getChild("Ident");
      if (linIdent) {
        const val = ctx.text(linIdent);
        if (val === "orthogonal" || val === "curved" || val === "straight")
          view.layout.lines = val;
        else error(ctx, lin, `unknown lines style \`${val}\``, "use orthogonal | curved | straight");
      }
      for (const al of lb.getChildren("AlignStmt")) {
        const nodes = al.getChildren("Path")
          .map((pathNode) => resolve(ctx.text(pathNode), inScope, pathNode, ctx))
          .filter((r): r is string => !!r);
        if (nodes.length >= 2) view.layout.align.push({ nodes, loc: ctx.loc(al) });
        else if (nodes.length === 1)
          warn(ctx, al, "`align` needs at least two elements", "align a b — b takes a's axis");
      }
      const rowsStmt = lb.getChildren("RowsStmt")[0];
      if (rowsStmt) {
        const rows: string[][] = [];
        const placed = new Set<string>();
        for (const rank of rowsStmt.getChildren("Rank")) {
          const row: string[] = [];
          for (const pathNode of rank.getChildren("Path")) {
            const r = resolve(ctx.text(pathNode), inScope, pathNode, ctx, { zones: true });
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
      const colsStmt = lb.getChildren("ColsStmt")[0];
      if (colsStmt) {
        const cols: string[][] = [];
        const placed = new Set<string>();
        for (const rank of colsStmt.getChildren("Rank")) {
          const col: string[] = [];
          for (const pathNode of rank.getChildren("Path")) {
            const r = resolve(ctx.text(pathNode), inScope, pathNode, ctx, { zones: true });
            if (!r) continue;
            if (placed.has(r)) {
              error(ctx, pathNode, `\`${ctx.text(pathNode)}\` appears in \`cols\` twice`,
                "a node can hold only one column position; remove one occurrence");
              continue;
            }
            placed.add(r);
            col.push(r);
          }
          cols.push(col);
        }
        view.layout.cols = cols;
      }
      for (const ch of lb.getChildren("ChannelStmt")) {
        const list = ch.getChild("PathList");
        const targetNode = ch.getChildren("Path").at(-1);
        if (!list || !targetNode) continue; // partial node from error recovery
        const target = resolve(ctx.text(targetNode), inScope, targetNode, ctx);
        const sources = list.getChildren("Path")
          .filter((p) => p !== targetNode)
          .map((p) => resolve(ctx.text(p), inScope, p, ctx))
          .filter((r): r is string => !!r);
        if (!target) continue;
        if (sources.length < 2) {
          warn(ctx, ch, "`channel` needs at least two sources",
            "one source is just an edge — use `route` to steer it");
          continue;
        }
        view.layout.channels.push({ sources, target, loc: ctx.loc(ch) });
      }
      for (const pl of lb.getChildren("PlaceStmt")) {
        const [a, b] = pl.getChildren("Path");
        const node = resolve(ctx.text(a), inScope, a, ctx, { zones: true });
        const relposNode = pl.getChild("RelPos");
        const target = b ? resolve(ctx.text(b), inScope, b, ctx, { zones: true }) : undefined;
        if (node && target && relposNode)
          view.layout.place.push({
            node, target,
            relpos: ctx.text(relposNode) as RelPos,
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
      // A node in a band already has a position, so a `place` on it is a second
      // opinion — but a second opinion is only a *conflict* when it disagrees.
      //
      // This check has been wrong twice, in opposite directions. It first read
      // `(rows && relpos === "right-of") || relpos === "left-of"`, which bound
      // the wrong way and listed only the horizontal directions, so `place x
      // above y` on a banded node sailed through with one hint silently
      // ignored. Widening it to "in a band at all" then went too far the other
      // way: four of twenty cold agents wrote `rows [db bus]` alongside `place
      // bus right-of db` and were refused, though the two say the same thing.
      // Restating a band's own order is how people reinforce intent, not how
      // they contradict it, and no amount of documentation stopped them — the
      // rate held across two rounds of skill fixes, because they were right.
      const bands = view.layout.rows
        ? { kind: "rows" as const, at: view.layout.rows }
        : view.layout.cols
          ? { kind: "cols" as const, at: view.layout.cols }
          : undefined;
      const where = (n: string) => {
        const b = bands?.at.findIndex((band) => band.includes(n)) ?? -1;
        return b < 0 ? undefined : { band: b, pos: bands!.at[b].indexOf(n) };
      };
      const node = where(pl.node);
      if (bands && node) {
        // In `rows`, bands run top to bottom and members left to right; in
        // `cols` it is the transpose. So one axis is the band index and the
        // other the position within it, and which is which flips with `kind`.
        const target = where(pl.target);
        const along = bands.kind === "rows" ? ["right-of", "left-of"] : ["below", "above"];
        const agrees =
          target &&
          (along.includes(pl.relpos)
            ? // same band, and immediately beside — `place` means adjacent
              node.band === target.band &&
              node.pos === target.pos + (pl.relpos === "right-of" || pl.relpos === "below" ? 1 : -1)
            : // the perpendicular axis: the neighbouring band, on the right side
              node.pos === target.pos &&
              node.band ===
                target.band + (pl.relpos === "below" || pl.relpos === "right-of" ? 1 : -1));
        if (!agrees)
          diagnostics.push({
            severity: "error",
            message: !target
              ? `\`${pl.node}\` is listed in \`${bands.kind}\` but is placed relative to \`${pl.target}\`, which is not`
              : `\`${pl.node}\` is placed \`${pl.relpos} ${pl.target}\`, but \`${bands.kind}\` puts it somewhere else`,
            fix: !target
              ? `add \`${pl.target}\` to ${bands.kind} too, or drop \`${pl.node}\` from ${bands.kind}`
              : `${bands.kind} already positions both; make them agree, or drop \`${pl.node}\` from ${bands.kind}`,
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
      only: [], include: [], includeStar: false, exclude: [], expand: [], detail: [],
      context: "auto", highlight: [], showDescriptions: false, legend: false, notes: [],
      layout: { place: [], routes: [], align: [], channels: [] },
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
