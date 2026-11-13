// Diagrams neither engine has seen: twenty written by hand (`trial/`) and a
// seeded batch of random ones. Nothing in the engine was tuned against these.
//   npx vitest run spike/grid/trial.test.ts --disable-console-intercept
import { it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildProject } from "../../src/index.js";
import { layoutView } from "../../src/layout/layout.js";
import { checkLayout } from "../../test/invariants.js";
import { layoutViewGrid } from "./layout.js";
import { measureLayout, type Metrics } from "./metrics.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "trial");

/** A random diagram: a layered DAG with a few back edges, labels, and —
 *  for some — systems, a `rows` line, a rightward flow or a `wrap`. */
export function randomDiagram(seed: number): string {
  let s = seed * 7919 + 17;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = (n: number) => Math.floor(rnd() * n);
  const n = 5 + pick(18);
  const grouped = seed % 3 === 0;
  const ids = Array.from({ length: n }, (_, i) => `n${i}`);
  const group = (i: number) => (grouped ? `g${Math.min(3, Math.floor((i * 4) / n))}` : undefined);
  const path = (i: number) => (group(i) ? `${group(i)}.${ids[i]}` : ids[i]);
  const edges: string[] = [];
  const seen = new Set<string>();
  for (let i = 1; i < n; i++) {
    const fan = 1 + pick(2);
    for (let k = 0; k < fan; k++) {
      const from = pick(i);
      if (seen.has(`${from}>${i}`)) continue;
      seen.add(`${from}>${i}`);
      edges.push(`${path(from)} ${rnd() < 0.25 ? "~>" : "->"} ${path(i)}${rnd() < 0.3 ? ` "${["reads", "writes", "calls", "notifies", "syncs"][pick(5)]}"` : ""}`);
    }
  }
  for (let k = 0; k < Math.floor(n / 8); k++) {
    const a = 1 + pick(n - 1), b = pick(a);
    if (!seen.has(`${a}>${b}`)) { seen.add(`${a}>${b}`); edges.push(`${path(a)} -> ${path(b)} "retry"`); }
  }
  const decl = (i: number) => `${ids[i]} = box "Node ${i}"`;
  let src = "";
  if (grouped) {
    const groups = [...new Set(ids.map((_, i) => group(i)!))];
    for (const g of groups) src += `system ${g} "Group ${g.slice(1)}" {\n${ids.map((_, i) => i).filter((i) => group(i) === g).map((i) => `  ${decl(i)}`).join("\n")}\n}\n`;
  } else src += ids.map((_, i) => decl(i)).join("\n") + "\n";
  src += edges.join("\n") + "\n";
  const hint = seed % 5 === 1 ? "\n  layout { direction right }" : seed % 5 === 2 ? "\n  layout { wrap 4 }"
    : seed % 5 === 3 && !grouped && n >= 6 ? `\n  layout { rows [${ids.slice(0, 3).join(" ")}] [${ids.slice(3, 6).join(" ")}] }` : "";
  src += `view v { include *${grouped ? `\n  expand ${seed % 2 ? "*" : "g0, g1"}` : ""}${hint} }\n`;
  return src;
}

it("grid vs ELK on diagrams neither has seen", async () => {
  const sources = [
    ...readdirSync(dir).filter((f) => f.endsWith(".squinch")).sort().map((f) => ({ name: f.replace(".squinch", ""), src: readFileSync(join(dir, f), "utf8") })),
    ...Array.from({ length: 80 }, (_, i) => ({ name: `random-${i}`, src: randomDiagram(i) })),
  ];
  const keys: (keyof Metrics)[] = ["area", "wire", "bends", "crossings", "kinks", "throughNode", "nearMiss"];
  const total = { elk: {} as Record<string, number>, grid: {} as Record<string, number> };
  for (const k of keys) { total.elk[k] = 0; total.grid[k] = 0; }
  const lines: string[] = [], gridBad: string[] = [], broken: string[] = [];
  let views = 0, elkErrors = 0, elkWarnings = 0, elkBad = 0, elkCrashed = 0;
  for (const { name, src } of sources) {
    const built = buildProject([{ name, src }]);
    const errs = built.diagnostics.filter((d) => d.severity === "error");
    if (errs.length) { broken.push(`${name}: ${errs[0].message}`); continue; }
    for (const view of built.model.views.filter((v) => !v.auto)) {
      views++;
      const grid = layoutViewGrid(built.model, view);
      const strict = { ...grid.positioned, edges: grid.positioned.edges.map((e) => ({ ...e, coplanar: true as const })) };
      const trunks = new Set(grid.positioned.edges.filter((e) => e.via === "bus").map((e) => e.to));
      for (const v of [...checkLayout(strict, { channelTargets: trunks }), ...grid.skipped.map((w) => `wire ${w} not drawn`)]) gridBad.push(`${name}#${view.name} ${v}`);
      const b = measureLayout(grid.positioned);
      let a: Metrics | undefined, note = "";
      try {
        const elk = await layoutView(built.model, view);
        const e = elk.diagnostics.filter((d) => d.severity === "error").length, w = elk.diagnostics.filter((d) => d.severity === "warning").length;
        const bad = checkLayout(elk.positioned).length;
        elkErrors += e; elkWarnings += w; elkBad += bad;
        note = `${e ? ` ELK:${e} error` : ""}${w ? ` ELK:${w} warning` : ""}${bad ? ` ELK:${bad} violation` : ""}`;
        a = measureLayout(elk.positioned);
        for (const k of keys) { total.elk[k] += a[k]; total.grid[k] += b[k]; }
      } catch { elkCrashed++; note = " ELK:crashed"; }
      if (!name.startsWith("random"))
        lines.push(`${`${name}#${view.name}`.padEnd(26)} ${a ? `${a.width}×${a.height}`.padEnd(10) : "—".padEnd(10)} ${`${b.width}×${b.height}`.padEnd(10)} bends ${String(a?.bends ?? "—").padStart(3)}/${String(b.bends).padEnd(3)} cross ${String(a?.crossings ?? "—").padStart(2)}/${String(b.crossings).padEnd(2)}${note}`);
    }
  }
  console.log(`${"view".padEnd(26)} ${"ELK".padEnd(10)} ${"grid".padEnd(10)} (ELK/grid)`);
  console.log(lines.join("\n"));
  console.log(`\n${views} views · ELK: ${elkErrors} errors, ${elkWarnings} warnings, ${elkBad} invariant violations, ${elkCrashed} crashes · grid: ${gridBad.length} violations`);
  for (const k of keys) console.log(`${k.padEnd(12)} ELK ${String(total.elk[k]).padStart(9)}  grid ${String(total.grid[k]).padStart(9)}  ×${(total.grid[k] / (total.elk[k] || 1)).toFixed(2)}`);
  console.log(broken.join("\n"));
  console.log(gridBad.slice(0, 30).join("\n"));
  expect(broken).toEqual([]);
  expect(gridBad).toEqual([]);
}, 600_000);
