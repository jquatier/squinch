// The pipeline itself: parse → model → layout → render. No host-specific I/O —
// see index.ts (Node) and browser.ts for how packs get registered.
import { buildModel, buildProject, formatDiagnostics, type ProjectFile } from "./model/build.js";
import { layoutView } from "./layout/layout.js";
import { renderSVG } from "./render/svg.js";
import { validateSVG } from "./render/validate.js";
import { mergeAdaptive } from "./render/adaptive.js";
import { themes, type Theme } from "./themes/index.js";
import { allPackNames, iconIds, iconMeta, iconExists, packExists, iconTitle } from "./model/packs.js";
import { packInfo } from "./packs/registry.js";
import { diffModels, formatDiff, formatDiffMarkdown } from "./diff/diff.js";
import { suggest } from "./model/suggest.js";
import type { BuildResult, Diagnostic, SView } from "./model/types.js";

export { buildModel, buildProject, formatDiagnostics, layoutView, renderSVG, validateSVG, themes };
// pack introspection — the editor tooling needs the same view of packs
// the compiler has (completion lists, hovers, validation).
export { allPackNames, iconIds, iconMeta, iconExists, packExists, iconTitle };
// semantic diff (SPEC §diff): model comparison, no layout involved
export { diffModels, formatDiff, formatDiffMarkdown };
export type { Change, ChangeKind, DiffResult, Weight } from "./diff/diff.js";

/** Diff two projects by source — the common entry point. */
export function diffProjects(before: ProjectFile[], after: ProjectFile[]) {
  return diffModels(buildProject(before).model, buildProject(after).model);
}

// FNV-1a over the project source — the sketch themes' jitter seed. Any edit
// to any file re-rolls every wobble; identical input wobbles identically.
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Every icon a source references — preload these before rendering in a browser. */
export function iconsUsedBy(files: ProjectFile[] | string): { pack: string; id: string }[] {
  const project = typeof files === "string" ? [{ name: "input", src: files }] : files;
  const { model } = buildProject(project);
  const refs = new Map<string, { pack: string; id: string }>();
  for (const n of model.nodes.values()) if (n.icon) refs.set(`${n.icon.pack}/${n.icon.id}`, n.icon);
  for (const z of model.zones) if (z.icon) refs.set(`${z.icon.pack}/${z.icon.id}`, z.icon);
  for (const c of model.containers.values()) {
    const g = c.attrs["glyph"];
    if (g?.includes("/")) refs.set(g, { pack: g.split("/")[0], id: g.split("/")[1] });
  }
  return [...refs.values()];
}

/** Icon search across installed packs — powers `squinch icons search`.
 *
 *  Matches every whitespace-separated word of the query against the id *and*
 *  the human title, treating `-` as a space. A raw substring test against the
 *  id alone is what shipped, and it failed on the most natural query anyone
 *  types: "front door", "key vault", "api management", "container registry"
 *  and "data factory" all returned nothing while the icons were right there.
 *
 *  A canonical id and its alias never both appear — one icon, one row. Callers
 *  that want to *show* the short forms (the CLI does, because SKILL.md teaches
 *  them and a result of only `azure/key-vaults` reads as proof that
 *  `azure/key-vault` doesn't exist) can look them up via `packInfo`. */
export function searchIcons(query: string, pack?: string): string[] {
  // Vendors are inconsistent about number — Azure has "Container Registries"
  // and "Data Factories" where everyone searches "container registry" and
  // "data factory" — so both sides are singularized before comparing.
  // Short words are left alone: stemming `sqs` to `sq` makes it match the `sq`
  // inside `postgresql`, and acronyms are exactly what people search by.
  const stem = (w: string) =>
    w.length < 5 ? w
      : w.endsWith("ies") ? `${w.slice(0, -3)}y`
      : w.endsWith("s") ? w.slice(0, -1)
      : w;
  const norm = (s: string) => s.toLowerCase().split(/[\s-]+/).filter(Boolean).map(stem).join(" ");
  const words = norm(query).split(" ").filter(Boolean);
  const hits: string[] = [];
  for (const name of allPackNames()) {
    if (pack && name !== pack) continue;
    const aliases = packInfo(name)?.aliases ?? {};
    const haystack = (id: string) => norm(`${id} ${iconTitle(name, id) ?? ""}`);
    const matched = new Set(
      iconIds(name).filter((id) => words.every((w) => haystack(id).includes(w))),
    );
    for (const id of [...matched].sort()) {
      if (aliases[id] && matched.has(aliases[id])) continue; // canonical covers it
      hits.push(`${name}/${id}`);
    }
  }
  return hits.sort();
}
export type { ProjectFile };
export type * from "./model/types.js";
export type { Positioned } from "./layout/layout.js";
export type { Theme } from "./themes/index.js";

export interface RenderResult {
  svg?: string;
  diagnostics: Diagnostic[];
  ok: boolean;
  /** Present when the view shows a flow. `steps` counts the hops that actually
   *  render *at this altitude* — a step whose endpoints both lift into one card
   *  has nothing to draw — so it is the real length of the story, and the bound
   *  a viewer should step to. */
  flow?: { label: string; steps: number };
}

/** Views a source declares, with the container each one scopes to (zoom targets). */
export function viewIndex(src: string): { name: string; scope?: string; title?: string; auto?: boolean }[] {
  const { model } = buildModel(src);
  return model.views.map((v) => ({ name: v.name, scope: v.scope, title: v.title, auto: v.auto }));
}

/** One-call pipeline: source → SVG for a view (default: first/implicit view). */
export async function render(
  src: string,
  opts: {
    view?: string;
    theme?: string;
    embedFonts?: boolean;
    flowStep?: number;
    /** Emit one file carrying both palettes, switched by `prefers-color-scheme`
     *  — for embedding somewhere you do not control the background. Requires a
     *  theme with a `pairsWith` counterpart. */
    adaptive?: boolean;
  } = {},
): Promise<RenderResult> {
  return renderProject([{ name: "input", src }], opts);
}

/** Multi-file project pipeline: files merge into one model namespace (SPEC §2). */
export async function renderProject(
  files: ProjectFile[],
  opts: {
    view?: string;
    theme?: string;
    embedFonts?: boolean;
    flowStep?: number;
    /** Emit one file carrying both palettes, switched by `prefers-color-scheme`
     *  — for embedding somewhere you do not control the background. Requires a
     *  theme with a `pairsWith` counterpart. */
    adaptive?: boolean;
  } = {},
): Promise<RenderResult> {
  const built: BuildResult = buildProject(files);
  if (!built.ok) return { diagnostics: built.diagnostics, ok: false };

  let view: SView | undefined = opts.view
    ? built.model.views.find((v) => v.name === opts.view)
    : built.model.views[0];
  // A view name that doesn't exist used to fall through to the implicit default
  // below: a *different* diagram, rendered successfully, exit 0. In an agent
  // loop driven by exit codes that is the worst possible failure — a typo buys
  // you a plausible picture with none of your view's settings.
  if (opts.view && !view) {
    const names = built.model.views.map((v) => v.name);
    return {
      diagnostics: [
        ...built.diagnostics,
        {
          severity: "error",
          message: `unknown view \`${opts.view}\``,
          fix: names.length
            ? ((m) => (m ? `did you mean \`${m}\`? ` : "") + `views: ${names.join(", ")}`)(
                suggest(opts.view, names),
              )
            : "this project declares no views",
          loc: { from: 0, to: 0, line: 1, col: 1 },
        },
      ],
      ok: false,
    };
  }
  if (!view) {
    // implicit default view: everything (auto view of sole top-level container)
    const first = [...built.model.containers.keys()][0];
    view = {
      name: first ?? "default", scope: first,
      only: [], include: [], includeStar: false, exclude: [], expand: [], detail: [],
      context: "auto", highlight: [], showDescriptions: false, legend: false, notes: [],
      layout: { place: [], routes: [], align: [], channels: [] },
      loc: { from: 0, to: 0, line: 1, col: 1 },
    };
  }

  const themeName = opts.theme ?? view.theme ?? built.model.fileTheme ?? "light";
  const theme: Theme | undefined = themes[themeName];
  const diagnostics = [...built.diagnostics];
  if (!theme)
    return {
      diagnostics: [...diagnostics, {
        severity: "error",
        message: `unknown theme \`${themeName}\``,
        fix: `available: ${Object.keys(themes).join(", ")}`,
        loc: view.loc,
      }],
      ok: false,
    };

  const { positioned, diagnostics: layoutDiags } = await layoutView(built.model, view, theme.font);
  diagnostics.push(...layoutDiags);
  if (diagnostics.some((d) => d.severity === "error")) return { diagnostics, ok: false };
  const flow = positioned.flow
    ? {
        label: positioned.flow.label,
        // distinct hops that render *here*, which is what `flowStep` counts
        steps: new Set(Object.values(positioned.flow.byEdge).flat()).size,
      }
    : undefined;
  // One geometry, drawn once per palette. Layout depends on the theme only
  // through its font, and an adaptive pair shares that font — so both draws
  // come off the same `positioned` and cannot disagree about anything but
  // colour. That is what makes folding them into one file safe.
  const draw = (th: Theme) =>
    renderSVG(positioned, th, {
      highlight: view.highlight,
      notes: view.notes,
      showDescriptions: view.showDescriptions,
      legend: view.legend,
      titleblock: view.titleblock,
      title: view.title,
      embedFonts: opts.embedFonts,
      flowStep: opts.flowStep,
      // sketch jitter is a pure function of the source text (never randomness)
      seed: fnv1a(files.map((f) => f.src).join("\u0000")),
    });

  let svg = draw(theme);
  if (opts.adaptive) {
    const pair = theme.pairsWith ? themes[theme.pairsWith] : undefined;
    if (!pair) {
      const pairable = Object.values(themes).filter((x) => x.pairsWith).map((x) => x.name);
      return {
        diagnostics: [...diagnostics, {
          severity: "error",
          message: `theme \`${themeName}\` has no dark counterpart to pair with`,
          fix:
            "an adaptive SVG is a light theme carrying a dark override; " +
            `render one of: ${pairable.join(", ")}`,
          loc: view.loc,
        }],
        ok: false,
      };
    }
    svg = mergeAdaptive(svg, draw(pair));
  }

  return { svg, diagnostics, ok: true, ...(flow ? { flow } : {}) };
}
