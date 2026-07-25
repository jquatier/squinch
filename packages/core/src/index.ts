// @squinch/core — parse → model → layout → render, end to end.
import { buildModel, buildProject, formatDiagnostics, type ProjectFile } from "./model/build.js";
import { layoutView } from "./layout/layout.js";
import { renderSVG } from "./render/svg.js";
import { validateSVG } from "./render/validate.js";
import { themes, type Theme } from "./themes/index.js";
import type { BuildResult, Diagnostic, SView } from "./model/types.js";

export { buildModel, buildProject, formatDiagnostics, layoutView, renderSVG, validateSVG, themes };
export type { ProjectFile };
export type * from "./model/types.js";
export type { Positioned } from "./layout/layout.js";
export type { Theme } from "./themes/index.js";

export interface RenderResult {
  svg?: string;
  diagnostics: Diagnostic[];
  ok: boolean;
}

/** One-call pipeline: source → SVG for a view (default: first/implicit view). */
export async function render(
  src: string,
  opts: { view?: string; theme?: string } = {},
): Promise<RenderResult> {
  return renderProject([{ name: "input", src }], opts);
}

/** Multi-file project pipeline: files merge into one model namespace (SPEC §2). */
export async function renderProject(
  files: ProjectFile[],
  opts: { view?: string; theme?: string } = {},
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
    }),
    diagnostics,
    ok: true,
  };
}
