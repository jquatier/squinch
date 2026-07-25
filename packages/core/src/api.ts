// The pipeline itself: parse → model → layout → render. No host-specific I/O —
// see index.ts (Node) and browser.ts for how packs get registered.
import { buildModel, buildProject, formatDiagnostics, type ProjectFile } from "./model/build.js";
import { layoutView } from "./layout/layout.js";
import { renderSVG } from "./render/svg.js";
import { validateSVG } from "./render/validate.js";
import { themes, type Theme } from "./themes/index.js";
import { allPackNames, iconIds } from "./model/packs.js";
import type { BuildResult, Diagnostic, SView } from "./model/types.js";

export { buildModel, buildProject, formatDiagnostics, layoutView, renderSVG, validateSVG, themes };

/** Every icon a source references — preload these before rendering in a browser. */
export function iconsUsedBy(files: ProjectFile[] | string): { pack: string; id: string }[] {
  const project = typeof files === "string" ? [{ name: "input", src: files }] : files;
  const { model } = buildProject(project);
  const refs = new Map<string, { pack: string; id: string }>();
  for (const n of model.nodes.values()) if (n.icon) refs.set(`${n.icon.pack}/${n.icon.id}`, n.icon);
  for (const c of model.containers.values()) {
    const g = c.attrs["glyph"];
    if (g?.includes("/")) refs.set(g, { pack: g.split("/")[0], id: g.split("/")[1] });
  }
  return [...refs.values()];
}

/** Icon search across installed packs — powers `squinch icons search`. */
export function searchIcons(query: string, pack?: string): string[] {
  const q = query.toLowerCase();
  const hits: string[] = [];
  for (const name of allPackNames()) {
    if (pack && name !== pack) continue;
    for (const id of iconIds(name)) if (id.includes(q)) hits.push(`${name}/${id}`);
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
}

/** Views a source declares, with the container each one scopes to (zoom targets). */
export function viewIndex(src: string): { name: string; scope?: string; title?: string; auto?: boolean }[] {
  const { model } = buildModel(src);
  return model.views.map((v) => ({ name: v.name, scope: v.scope, title: v.title, auto: v.auto }));
}

/** One-call pipeline: source → SVG for a view (default: first/implicit view). */
export async function render(
  src: string,
  opts: { view?: string; theme?: string; embedFonts?: boolean } = {},
): Promise<RenderResult> {
  return renderProject([{ name: "input", src }], opts);
}

/** Multi-file project pipeline: files merge into one model namespace (SPEC §2). */
export async function renderProject(
  files: ProjectFile[],
  opts: { view?: string; theme?: string; embedFonts?: boolean } = {},
): Promise<RenderResult> {
  const built: BuildResult = buildProject(files);
  if (!built.ok) return { diagnostics: built.diagnostics, ok: false };

  let view: SView | undefined = opts.view
    ? built.model.views.find((v) => v.name === opts.view)
    : built.model.views[0];
  if (!view) {
    // implicit default view: everything (auto view of sole top-level container)
    const first = [...built.model.containers.keys()][0];
    view = {
      name: first ?? "default", scope: first,
      include: [], includeStar: false, exclude: [], expand: [],
      context: "auto", highlight: [], showDescriptions: false, notes: [],
      layout: { place: [], routes: [] },
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

  const { positioned, diagnostics: layoutDiags } = await layoutView(built.model, view);
  diagnostics.push(...layoutDiags);
  if (diagnostics.some((d) => d.severity === "error")) return { diagnostics, ok: false };
  return {
    svg: renderSVG(positioned, theme, {
      highlight: view.highlight,
      notes: view.notes,
      showDescriptions: view.showDescriptions,
      embedFonts: opts.embedFonts,
    }),
    diagnostics,
    ok: true,
  };
}
