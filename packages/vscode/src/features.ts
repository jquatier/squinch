// Editor intelligence, as pure functions over source text. The LSP server
// (src/server.ts) is a thin protocol shell around these — everything that can
// be wrong lives here, where vitest can reach it without a running editor.
import {
  buildProject, renderProject, allPackNames, iconIds, iconMeta, iconTitle, packExists,
  type Diagnostic as CoreDiagnostic,
} from "@squinch/core";

export interface Pos { line: number; character: number }
export interface Range { start: Pos; end: Pos }

export interface FeatureDiagnostic {
  range: Range;
  message: string;
  severity: "error" | "warning";
  /** the diagnostic's prose fix, verbatim from the compiler */
  fix?: string;
  /** the replacement a quick-fix would apply, when the fix names one */
  replacement?: string;
}

export interface Completion {
  label: string;
  kind: "icon" | "path" | "keyword" | "value";
  detail?: string;
  /** text to insert, when it differs from the label */
  insert?: string;
}

export interface Sym {
  name: string;
  detail?: string;
  kind: "system" | "container" | "node" | "view" | "zone" | "flow";
  range: Range;
  children?: Sym[];
}

// ── offsets ⇄ positions ───────────────────────────────────────────────────
export function posAt(src: string, offset: number): Pos {
  const clamped = Math.max(0, Math.min(offset, src.length));
  const before = src.slice(0, clamped);
  const line = before.split("\n").length - 1;
  return { line, character: clamped - (before.lastIndexOf("\n") + 1) };
}
export function offsetAt(src: string, pos: Pos): number {
  const lines = src.split("\n");
  let off = 0;
  for (let i = 0; i < pos.line && i < lines.length; i++) off += lines[i].length + 1;
  return off + pos.character;
}
const rangeOf = (src: string, from: number, to: number): Range => ({
  start: posAt(src, from),
  end: posAt(src, Math.max(to, from + 1)),
});

/** The suggestion inside a `did you mean \`x\`?` fix, if there is one. */
export function replacementIn(fix: string | undefined): string | undefined {
  if (!fix) return undefined;
  const m = /did you mean `([^`]+)`/.exec(fix);
  return m?.[1];
}

function convert(src: string, d: CoreDiagnostic): FeatureDiagnostic {
  return {
    range: rangeOf(src, d.loc.from, d.loc.to),
    message: d.message,
    severity: d.severity,
    fix: d.fix,
    replacement: replacementIn(d.fix),
  };
}

/** Parse/model diagnostics — synchronous, cheap enough for every keystroke. */
export function diagnosticsFor(src: string): FeatureDiagnostic[] {
  return buildProject([{ name: "doc.squinch", src }]).diagnostics.map((d) => convert(src, d));
}

/**
 * Everything `squinch check` would report, including hint conflicts that only
 * surface once a view is laid out. Deduped by position+message, since one
 * model problem can resurface in several views.
 */
export async function allDiagnosticsFor(src: string): Promise<FeatureDiagnostic[]> {
  const built = buildProject([{ name: "doc.squinch", src }]);
  const out = built.diagnostics.map((d) => convert(src, d));
  if (built.ok) {
    const views = built.model.views.filter((v) => !v.auto);
    for (const v of views.length ? views : built.model.views.slice(0, 1)) {
      const r = await renderProject([{ name: "doc.squinch", src }], { view: v.name });
      for (const d of r.diagnostics) out.push(convert(src, d));
    }
  }
  const seen = new Set<string>();
  return out.filter((d) => {
    const key = `${d.range.start.line}:${d.range.start.character}:${d.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── block context ─────────────────────────────────────────────────────────
const BLOCK_KEYWORDS = ["view", "layout", "system", "container", "zone", "flow"] as const;
export type BlockKind = (typeof BLOCK_KEYWORDS)[number] | "file" | "attrs";

/** Which `{ }` block the offset sits in — innermost last. Brace scanning, not
 *  parsing: completion has to work on text that does not parse yet. */
export function blockStack(src: string, offset: number): BlockKind[] {
  const stack: BlockKind[] = ["file"];
  let inString = false, inComment = false;
  for (let i = 0; i < offset && i < src.length; i++) {
    const ch = src[i];
    if (inComment) { if (ch === "\n") inComment = false; continue; }
    if (inString) { if (ch === '"' || ch === "\n") inString = false; continue; }
    if (ch === '"') { inString = true; continue; }
    if (ch === "/" && src[i + 1] === "/") { inComment = true; i++; continue; }
    if (ch === "{") {
      // the keyword that opened this block is the last word before it
      const head = src.slice(Math.max(0, i - 200), i);
      const words = head.match(/[a-zA-Z][\w-]*/g) ?? [];
      const kw = [...words].reverse().find((w) => (BLOCK_KEYWORDS as readonly string[]).includes(w));
      const sameLine = head.slice(head.lastIndexOf("\n") + 1);
      const kwOnLine = (sameLine.match(/[a-zA-Z][\w-]*/g) ?? [])
        .some((w) => (BLOCK_KEYWORDS as readonly string[]).includes(w));
      stack.push(kwOnLine && kw ? (kw as BlockKind) : "attrs");
      continue;
    }
    if (ch === "}") { if (stack.length > 1) stack.pop(); continue; }
  }
  return stack;
}

const TOP_KEYWORDS = ["pack", "person", "system", "container", "zone", "flow", "view", "theme"];
const VIEW_KEYWORDS = [
  "title", "theme", "scope", "include", "exclude", "expand", "context",
  "highlight", "show", "legend", "titleblock", "note", "layout",
];
const LAYOUT_KEYWORDS = ["direction", "density", "lines", "rows", "cols", "place", "align", "route"];
const ZONE_KEYWORDS = ["contains", "icon", "label", "color"];

/** Completions for the cursor position. Order is deterministic. */
export function completionsAt(src: string, offset: number): Completion[] {
  const line = src.slice(src.lastIndexOf("\n", Math.max(0, offset - 1)) + 1, offset);
  const stack = blockStack(src, offset);
  const here = stack[stack.length - 1];

  // 1. icon reference: `aws/lam|`
  const iconRef = /(^|[\s=,])([a-zA-Z][\w-]*)\/([\w-]*)$/.exec(line);
  if (iconRef) {
    const [, , pack, partial] = iconRef;
    if (packExists(pack))
      return iconIds(pack)
        .filter((id) => id.startsWith(partial))
        .sort()
        .map((id) => ({
          label: `${pack}/${id}`,
          kind: "icon" as const,
          detail: iconTitle(pack, id),
          insert: id.slice(partial.length),
        }));
    return [];
  }

  // 2. pack prefix at an icon position: `db = a|`
  if (/=\s*[\w-]*$/.test(line)) {
    const partial = (/=\s*([\w-]*)$/.exec(line)?.[1] ?? "");
    return [
      ...allPackNames().filter((p) => p.startsWith(partial)).map((p) => ({
        label: `${p}/`, kind: "value" as const, detail: "icon pack",
        insert: `${p.slice(partial.length)}/`,
      })),
      ...(("box".startsWith(partial)) ? [{ label: "box", kind: "value" as const, detail: "no icon", insert: "box".slice(partial.length) }] : []),
    ];
  }

  // 3. edge target: `api -> |`
  if (/(->|~>|<->|--|,)\s*[\w.]*$/.test(line)) {
    const partial = /([\w.]*)$/.exec(line)?.[1] ?? "";
    return pathCompletions(src, partial);
  }

  // 4. keywords by block
  const partial = /([a-zA-Z][\w-]*)?$/.exec(line)?.[1] ?? "";
  const pool =
    here === "layout" ? LAYOUT_KEYWORDS :
    here === "view" ? VIEW_KEYWORDS :
    here === "zone" ? ZONE_KEYWORDS :
    here === "system" || here === "container" ? [] :
    here === "file" ? TOP_KEYWORDS : [];
  return pool
    .filter((k) => k.startsWith(partial))
    .map((k) => ({ label: k, kind: "keyword" as const, insert: k.slice(partial.length) }));
}

function pathCompletions(src: string, partial: string): Completion[] {
  const { model } = buildProject([{ name: "doc.squinch", src }]);
  const all = [
    ...[...model.containers.keys()].map((p) => ({ p, detail: "container" })),
    ...[...model.nodes.keys()].map((p) => ({ p, detail: model.nodes.get(p)?.label ?? "node" })),
  ];
  const out: Completion[] = [];
  for (const { p, detail } of all) {
    const short = p.split(".").pop()!;
    if (p.startsWith(partial)) out.push({ label: p, kind: "path", detail, insert: p.slice(partial.length) });
    else if (short.startsWith(partial) && !p.includes(".") === false)
      out.push({ label: short, kind: "path", detail: `${detail} — ${p}`, insert: short.slice(partial.length) });
  }
  return out;
}

/** Hover markdown for the token under the cursor. */
export function hoverAt(src: string, offset: number): { markdown: string; range: Range } | undefined {
  const isWord = (c: string) => /[\w.\-/]/.test(c);
  let from = offset, to = offset;
  while (from > 0 && isWord(src[from - 1])) from--;
  while (to < src.length && isWord(src[to])) to++;
  const token = src.slice(from, to);
  if (!token) return undefined;
  const range = rangeOf(src, from, to);

  if (token.includes("/")) {
    const [pack, id] = token.split("/");
    if (iconMeta(pack, id))
      return { markdown: `**${iconTitle(pack, id) ?? id}**\n\npack \`${pack}\``, range };
  }
  const { model } = buildProject([{ name: "doc.squinch", src }]);
  const hit =
    model.nodes.get(token) ?? model.containers.get(token) ??
    [...model.nodes.values()].find((n) => n.name === token) ??
    [...model.containers.values()].find((c) => c.name === token);
  if (!hit) return undefined;
  const label = "label" in hit ? hit.label : undefined;
  const desc = "description" in hit ? hit.description : hit.attrs?.["description"];
  const tags = hit.tags?.length ? `\n\ntags: ${hit.tags.map((t) => `#${t}`).join(" ")}` : "";
  return {
    markdown: `**${label ?? hit.name}**\n\n\`${hit.path}\`${desc ? `\n\n${desc}` : ""}${tags}`,
    range,
  };
}

/** Outline: systems and their children, then views, zones, flows. */
export function symbolsOf(src: string): Sym[] {
  const { model } = buildProject([{ name: "doc.squinch", src }]);
  const symOf = (path: string): Sym | undefined => {
    const c = model.containers.get(path);
    if (c)
      return {
        name: c.name,
        detail: c.label,
        kind: c.kind,
        range: rangeOf(src, c.loc.from, c.loc.to),
        children: c.children.map(symOf).filter((s): s is Sym => !!s),
      };
    const n = model.nodes.get(path);
    if (n)
      return {
        name: n.name, detail: n.label, kind: "node",
        range: rangeOf(src, n.loc.from, n.loc.to),
      };
    return undefined;
  };
  const roots = [...model.containers.values()].filter((c) => !c.path.includes("."));
  const looseNodes = [...model.nodes.values()].filter((n) => !n.path.includes("."));
  return [
    ...roots.map((c) => symOf(c.path)).filter((s): s is Sym => !!s),
    ...looseNodes.map((n) => symOf(n.path)).filter((s): s is Sym => !!s),
    ...model.zones.map((z) => ({
      name: z.id, detail: z.label ?? z.kind, kind: "zone" as const,
      range: rangeOf(src, z.loc.from, z.loc.to),
    })),
    ...model.flows.map((f) => ({
      name: f.id, detail: f.label ?? `${f.steps.length} steps`, kind: "flow" as const,
      range: rangeOf(src, f.loc.from, f.loc.to),
    })),
    ...model.views.filter((v) => !v.auto).map((v) => ({
      name: v.name, detail: v.title, kind: "view" as const,
      range: rangeOf(src, v.loc.from, v.loc.to),
    })),
  ];
}
