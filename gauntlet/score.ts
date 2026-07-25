// Phase-3 gauntlet scorer (docs/PLAN.md §3). Deterministic: builds each
// solution, renders every declared view in both themes, validates the SVG, and
// checks the prompt's structural expectations. Run from the repo root:
//
//   npx tsx gauntlet/score.ts
//
// Exit 0 only when every solution with a file present passes AND at least the
// Phase-3 bar (8/10) is met.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildProject, renderProject, validateSVG, formatDiagnostics,
} from "../packages/core/dist/index.js";

interface Expect {
  minNodes?: number;
  minSystems?: number;
  minViews?: number;
  minAsync?: number;
  minNotes?: number;
  requirePerson?: boolean;
  requireExternal?: boolean;
  requireHighlight?: boolean;
  requireTag?: string;
  icons?: string[][];
}
interface Prompt { id: string; prompt: string; expect: Expect }

const here = dirname(fileURLToPath(import.meta.url));
const prompts: Prompt[] = JSON.parse(readFileSync(join(here, "prompts.json"), "utf8"));

const BAR = 8;
let passed = 0;
const lines: string[] = [];

for (const p of prompts) {
  const file = join(here, "solutions", `${p.id}.squinch`);
  const problems: string[] = [];

  if (!existsSync(file)) {
    lines.push(`FAIL  ${p.id}  no solution file`);
    continue;
  }
  const src = readFileSync(file, "utf8");
  const built = buildProject([{ name: `${p.id}.squinch`, src }]);
  const errors = built.diagnostics.filter((d) => d.severity === "error");
  if (errors.length) {
    lines.push(`FAIL  ${p.id}  check errors:\n${formatDiagnostics(errors)}`);
    continue;
  }
  const warnings = built.diagnostics.filter((d) => d.severity === "warning");

  // render every explicitly declared view (or the sole auto view) in both themes
  const explicit = built.model.views.filter((v) => !v.auto);
  const views = (explicit.length ? explicit : built.model.views.slice(0, 1)).map((v) => v.name);
  for (const view of views)
    for (const theme of ["light", "dark"]) {
      const r = await renderProject([{ name: `${p.id}.squinch`, src }], { view, theme });
      if (!r.ok) problems.push(`render failed: ${view}/${theme}`);
      else {
        const valid = validateSVG(r.svg!);
        if (!valid.ok) problems.push(`invalid SVG (${view}/${theme}): ${valid.error}`);
      }
    }

  // structural expectations
  const e = p.expect;
  const m = built.model;
  const nodes = [...m.nodes.values()];
  const systems = [...m.containers.values()].filter((c) => c.kind === "system");
  const asyncEdges = m.edges.filter((ed) => ed.arrow === "~>");
  const allTags = new Set([
    ...nodes.flatMap((n) => n.tags),
    ...[...m.containers.values()].flatMap((c) => c.tags),
  ]);
  const iconIdsUsed = new Set(nodes.map((n) => n.icon?.id).filter(Boolean) as string[]);

  if (e.minNodes && nodes.length < e.minNodes)
    problems.push(`nodes ${nodes.length} < ${e.minNodes}`);
  if (e.minSystems && systems.length < e.minSystems)
    problems.push(`systems ${systems.length} < ${e.minSystems}`);
  if (e.minViews && explicit.length < e.minViews)
    problems.push(`views ${explicit.length} < ${e.minViews}`);
  if (e.minAsync && asyncEdges.length < e.minAsync)
    problems.push(`async edges ${asyncEdges.length} < ${e.minAsync}`);
  if (e.minNotes) {
    const notes = m.views.reduce((acc, v) => acc + v.notes.length, 0);
    if (notes < e.minNotes) problems.push(`notes ${notes} < ${e.minNotes}`);
  }
  if (e.requirePerson && !nodes.some((n) => n.kinds.includes("person") || n.icon?.id === "person"))
    problems.push("no person");
  if (e.requireExternal && !nodes.some((n) => n.kinds.includes("external")))
    problems.push("no external node");
  if (e.requireHighlight && !m.views.some((v) => v.highlight.length > 0))
    problems.push("no highlight view");
  if (e.requireTag && !allTags.has(e.requireTag)) problems.push(`missing tag #${e.requireTag}`);
  for (const anyOf of e.icons ?? [])
    if (!anyOf.some((id) => iconIdsUsed.has(id)))
      problems.push(`missing icon: ${anyOf.join(" | ")}`);

  if (problems.length) {
    lines.push(`FAIL  ${p.id}  ${problems.join("; ")}`);
  } else {
    passed++;
    lines.push(
      `PASS  ${p.id}  (${nodes.length} nodes, ${views.length} view(s)` +
        (warnings.length ? `, ${warnings.length} warning(s)` : "") +
        `)`,
    );
  }
}

console.log(lines.join("\n"));
console.log(`\nGauntlet: ${passed}/${prompts.length} (Phase-3 bar: ${BAR})`);
process.exit(passed === prompts.length ? 0 : passed >= BAR ? 0 : 1);
