// Phase-3 gauntlet scorer (docs/PLAN.md §3). Deterministic: builds each
// solution, renders every declared view in both themes, validates the SVG, and
// checks the prompt's structural expectations. Run from the repo root:
//
//   npx tsx gauntlet/score.ts [solutionsDir] [--deep] [--json]
//
// solutionsDir defaults to gauntlet/solutions — whatever the last `run.ts`
// round produced and the maintainer reviewed. Pass a directory to score a
// stashed run for comparison.
//
// --deep adds renderer coverage beyond "does it draw": every theme, a PNG
// through resvg, a determinism byte-compare, the auto views, and two structural
// probes (see below). `run.ts` always passes it; CI's per-push step does not,
// for speed.
//
// --json emits [{id, pass, problems}] so run.ts can merge results structurally
// rather than scraping PASS/FAIL text.
//
// **Exit 0 only when every prompt passes.** BAR is what a *run* is judged
// against — "did this cold round clear the Phase-3 bar" — but the committed
// corpus is the reviewed current state, so one silent failure in it is a
// regression, not an acceptable 19/20.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildProject, renderProject, validateSVG, formatDiagnostics, themes,
} from "../packages/core/dist/index.js";
import { svgToPng } from "../packages/cli/src/raster.js";

interface Expect {
  minNodes?: number;
  minSystems?: number;
  minViews?: number;
  minAsync?: number;
  minNotes?: number;
  minZones?: number;
  minFlows?: number;
  requirePerson?: boolean;
  requireExternal?: boolean;
  requireHighlight?: boolean;
  requireTag?: string;
  /** some declared view must show strictly fewer elements than the widest —
   *  i.e. a real lens exists, however the author chose to build it */
  requireNarrowerView?: boolean;
  /** a view must render a declared flow */
  requireFlowShown?: boolean;
  /** a view must use a channel trunk */
  requireChannel?: boolean;
  /** at least one node must use an icon from this pack */
  requirePack?: string;
  icons?: string[][];
}
interface Prompt { id: string; prompt: string; expect: Expect }

const here = dirname(fileURLToPath(import.meta.url));
const prompts: Prompt[] = JSON.parse(readFileSync(join(here, "prompts.json"), "utf8"));
const args = process.argv.slice(2);
const DEEP = args.includes("--deep");
const JSON_OUT = args.includes("--json");
const positional = args.find((a) => !a.startsWith("--"));
const solutionsDir = positional ? resolve(positional) : join(here, "solutions");

/** The bar a cold *run* is judged against (docs/PLAN.md §3). Not the exit
 *  condition — see the header. */
const BAR = 16;
let passed = 0;
const lines: string[] = [];
const results: { id: string; pass: boolean; problems: string[] }[] = [];

for (const p of prompts) {
  const file = join(solutionsDir, `${p.id}.squinch`);
  const problems: string[] = [];

  if (!existsSync(file)) {
    lines.push(`FAIL  ${p.id}  no solution file`);
    results.push({ id: p.id, pass: false, problems: ["no solution file"] });
    continue;
  }
  const src = readFileSync(file, "utf8");
  const built = buildProject([{ name: `${p.id}.squinch`, src }]);
  const errors = built.diagnostics.filter((d) => d.severity === "error");
  if (errors.length) {
    lines.push(`FAIL  ${p.id}  check errors:\n${formatDiagnostics(errors)}`);
    results.push({ id: p.id, pass: false, problems: errors.map((d) => d.message) });
    continue;
  }
  // A warning is a failure here, and this is the only place that can enforce it:
  // `squinch check` exits 0 on warnings by design, so nothing downstream of the
  // agent notices. Every warning the engine emits means "this file is valid but
  // probably not the diagram that was asked for" — an inert hint, a lens that
  // filtered nothing, a zone that vanished. A corpus entry carrying one is a
  // diagram nobody would want, sitting in the set we point at as the standard.
  //
  // This was computed and then only ever printed, while a comment below claimed
  // warnings were already a failure and used that to justify deleting the
  // hint-effectiveness probe. They were not.
  const warnings = built.diagnostics.filter((d) => d.severity === "warning");
  for (const w of warnings) problems.push(`warning: ${w.message}`);

  // render every explicitly declared view (or the sole auto view). Shallow does
  // light+dark, which is the CI gate; --deep sweeps every theme the engine
  // declares — read off `themes` rather than a literal, so a sixth is covered
  // the day it lands.
  const explicit = built.model.views.filter((v) => !v.auto);
  const views = (explicit.length ? explicit : built.model.views.slice(0, 1)).map((v) => v.name);
  const sweep = DEEP ? Object.keys(themes) : ["light", "dark"];
  const render = (view: string, opts: Record<string, unknown> = {}) =>
    renderProject([{ name: `${p.id}.squinch`, src }], { view, theme: "light", ...opts });

  // Layout-stage warnings only exist once a view is laid out, so `buildProject`
  // above cannot see them — and they are exactly the "silent construct" class:
  // an inert hint, a zone that vanished, sides ignored on a same-rank edge.
  // Deduped, because the same warning repeats for every theme.
  const seenWarnings = new Set<string>();
  for (const view of views)
    for (const theme of sweep) {
      const r = await render(view, { theme });
      if (!r.ok) problems.push(`render failed: ${view}/${theme}`);
      else {
        const valid = validateSVG(r.svg!);
        if (!valid.ok) problems.push(`invalid SVG (${view}/${theme}): ${valid.error}`);
      }
      for (const d of r.diagnostics)
        if (d.severity === "warning" && !seenWarnings.has(d.message)) {
          seenWarnings.add(d.message);
          problems.push(`warning (${view}): ${d.message}`);
        }
    }

  if (DEEP) {
    // Auto views: the SPA zooms into them and nothing else in CI draws one.
    for (const v of built.model.views.filter((x) => x.auto)) {
      const r = await render(v.name);
      if (!r.ok) problems.push(`render failed: auto view ${v.name}`);
      else if (!validateSVG(r.svg!).ok) problems.push(`invalid SVG: auto view ${v.name}`);
    }

    // Determinism is the product's premise; asserted elsewhere only on
    // synthetic input. Here it runs over 20 real diagrams for free.
    const a = await render(views[0]);
    const b = await render(views[0]);
    if (a.ok && b.ok && a.svg !== b.svg) problems.push("non-deterministic render");

    // resvg *panics* rather than throwing when it dislikes geometry, and these
    // are the most varied real inputs available to point at it.
    if (a.ok)
      try {
        svgToPng(a.svg!);
      } catch (err) {
        problems.push(`png rasterize failed: ${(err as Error).message.slice(0, 80)}`);
      }

    // There is deliberately no "do the layout hints change the render" probe
    // here, though round 3's finding #1 was exactly that. Tried and removed: a
    // render-diff cannot tell a *discarded* hint from a merely *redundant* one,
    // and redundant is the common case — `rows [fd] [app] [sql cache kv ai]`
    // over a fan-out describes what ELK already does, so the SVGs match and the
    // hint is still honoured. It fired on 6 of 20 good solutions.
    //
    // The real defect has a real detector instead: the engine warns on hints it
    // drops, and warnings are a failure — which is true as of the loop above,
    // and was not true when this comment first claimed it. The probe was
    // deleted in favour of a gate that did not yet exist.

    // Probe — view distinctness. Two declared views drawing the same picture
    // means one of them is inert; generalises `requireNarrowerView`.
    if (views.length > 1) {
      const svgs = await Promise.all(views.map(async (v) => (await render(v)).svg));
      const seen = new Map<string, string>();
      for (let i = 0; i < views.length; i++) {
        const prev = svgs[i] && seen.get(svgs[i]!);
        if (prev) problems.push(`views \`${prev}\` and \`${views[i]}\` render identically`);
        else if (svgs[i]) seen.set(svgs[i]!, views[i]);
      }
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
  // a whole `system … external` counts: since containers can carry the kind,
  // checking leaf nodes alone reported "no external node" for a diagram whose
  // external thing was the system card
  if (
    e.requireExternal
    && !nodes.some((n) => n.kinds.includes("external"))
    && ![...m.containers.values()].some((c) => c.kinds.includes("external"))
  )
    problems.push("no external node");
  if (e.requireHighlight && !m.views.some((v) => v.highlight.length > 0))
    problems.push("no highlight view");
  if (e.requireTag && !allTags.has(e.requireTag)) problems.push(`missing tag #${e.requireTag}`);
  if (e.minZones && m.zones.length < e.minZones)
    problems.push(`zones ${m.zones.length} < ${e.minZones}`);
  if (e.minFlows && m.flows.length < e.minFlows)
    problems.push(`flows ${m.flows.length} < ${e.minFlows}`);
  if (e.requireFlowShown && !m.views.some((v) => v.showFlow))
    problems.push("no view renders a flow (`show flow <id>`)");
  if (e.requireChannel && !m.views.some((v) => v.layout.channels.length))
    problems.push("no channel trunk");
  if (e.requireNarrowerView) {
    const counts = await Promise.all(
      explicit.map(async (v) => {
        const r = await renderProject([{ name: `${p.id}.squinch`, src }], { view: v.name });
        return r.ok ? (r.svg!.match(/data-kind="(leaf|card)"/g) ?? []).length : 0;
      }),
    );
    if (counts.length < 2 || Math.min(...counts) >= Math.max(...counts))
      problems.push("no view narrows the picture — every view shows the same elements");
  }
  if (e.requirePack && !nodes.some((n) => n.icon?.pack === e.requirePack))
    problems.push(`no icon from the \`${e.requirePack}\` pack`);
  for (const anyOf of e.icons ?? [])
    if (!anyOf.some((id) => iconIdsUsed.has(id)))
      problems.push(`missing icon: ${anyOf.join(" | ")}`);

  results.push({ id: p.id, pass: problems.length === 0, problems });
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

if (JSON_OUT) {
  console.log(JSON.stringify(results, null, 2));
} else {
  console.log(lines.join("\n"));
  console.log(
    `\nGauntlet: ${passed}/${prompts.length}` +
      (passed >= BAR ? ` (clears the Phase-3 bar of ${BAR})` : ` (below the Phase-3 bar of ${BAR})`) +
      (DEEP ? " — deep" : ""),
  );
}
// Every prompt, not the bar: the committed corpus is the reviewed current
// state, so one silent failure in it is a regression rather than an
// acceptable 19/20. BAR judges a *run*; this judges the corpus.
process.exit(passed === prompts.length ? 0 : 1);
