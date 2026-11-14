// Diagrams neither engine has seen: twenty written by hand (`trial/`) and a
// seeded batch of random ones. Nothing in the engine was tuned against these.
//   npx vitest run spike/weft/trial.test.ts --disable-console-intercept
import { it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildProject } from "../../src/index.js";
import { layoutView } from "../../src/layout/layout.js";
import { checkLayout } from "../../test/invariants.js";
import { layoutViewWeft } from "./layout.js";
import { measureLayout, type Metrics } from "./metrics.js";
import { randomDiagram } from "./random.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "trial");

it("weft vs ELK on diagrams neither has seen", async () => {
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
      const grid = layoutViewWeft(built.model, view);
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
  console.log(`${"view".padEnd(26)} ${"ELK".padEnd(10)} ${"weft".padEnd(10)} (ELK/weft)`);
  console.log(lines.join("\n"));
  console.log(`\n${views} views · ELK: ${elkErrors} errors, ${elkWarnings} warnings, ${elkBad} invariant violations, ${elkCrashed} crashes · weft: ${gridBad.length} violations`);
  for (const k of keys) console.log(`${k.padEnd(12)} ELK ${String(total.elk[k]).padStart(9)}  weft ${String(total.grid[k]).padStart(9)}  ×${(total.grid[k] / (total.elk[k] || 1)).toFixed(2)}`);
  console.log(broken.join("\n"));
  console.log(gridBad.slice(0, 30).join("\n"));
  expect(broken).toEqual([]);
  expect(gridBad).toEqual([]);
}, 600_000);
