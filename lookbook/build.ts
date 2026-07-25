// The lookbook (DESIGN.md §9): curated stress cases rendered in every theme,
// snapshot-locked. CI runs this and fails if lookbook/out/ drifts from what's
// committed — any intentional visual change means re-running and eyeballing
// the grid before commit.
//
//   npx tsx lookbook/build.ts        (from the repo root)
import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildProject, renderProject, validateSVG, formatDiagnostics,
} from "../packages/core/dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "out");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const THEMES = ["light", "dark"];
// sketch snapshots on a curated subset (the Caveat embed adds ~110KB per SVG)
const SKETCH_CASES = new Set(["01-minimal", "06-dense-mesh", "08-landscape", "10-highlight-notes"]);
const cases = readdirSync(join(here, "cases")).filter((f) => f.endsWith(".squinch")).sort();

interface Cell { caseName: string; view: string; files: Record<string, string> }
const cells: Cell[] = [];
let failed = false;

for (const file of cases) {
  const caseName = basename(file, ".squinch");
  const src = readFileSync(join(here, "cases", file), "utf8");
  const built = buildProject([{ name: file, src }]);
  const errors = built.diagnostics.filter((d) => d.severity === "error");
  if (errors.length) {
    console.error(`FAIL ${caseName}\n${formatDiagnostics(errors)}`);
    failed = true;
    continue;
  }
  const explicit = built.model.views.filter((v) => !v.auto);
  const views = (explicit.length ? explicit : built.model.views.slice(0, 1)).map((v) => v.name);
  const caseThemes = SKETCH_CASES.has(caseName) ? [...THEMES, "sketch", "sketch-dark"] : THEMES;
  for (const view of views) {
    const cell: Cell = { caseName, view, files: {} };
    for (const theme of caseThemes) {
      const r = await renderProject([{ name: file, src }], { view, theme });
      if (!r.ok) {
        console.error(`FAIL ${caseName}/${view}/${theme}\n${formatDiagnostics(r.diagnostics)}`);
        failed = true;
        continue;
      }
      const valid = validateSVG(r.svg!);
      if (!valid.ok) {
        console.error(`FAIL ${caseName}/${view}/${theme}: invalid SVG: ${valid.error}`);
        failed = true;
        continue;
      }
      const name = `${caseName}.${view}.${theme}.svg`;
      writeFileSync(join(outDir, name), r.svg!);
      cell.files[theme] = name;
    }
    cells.push(cell);
  }
}

// review grid: light/dark side by side per view
const md: string[] = [
  "# Lookbook",
  "",
  "Stress cases for the renderer, snapshot-locked (CI regenerates and diffs).",
  "Regenerate with `npx tsx lookbook/build.ts`; eyeball every cell before",
  "committing a visual change. What looks bad here becomes the next fix.",
  "",
];
for (const c of cells) {
  md.push(`## ${c.caseName} — \`${c.view}\``, "");
  const themes = Object.keys(c.files);
  md.push(`| ${themes.join(" | ")} |`, `|${themes.map(() => "---").join("|")}|`);
  md.push(`| ${themes.map((th) => `![](out/${c.files[th]})`).join(" | ")} |`, "");
}
writeFileSync(join(here, "README.md"), md.join("\n"));
console.log(`lookbook: ${cells.length} views across ${cases.length} cases → lookbook/out/`);
process.exit(failed ? 1 : 0);
