// Both engines over every view the repo owns, measured the same way.
// Prints the table the spike's write-up quotes (docs/notes/layout-engine-spike.md):
//   npx vitest run spike/grid/compare.test.ts --disable-console-intercept
import { it, expect } from "vitest";
import { buildProject } from "../../src/index.js";
import { layoutView } from "../../src/layout/layout.js";
import { corpus } from "../../test/helpers/corpus.js";
import { checkLayout } from "../../test/invariants.js";
import { layoutViewGrid } from "./layout.js";
import { measureLayout, type Metrics } from "./metrics.js";

it("grid vs ELK over the corpus", async () => {
  const keys: (keyof Metrics)[] = ["area", "wire", "bends", "crossings", "overlaps", "throughNode", "kinks", "unstraight"];
  const total = { elk: {} as Record<string, number>, grid: {} as Record<string, number> };
  const wins = {} as Record<string, [better: number, worse: number]>;
  for (const k of keys) { total.elk[k] = 0; total.grid[k] = 0; wins[k] = [0, 0]; }
  let views = 0, msElk = 0, msGrid = 0;
  const illegal: string[] = [];
  for (const f of corpus()) {
    const built = buildProject([{ name: f.name, src: f.src }]);
    if (built.diagnostics.some((d) => d.severity === "error")) continue;
    const ctx = { zoneMembers: new Map(built.model.zones.map((z) => [z.id, z.members])) };
    for (const view of built.model.views) {
      let t = performance.now();
      const elk = (await layoutView(built.model, view)).positioned;
      msElk += performance.now() - t;
      t = performance.now();
      const grid = layoutViewGrid(built.model, view);
      msGrid += performance.now() - t;
      views++;
      // every wire held to the rule only the coplanar router's are held to
      // today: it crosses no box it does not belong to
      const strict = { ...grid.positioned, edges: grid.positioned.edges.map((e) => ({ ...e, coplanar: true as const })) };
      for (const v of [...checkLayout(strict, ctx), ...grid.skipped.map((w) => `wire ${w} not drawn`)]) illegal.push(`${f.name}#${view.name} ${v}`);
      const a = measureLayout(elk), b = measureLayout(grid.positioned);
      for (const k of keys) { total.elk[k] += a[k]; total.grid[k] += b[k]; if (b[k] < a[k]) wins[k][0]++; if (b[k] > a[k]) wins[k][1]++; }
    }
  }
  console.log(`${views} views · ELK ${Math.round(msElk)}ms · grid ${Math.round(msGrid)}ms`);
  for (const k of keys)
    console.log(`${k.padEnd(12)} ELK ${String(total.elk[k]).padStart(9)}  grid ${String(total.grid[k]).padStart(9)}  ×${(total.grid[k] / (total.elk[k] || 1)).toFixed(2)}  grid better in ${wins[k][0]}, worse in ${wins[k][1]}`);
  console.log(illegal.slice(0, 20).join("\n"));
  expect(views).toBeGreaterThan(120);
  expect(illegal).toEqual([]);
}, 300_000);
