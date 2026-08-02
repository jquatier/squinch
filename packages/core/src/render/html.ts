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
  /** `all` (default) includes the auto view every container gets, so every card
   *  that zooms in the playground zooms here too. `declared` trims it to the
   *  views an author wrote, which is smaller but leaves any container without
   *  one as a dead card — it was the default until a `Storefront` card in
   *  `examples/microservices` did nothing when clicked, because it is the one
   *  system there with no declared view of its own. `--sync` makes the opposite
   *  call for a good reason that does not apply here: an auto view costs it a
   *  *file* nobody asked for, where it costs this a few KB. */
  views?: "declared" | "all";
  /** Document title. Default: the entry view's title, or the project name. */
  title?: string;
  /** Pre-render one frame per hop of a `show flow`, so presentation mode can
   *  walk the story. Default true; only views that declare a flow cost
   *  anything, and a frame is the same 3–9 KB as any other body. */
  flowSteps?: boolean;
}

export interface HTMLExportResult {
  html?: string;
  diagnostics: Diagnostic[];
  ok: boolean;
  /** What went in — the CLI prints it, the tests assert on it. */
  manifest: {
    views: string[]; themes: string[]; renders: number; bytes: number;
    /** view name → hops that render at that altitude, for the ones with a flow */
    flows: Record<string, number>;
  };
}

const EMPTY = { views: [], themes: [], renders: 0, bytes: 0, flows: {} };

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
  const list = (opts.views === "declared" ? all.filter((v) => !v.auto) : all).map(
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
  const flows: Record<string, number> = {};
  const diagnostics = [...built.diagnostics];
  const draw = async (view: string, th: string, flowStep?: number) => {
    const r = await renderProject(files, {
      view, theme: th, embedFonts: false, collectDefs: defs,
      // the one theme-dependent def (`sq-hatch`) needs a distinct id per
      // palette, or a dark view would draw with the light texture
      defsScope: `-${th}`,
      ...(flowStep === undefined ? {} : { flowStep }),
    });
    diagnostics.push(...r.diagnostics.filter((d) => d.severity === "error"));
    return r;
  };
  for (const th of palette)
    for (const v of list) {
      // the whole flow at once is the authoring frame, and the one the file
      // opens on; the walked frames are extra
      const r = await draw(v.name, th);
      if (!r.ok || !r.svg) return { diagnostics, ok: false, manifest: EMPTY };
      bodies.set(`${v.name}|${th}`, r.svg.trim());
      // `flow.steps` counts hops that render *at this altitude*, which is
      // exactly the number of frames a presenter can reach
      if (!r.flow || opts.flowSteps === false) continue;
      flows[v.name] = r.flow.steps;
      for (let step = 1; step <= r.flow.steps; step++) {
        const f = await draw(v.name, th, step);
        if (!f.ok || !f.svg) return { diagnostics, ok: false, manifest: EMPTY };
        bodies.set(`${v.name}|${th}|${step}`, f.svg.trim());
      }
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
    flows,
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
      flows,
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
  flows: Record<string, number>;
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
    '<span id="sq-step"></span>' +
    (a.palette.length > 1 ? '<button id="sq-theme" type="button" title="Change palette (t)">◐</button>' : "") +
    (a.views.length > 1 ? '<button id="sq-present" type="button" title="Present (p)">Present</button>' : "") +
    "</header>");
  L.push('<main id="sq-stage"><div id="sq-ghost" aria-hidden="true"></div><div id="sq-live">');
  L.push(a.entryBody);
  L.push("</div></main>");
  if (a.views.length > 1) L.push('<footer id="sq-foot"><nav id="sq-dots"></nav></footer>');
  for (const [key, svg] of a.bodies) {
    if (key === `${a.entry}|${a.palette[0].name}`) continue; // already inline
    L.push(`<template data-key="${attr(key)}">${svg}</template>`);
  }
  L.push(
    `<script type="application/json" id="sq-data">` +
      jsonIsland({
        views: a.views, entry: a.entry, themes: a.palette.map((t) => t.name), flows: a.flows,
      }) +
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
  // a card that leads somewhere says so — and only one that does. The class is
  // applied by the runtime, which is the only thing that knows whether a path
  // resolves to a view; styling every card invited a click that did nothing.
  "#sq-live .sq-zoom{cursor:zoom-in}" +
  "#sq-step{color:var(--sq-muted);font-variant-numeric:tabular-nums;flex:none}" +
  "#sq-present{font:inherit;background:var(--sq-surface);color:var(--sq-muted);cursor:pointer;" +
  "border:1px solid var(--sq-border);border-radius:6px;padding:2px 10px;flex:none}" +
  "#sq-foot{display:flex;justify-content:center;padding:10px;flex:none}" +
  "#sq-dots{display:flex;gap:8px}" +
  "#sq-dots button{width:8px;height:8px;padding:0;border-radius:50%;cursor:pointer;" +
  "border:1px solid var(--sq-border);background:none}" +
  "#sq-dots button.on{background:var(--sq-ink);border-color:var(--sq-ink)}" +
  // presenting: full bleed, chrome floats over the canvas and fades when idle
  "body.presenting #sq-bar,body.presenting #sq-foot{position:fixed;left:0;right:0;z-index:2;" +
  "transition:opacity .3s;background:transparent}" +
  "body.presenting #sq-bar{top:0}body.presenting #sq-foot{bottom:0}" +
  "body.presenting #sq-stage{padding:0}" +
  "body.presenting.idle #sq-bar,body.presenting.idle #sq-foot{opacity:0;pointer-events:none}" +
  "body.presenting.idle{cursor:none}" +
  "@media (prefers-reduced-motion:reduce){#sq-live,#sq-ghost{transition:none!important}}";
