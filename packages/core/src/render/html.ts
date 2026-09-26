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
// document shares, and minus the version stamp, which the document carries
// once on `<html>`), and the script is their sibling, never their content. The
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
import { fontFaceCSS, allFaces } from "./svg.js";
import { RUNTIME_JS } from "./html/runtime.generated.js";
import type { Diagnostic } from "../model/types.js";
import { navViews, type NavView } from "../view/navigate.js";

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
  /** Stamp the document with `data-squinch="<toolVersion>"` — once, on
   *  `<html>`, never on the inline bodies. Fourteen copies of one fact is what
   *  the shared-defs design exists to avoid, and a body lifted out of this
   *  file is not a `render -o` artifact anyway. See `RenderOpts.toolVersion`. */
  toolVersion?: string;
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
  // A flat project — top-level components, no `view`, no container to earn an
  // auto view — has no views at all, and the SVG path renders it anyway
  // through the implicit "everything" view (api.ts). This export does the
  // same, under the `default` label the CLI already uses for that file. Round
  // 22: nine of twenty-nine cold agents wrote exactly such a model, checked it
  // clean, and had the export refuse it — with a fix that named an option
  // (`views: "all"`) that could not help, since there was nothing to include.
  const implicit = all.length === 0 && opts.views !== "declared";
  const list: NavView[] = implicit
    ? [{ name: "default", auto: true }]
    : navViews(built.model).filter((v) => opts.views !== "declared" || !v.auto);
  if (!list.length)
    return {
      diagnostics: [...built.diagnostics, {
        severity: "error",
        message: "nothing to export — this project declares no views",
        fix: "add a `view` block, or drop `--views declared` to export the automatic ones",
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
  const base = opts.themes?.[0] ?? built.model.fileTheme ?? "dark";
  // the counterpart pairs in either direction: light names dark, and dark is
  // found by being named — so a dark entry still bundles light for the toggle
  const mate = themes[base]?.pairsWith ?? Object.values(themes).find((t) => t.pairsWith === base)?.name;
  const palette = opts.themes ?? ([base, mate].filter(Boolean) as string[]);
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
      // the implicit view has no name to ask for; renderProject builds it
      ...(implicit ? {} : { view }), theme: th, embedFonts: false, collectDefs: defs,
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

  // Every face, not the union of what these views happened to draw: the
  // viewer swaps views (and palettes) client-side from bodies it already
  // holds, so a set trimmed to the entry view would leave a later one's title
  // block falling back to a face with different metrics.
  const fonts = [...new Set(palette.map((n) => fontFaceCSS(themes[n], allFaces())))].join("");
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
    toolVersion: opts.toolVersion,
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
  toolVersion?: string;
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
  // The runtime only ever writes `dataset.theme` here, so the stamp survives
  // every palette switch.
  const stamp = a.toolVersion ? ` data-squinch="${attr(a.toolVersion)}"` : "";
  L.push(`<html lang="en" data-theme="${attr(a.palette[0].name)}"${stamp}>`);
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
  // The view bar leads the header: home, the path to where you stand with a
  // menu of the views beside each hop, and the flows (docs/notes/view-bar.md).
  // It is an empty <nav> the runtime fills, so a reader without script is not
  // handed a row of dead controls, and it holds no <svg>: its glyphs are text.
  // The zoom controls are text glyphs, not icons — every <svg> in this file is
  // a diagram body or the sprite, and the tests count them — and they are
  // hidden until the runtime says the camera exists: a reader without script
  // gets a static diagram, not three dead buttons.
  L.push('<header id="sq-bar">' +
    (a.views.length > 1 ? '<nav id="sq-nav" aria-label="Views"></nav>' : "") +
    '<span id="sq-step"></span>' +
    '<span id="sq-zoom">' +
    '<button id="sq-zout" type="button" aria-label="Zoom out" title="Zoom out (- or Ctrl/\u2318 -)">\u2212</button>' +
    '<button id="sq-fit" type="button" aria-label="Fit to window" title="Fit to window (0)">Fit</button>' +
    '<button id="sq-zin" type="button" aria-label="Zoom in" title="Zoom in (+ or Ctrl/\u2318 +, or Ctrl/\u2318+scroll)">+</button>' +
    '</span>' +
    (a.palette.length > 1 ? '<button id="sq-theme" type="button" title="Change palette (t)">◐</button>' : "") +
    (a.views.length > 1 ? '<button id="sq-present" type="button" title="Present (p)">Present</button>' : "") +
    "</header>");
  // #sq-cam is the camera: the one element pan and zoom transform, wrapping
  // BOTH dive layers so the dive can go on owning #sq-live's inline style. It
  // is `display:contents` until the runtime boots, which makes it not exist for
  // a reader without script. #sq-live stays attribute-free and wraps the entry
  // SVG directly — the no-script test reads it with a regex.
  L.push('<main id="sq-stage"><div id="sq-cam"><div id="sq-ghost" aria-hidden="true"></div><div id="sq-live">');
  L.push(a.entryBody);
  L.push("</div></div></main>");
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
  // 100dvh over 100vh: on iOS `vh` is the height with the browser's toolbars
  // hidden, so while they show the page ran underneath the bottom bar and took
  // the view tabs with it. The first declaration is for engines without dvh.
  "font:13px/1.5 system-ui,-apple-system,sans-serif;height:100vh;height:100dvh;display:flex;flex-direction:column}" +
  "#sq-bar{display:flex;align-items:center;justify-content:flex-end;gap:12px;padding:10px 16px;flex:none}" +
  "#sq-theme{font:inherit;background:var(--sq-surface);color:var(--sq-muted);cursor:pointer;" +
  "border:1px solid var(--sq-border);border-radius:6px;padding:2px 8px;flex:none}" +
  "#sq-stage{position:relative;flex:1;min-height:0;overflow:auto;display:grid;place-items:center}" +
  // out of flow ALWAYS, not just while a dive's inline styles are on it. As a
  // grid child the empty ghost owned a row, and default align-content:normal
  // stretches auto rows — so the moment cleanup returned it to flow, the live
  // layer's row moved down and the whole diagram jumped a beat after the
  // zoom landed. The dive sets left/top/size inline per flight; this base
  // rule is what holds between flights.
  "#sq-ghost{position:absolute;left:0;top:0;pointer-events:none}" +
  "#sq-live svg,#sq-ghost svg{max-width:100%;height:auto;display:block}" +
  // Without script the camera wrapper is not there and the layout above is the
  // whole story. The runtime puts `sq-pz` on <html> once the camera is attached,
  // and only then does the stage stop scrolling and start being grabbed: the
  // SVG takes its natural size inside #sq-cam, whose transform is the camera
  // (docs/notes/pan-zoom.md). Neither layer may have padding or a border — the
  // dive's transform origins are px in each layer's own border box.
  "#sq-cam{display:contents}#sq-zoom{display:none}" +
  ".sq-pz #sq-stage{display:block;overflow:hidden;cursor:grab;user-select:none;-webkit-user-select:none}" +
  ".sq-pz #sq-cam{display:block;position:absolute;left:0;top:0;transform-origin:0 0}" +
  ".sq-pz #sq-live svg{max-width:none}" +
  ".sq-pz #sq-ghost svg{width:100%;height:100%;max-width:none}" +
  ".sq-pz #sq-stage[data-cam=drag],.sq-pz #sq-stage[data-cam=drag] *{cursor:grabbing!important}" +
  ".sq-pz #sq-zoom{display:flex;gap:2px;flex:none}" +
  "#sq-zoom button{font:inherit;background:var(--sq-surface);color:var(--sq-muted);cursor:pointer;" +
  "border:1px solid var(--sq-border);border-radius:6px;padding:2px 8px}" +
  "#sq-zoom button:hover{color:var(--sq-ink)}" +
  "#sq-fit{min-width:6ch;font-variant-numeric:tabular-nums}" +
  // a card that leads somewhere says so — and only one that does. The class is
  // applied by the runtime, which is the only thing that knows whether a path
  // resolves to a view; styling every card invited a click that did nothing.
  "#sq-live .sq-zoom{cursor:zoom-in}" +
  "#sq-step{color:var(--sq-muted);font-variant-numeric:tabular-nums;flex:none}" +
  "#sq-present{font:inherit;background:var(--sq-surface);color:var(--sq-muted);cursor:pointer;" +
  "border:1px solid var(--sq-border);border-radius:6px;padding:2px 10px;flex:none}" +
  // The view bar (runtime.ts paints it). One quiet pill for the path, one
  // for the flows; a hop with siblings opens a menu beneath it. Long labels
  // truncate rather than wrap — a two-row bar reads as two bars.
  "#sq-nav{display:flex;align-items:center;gap:8px;margin-right:auto;min-width:0}" +
  "#sq-nav>*,.sq-path>*,.sq-hop>*{flex:none}" +
  // the fold levels, applied by the runtime until the bar fits (runtime.ts)
  "#sq-nav .sq-seg>.sq-l{max-width:220px}" +
  "#sq-nav.sq-f1 .sq-seg:not(.current)>.sq-l{max-width:8rem}#sq-nav.sq-f1 .sq-seg.current>.sq-l{max-width:11rem}" +
  "#sq-nav.sq-f2 .sq-outer,#sq-nav.sq-f4 .sq-near{display:none}" +
  "#sq-nav.sq-f3 .sq-flows .sq-l{display:none}" +
  "#sq-nav.sq-f5 .sq-seg.current>.sq-l{max-width:6rem}" +
  ".sq-fg{opacity:.7}" +
  // a phone pinches to zoom; its header is better spent on the view bar
  "@media (max-width:560px){.sq-pz #sq-zoom{display:none}#sq-bar{gap:8px;padding:10px 8px}}" +
  "#sq-nav button{font:inherit;font-size:12px;border:0;background:none;color:var(--sq-muted);" +
  "cursor:pointer;border-radius:5px;padding:0}" +
  "#sq-nav button:hover{color:var(--sq-ink)}" +
  ".sq-path{display:flex;align-items:center;gap:1px;padding:2px;min-width:0;" +
  "border:1px solid var(--sq-border);border-radius:8px;background:var(--sq-surface)}" +
  "#sq-nav .sq-home{width:26px;height:26px;font-size:15px;line-height:1;flex:none}" +
  "#sq-nav .sq-home[aria-current]{background:var(--sq-canvas);color:var(--sq-ink)}" +
  ".sq-div{width:1px;height:14px;background:var(--sq-border);margin:0 4px;flex:none}" +
  ".sq-sep{color:var(--sq-border);padding:0 1px}" +
  ".sq-hop{position:relative;display:flex;align-items:center}" +
  "#sq-nav .sq-seg{display:flex;align-items:center;gap:4px;height:26px;padding:0 8px 0 9px;" +
  "white-space:nowrap}" +
  ".sq-seg>.sq-l{overflow:hidden;text-overflow:ellipsis}" +
  "#sq-nav .sq-seg.current{color:var(--sq-ink);font-weight:600}" +
  "#sq-nav .sq-seg.ghost{font-style:italic}" +
  "#sq-nav .sq-seg[aria-expanded=true]{background:var(--sq-canvas);color:var(--sq-ink)}" +
  "#sq-nav span.sq-seg{cursor:default}" +
  ".sq-caret{font-size:9px;opacity:.7}.sq-count{font-variant-numeric:tabular-nums;opacity:.7}" +
  "#sq-nav .sq-flows>.sq-seg,#sq-nav #sq-hide{height:32px;border:1px solid var(--sq-border);" +
  "border-radius:8px;background:var(--sq-surface)}" +
  "#sq-nav .sq-flows>.sq-seg{padding:0 10px}" +
  "#sq-nav #sq-hide{display:none;width:32px;flex:none}body.presenting #sq-nav #sq-hide{display:block}" +
  ".sq-menu{position:absolute;top:calc(100% + 6px);left:0;z-index:5;width:256px;max-width:calc(100vw - 16px);" +
  "max-height:min(420px,70vh);overflow-y:auto;padding:4px;background:var(--sq-surface);" +
  "border:1px solid var(--sq-border);border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.16)}" +
  ".sq-flows .sq-menu{left:auto;right:0}" +
  "#sq-nav .sq-menu button{display:flex;align-items:center;gap:8px;width:100%;text-align:left;" +
  "padding:6px 9px;font-size:13px;color:var(--sq-ink)}" +
  "#sq-nav .sq-menu button:hover,#sq-nav .sq-menu button:focus-visible{background:var(--sq-canvas);outline:none}" +
  "#sq-nav .sq-menu [aria-checked=true]{font-weight:600;background:var(--sq-canvas)}" +
  ".sq-menu .sq-l{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
  ".sq-menu .sq-auto{font-size:10px;color:var(--sq-muted);border:1px solid var(--sq-border);" +
  "border-radius:4px;padding:0 4px}" +
  ".sq-menu .sq-n{font-size:11px;color:var(--sq-muted)}.sq-menu .sq-ck{width:12px;flex:none}" +
  // Presenting, the bar can be put away (b, or its own button). What is left
  // is a sliver at the top edge that brings it back on hover.
  "#sq-handle{display:none;position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:3;" +
  "width:240px;height:22px;padding:7px 0 0;border:0;background:none;cursor:pointer;transition:opacity .3s}" +
  "#sq-handle::after{content:\"\";display:block;margin:0 auto;width:44px;height:4px;border-radius:2px;" +
  "background:var(--sq-border)}" +
  "body.presenting.sq-navhidden #sq-nav{display:none}" +
  "body.presenting.sq-navhidden #sq-handle{display:block}" +
  // presenting: full bleed, chrome floats over the canvas and fades when idle
  "body.presenting #sq-bar{position:fixed;left:0;right:0;top:0;z-index:2;" +
  "transition:opacity .3s;background:transparent}" +
  "body.presenting #sq-stage{padding:0}" +
  "body.presenting.idle #sq-bar,body.presenting.idle #sq-handle{opacity:0;pointer-events:none}" +
  "body.presenting.idle,body.presenting.idle #sq-stage{cursor:none}" +
  "@media (prefers-reduced-motion:reduce){#sq-live,#sq-ghost{transition:none!important}}";
