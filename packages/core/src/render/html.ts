// One self-contained HTML file carrying every view of a project, and a viewer
// that dives between them.
//
// Squinch's whole idea is that views are altitudes over one model and that
// moving between them is navigation (DESIGN §11). Until this, that experience
// existed only in the playground: everything you could hand someone else — an
// SVG, a PNG, an adaptive pair — was one frozen altitude. This is the artifact
// that travels.
//
// THE EXCEPTION, STATED. CLAUDE.md's rule is that an exported *SVG* never
// contains JS. That still holds without qualification, including for the SVGs
// in here: each one is what `render -o x.svg` produces (minus the defs this
// document shares), and the script is their sibling, never their content. The
// entry view is inline rather than in a <template>, so a reader whose browser
// or wiki sanitizer drops the script still gets a correct static diagram.
//
// WHY IT IS SMALL. Every view repeats the same two things: ~33 KB of base64
// font and 17–27 KB of icon <symbol>s. Fragment references resolve
// document-wide in HTML, so one definition serves all of them — `collectDefs`
// hands them out instead of emitting them, and they land once in a hidden
// sprite. Measured on `examples/microservices`: six views go from 362 KB
// concatenated to ~105 KB. The actual drawing is 3–9 KB per view, which is the
// right shape for the file to have.
import { buildProject, type ProjectFile } from "../model/build.js";
import { themes, type Theme } from "../themes/index.js";
import { fontFaceCSS } from "./svg.js";
import { RUNTIME_JS } from "./html/runtime.generated.js";
import type { Diagnostic } from "../model/types.js";
import type { NavView } from "../view/navigate.js";

export interface HTMLExportOpts {
  /** Which view opens. Default: the first declared one. */
  view?: string;
  /** Palettes to bundle; the first is the entry. Default: the project's theme
   *  and its `pairsWith` counterpart, so the file follows the reader's OS. */
  themes?: string[];
  /** `all` includes the auto view every container gets, so every card is a zoom
   *  target. `declared` (default) is the ones an author chose to be navigable —
   *  same call `--sync` makes, for the same reason. */
  views?: "declared" | "all";
  /** Document title. Default: the entry view's title, or the project name. */
  title?: string;
}

export interface HTMLExportResult {
  html?: string;
  diagnostics: Diagnostic[];
  ok: boolean;
  /** What went in — the CLI prints it, the tests assert on it. */
  manifest: { views: string[]; themes: string[]; renders: number; bytes: number };
}

const EMPTY = { views: [], themes: [], renders: 0, bytes: 0 };

/** `</script>` inside a JSON island would end the island. Escaping the `<`
 *  keeps the payload inert wherever it lands. */
const jsonIsland = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");
const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const text = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

export async function exportHTML(
  files: ProjectFile[],
  opts: HTMLExportOpts = {},
): Promise<HTMLExportResult> {
  // imported lazily: html.ts is part of the render layer and api.ts imports it,
  // so taking renderProject the other way round would be a cycle
  const { renderProject } = await import("../api.js");

  const built = buildProject(files);
  if (!built.ok) return { diagnostics: built.diagnostics, ok: false, manifest: EMPTY };

  const all = built.model.views;
  const list = (opts.views === "all" ? all : all.filter((v) => !v.auto)).map(
    (v): NavView => ({ name: v.name, scope: v.scope, title: v.title, auto: v.auto }),
  );
  if (!list.length)
    return {
      diagnostics: [...built.diagnostics, {
        severity: "error",
        message: "nothing to export — this project declares no views",
        fix: "add a `view` block, or pass views: \"all\" to include the automatic ones",
        loc: { from: 0, to: 0, line: 1, col: 1 },
      }],
      ok: false,
      manifest: EMPTY,
    };

  const entry = opts.view ?? list[0].name;
  if (!list.some((v) => v.name === entry))
    return {
      diagnostics: [...built.diagnostics, {
        severity: "error",
        message: `unknown view \`${entry}\``,
        fix: `views in this export: ${list.map((v) => v.name).join(", ")}`,
        loc: { from: 0, to: 0, line: 1, col: 1 },
      }],
      ok: false,
      manifest: EMPTY,
    };

  // A document has one palette at a time and a button to change it, so the
  // theme is the document's rather than each view's — a per-view `theme` is
  // deliberately overridden here, the way `--theme` overrides it elsewhere.
  const base = opts.themes?.[0] ?? built.model.fileTheme ?? "light";
  const palette = opts.themes ?? [base, themes[base]?.pairsWith].filter(Boolean) as string[];
  for (const name of palette)
    if (!themes[name])
      return {
        diagnostics: [...built.diagnostics, {
          severity: "error",
          message: `unknown theme \`${name}\``,
          fix: `available: ${Object.keys(themes).join(", ")}`,
          loc: { from: 0, to: 0, line: 1, col: 1 },
        }],
        ok: false,
        manifest: EMPTY,
      };

  const defs = new Map<string, string>();
  const bodies = new Map<string, string>();
  const diagnostics = [...built.diagnostics];
  for (const th of palette)
    for (const v of list) {
      const r = await renderProject(files, {
        view: v.name,
        theme: th,
        embedFonts: false,
        collectDefs: defs,
        // the one theme-dependent def (`sq-hatch`) needs a distinct id per
        // palette, or a dark view would draw with the light texture
        defsScope: `-${th}`,
      });
      diagnostics.push(...r.diagnostics.filter((d) => d.severity === "error"));
      if (!r.ok || !r.svg) return { diagnostics, ok: false, manifest: EMPTY };
      bodies.set(`${v.name}|${th}`, r.svg.trim());
    }

  const fonts = [...new Set(palette.map((n) => fontFaceCSS(themes[n])))].join("");
  const sprite = [...defs.keys()].sort().map((k) => defs.get(k)!).join("");
  const title = opts.title ?? list.find((v) => v.name === entry)?.title ?? files[0]?.name.replace(/\.squinch$/, "") ?? "diagram";

  const html = document({
    title,
    fonts,
    sprite,
    palette: palette.map((n) => themes[n]),
    entry,
    entryBody: bodies.get(`${entry}|${palette[0]}`)!,
    bodies,
    views: list,
  });

  return {
    html,
    diagnostics,
    ok: true,
    manifest: {
      views: list.map((v) => v.name),
      themes: palette,
      renders: bodies.size,
      bytes: html.length,
    },
  };
}

function document(a: {
  title: string;
  fonts: string;
  sprite: string;
  palette: Theme[];
  entry: string;
  entryBody: string;
  bodies: Map<string, string>;
  views: NavView[];
}): string {
  // chrome colours come from the same theme tokens the diagram draws with, so
  // the frame around a dark diagram is dark (DESIGN §10)
  const vars = (t: Theme, sel: string) =>
    `${sel}{--sq-canvas:${t.canvas};--sq-ink:${t.ink};--sq-muted:${t.muted};--sq-border:${t.border};--sq-surface:${t.surface}}`;
  const themeVars = a.palette
    .map((t, i) => vars(t, i === 0 ? ":root,:root[data-theme=\"" + t.name + "\"]" : `:root[data-theme="${t.name}"]`))
    .join("");

  const L: string[] = [];
  L.push("<!doctype html>");
  L.push(`<html lang="en" data-theme="${attr(a.palette[0].name)}">`);
  L.push("<head>");
  L.push('<meta charset="utf-8">');
  L.push('<meta name="viewport" content="width=device-width,initial-scale=1">');
  L.push(`<title>${text(a.title)}</title>`);
  L.push(`<style>${a.fonts}${themeVars}${CHROME_CSS}</style>`);
  L.push("</head>");
  L.push("<body>");
  // never display:none — some engines stop resolving <use> into a hidden tree
  L.push(
    `<svg id="sq-defs" aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden">` +
      `<defs>${a.sprite}</defs></svg>`,
  );
  L.push('<header id="sq-bar"><nav id="sq-crumbs"></nav>' +
    (a.palette.length > 1 ? '<button id="sq-theme" type="button" title="Change palette (t)">◐</button>' : "") +
    "</header>");
  L.push('<main id="sq-stage"><div id="sq-ghost" aria-hidden="true"></div><div id="sq-live">');
  L.push(a.entryBody);
  L.push("</div></main>");
  for (const [key, svg] of a.bodies) {
    if (key === `${a.entry}|${a.palette[0].name}`) continue; // already inline
    L.push(`<template data-key="${attr(key)}">${svg}</template>`);
  }
  L.push(
    `<script type="application/json" id="sq-data">` +
      jsonIsland({ views: a.views, entry: a.entry, themes: a.palette.map((t) => t.name) }) +
      `</script>`,
  );
  L.push(`<script>${RUNTIME_JS}</script>`);
  L.push("</body>");
  L.push("</html>");
  return L.join("\n") + "\n";
}

const CHROME_CSS =
  "*{box-sizing:border-box}" +
  "body{margin:0;background:var(--sq-canvas);color:var(--sq-ink);" +
  "font:13px/1.5 system-ui,-apple-system,sans-serif;height:100vh;display:flex;flex-direction:column}" +
  "#sq-bar{display:flex;align-items:center;gap:12px;padding:10px 16px;flex:none}" +
  "#sq-crumbs{display:flex;align-items:center;gap:6px;flex:1;min-width:0;flex-wrap:wrap}" +
  "#sq-crumbs button{font:inherit;background:none;border:0;padding:2px 4px;border-radius:4px;" +
  "color:var(--sq-muted);cursor:pointer}" +
  "#sq-crumbs button:hover{color:var(--sq-ink);background:var(--sq-surface)}" +
  "#sq-crumbs .sep{color:var(--sq-muted);opacity:.6}" +
  "#sq-theme{font:inherit;background:var(--sq-surface);color:var(--sq-muted);cursor:pointer;" +
  "border:1px solid var(--sq-border);border-radius:6px;padding:2px 8px;flex:none}" +
  "#sq-stage{position:relative;flex:1;min-height:0;overflow:auto;display:grid;place-items:center}" +
  "#sq-live svg,#sq-ghost svg{max-width:100%;height:auto;display:block}" +
  // a card that leads somewhere says so; everything else keeps the default
  "#sq-live [data-kind=card],#sq-live [data-kind=frame]{cursor:zoom-in}" +
  "@media (prefers-reduced-motion:reduce){#sq-live,#sq-ghost{transition:none!important}}";
