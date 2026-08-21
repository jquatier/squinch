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
const cases = readdirSync(join(here, "cases")).filter((f) => f.endsWith(".squinch")).sort();

interface Cell {
  caseName: string; view: string;
  files: Record<string, string>;
  description: string;
}

/**
 * The case's own leading comment, as its description. Kept in the `.squinch`
 * file rather than a table here so the two cannot drift: whoever changes what a
 * case demonstrates is already editing the line that says so.
 */
function describe(src: string): string {
  const raw: string[] = [];
  for (const line of src.split("\n")) {
    if (!line.startsWith("//")) break;
    raw.push(line.replace(/^\/\/ ?/, "").replace(/\s+$/, ""));
  }
  // Rebuild the structure rather than flattening it: a blank comment line is a
  // paragraph break and a `-` starts a list item that its indented continuation
  // lines belong to. Joining everything with spaces turned a bullet list into
  // one unreadable run-on. Within a paragraph the source's 80-column wrapping is
  // dropped, since Markdown does its own.
  const out: string[] = [];
  let para: string[] = [];
  let inList = false;
  const flush = () => { if (para.length) out.push(para.join(" ")); para = []; };
  for (const line of raw) {
    const t = line.trim().replace(/\s{2,}/g, " ");
    if (!t) { flush(); inList = false; continue; }
    if (/^[-*]\s/.test(t)) { flush(); out.push(t); inList = true; continue; }
    if (inList) { out[out.length - 1] += ` ${t}`; continue; }
    para.push(t);
  }
  flush();
  // Consecutive list items join tightly; everything else gets a blank line.
  return out.reduce(
    (acc, block, i) =>
      i === 0 ? block
      : acc + (/^[-*]\s/.test(block) && /^[-*]\s/.test(out[i - 1]) ? "\n" : "\n\n") + block,
    "",
  );
}
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
  const caseThemes = THEMES;
  for (const view of views) {
    const cell: Cell = { caseName, view, files: {}, description: describe(src) };
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

// The slug ("01-minimal") is what the Source: line and every image filename
// key off — stable, and it's the real file on disk. The heading a human
// reads on GitHub is derived from it rather than stored twice, so the two
// can never drift apart: strip the ordinal, title-case what's left ("k8s"
// capitalizes as one word, giving the conventional "K8s" rather than "K8S").
const titleize = (name: string) =>
  name
    .replace(/^\d+-/, "")
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

// review grid: light/dark side by side per view
const md: string[] = [
  "# Lookbook",
  "",
  "Stress cases for the renderer, snapshot-locked (CI regenerates and diffs).",
  "Regenerate with `npx tsx lookbook/build.ts`; eyeball every cell before",
  "committing a visual change. What looks bad here becomes the next fix.",
  "",
];
// grouped by case, so a case that declares three views states what it is once
// rather than three times
for (let i = 0; i < cells.length; ) {
  const caseName = cells[i].caseName;
  const group = cells.filter((c) => c.caseName === caseName);
  i += group.length;

  md.push(`## ${titleize(caseName)}`, "");
  if (group[0].description) md.push(group[0].description, "");
  md.push(`Source: [\`cases/${caseName}.squinch\`](cases/${caseName}.squinch)`, "");
  for (const c of group) {
    if (group.length > 1) md.push(`**\`${c.view}\`**`, "");
    const themes = Object.keys(c.files);
    md.push(`| ${themes.join(" | ")} |`, `|${themes.map(() => "---").join("|")}|`);
    md.push(`| ${themes.map((th) => `![](out/${c.files[th]})`).join(" | ")} |`, "");
  }
}
writeFileSync(join(here, "README.md"), md.join("\n"));
console.log(`lookbook: ${cells.length} views across ${cases.length} cases → lookbook/out/`);
process.exit(failed ? 1 : 0);
