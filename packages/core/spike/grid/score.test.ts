// The verdict: every view the repo owns, twenty hand-written trial diagrams,
// sixteen more written after the engine (`round2/`) and eighty random ones —
// each drawn by both engines and scored by `score.ts`.
//   npx vitest run spike/grid/score.test.ts --disable-console-intercept
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildProject } from "../../src/index.js";
import { layoutView } from "../../src/layout/layout.js";
import { corpus } from "../../test/helpers/corpus.js";
import { checkLayout } from "../../test/invariants.js";
import { layoutViewGrid } from "./layout.js";
import { measureLayout, type Metrics } from "./metrics.js";
import { randomDiagram } from "./random.js";
import { gain, penalty, verdict, WEIGHTS, type Weights } from "./score.js";

const here = dirname(fileURLToPath(import.meta.url));
const folder = (name: string) => readdirSync(join(here, name)).filter((f) => f.endsWith(".squinch")).sort()
  .map((f) => ({ name: f.replace(".squinch", ""), src: readFileSync(join(here, name, f), "utf8") }));

describe("score", () => {
  const m = (over: Partial<Metrics>): Metrics => ({ area: 0, width: 0, height: 0, wire: 0, bends: 0, crossings: 0, overlaps: 0, throughNode: 0, throughFrame: 0, kinks: 0, unstraight: 0, nearMiss: 0, lopsided: 0, offCentre: 0, ...over });
  it("ranks what a reviewer would: illegal over crossed over bent over long", () => {
    expect(penalty(m({}), 1)).toBeGreaterThan(penalty(m({ crossings: 5 }), 0));
    expect(penalty(m({ crossings: 1 }), 0)).toBeGreaterThan(penalty(m({ bends: 9 }), 0));
    expect(penalty(m({ bends: 1 }), 0)).toBeGreaterThan(penalty(m({ wire: 150 }), 0));
  });
  it("calls five percent either way the same", () => {
    expect([gain(100, 96), gain(100, 80), gain(80, 100)].map(verdict)).toEqual(["same", "better", "worse"]);
    expect(gain(100, 50)).toBe(-gain(50, 100));
    expect(gain(0.4, 1.2)).toBe(0); // under two points apart is level
  });
});

it("grid vs ELK, view by view", async () => {
  const sets = [
    { set: "corpus", sources: corpus().map((f) => ({ name: f.name, src: f.src })), auto: true },
    { set: "trial", sources: folder("trial"), auto: false },
    { set: "round 2", sources: folder("round2"), auto: false },
    { set: "random", sources: Array.from({ length: 80 }, (_, i) => ({ name: `random-${i}`, src: randomDiagram(i) })), auto: false },
  ];
  interface Row { set: string; view: string; elk: Metrics; grid: Metrics; elkIllegal: number; gridIllegal: number }
  const rows: Row[] = [];
  for (const { set, sources, auto } of sets)
    for (const { name, src } of sources) {
      const built = buildProject([{ name, src }]);
      if (built.diagnostics.some((d) => d.severity === "error")) continue;
      const ctx = {
        zoneMembers: new Map(built.model.zones.map((z) => [z.id, z.members])),
        channelTargets: new Set(built.model.views.flatMap((v) => v.layout.channels.map((c) => c.target))),
      };
      for (const view of built.model.views.filter((v) => auto || !v.auto)) {
        const elk = await layoutView(built.model, view);
        const grid = layoutViewGrid(built.model, view);
        // the new engine is held to the stricter rule: no wire through any box
        const strict = { ...grid.positioned, edges: grid.positioned.edges.map((e) => ({ ...e, coplanar: true as const })) };
        const trunks = new Set([...ctx.channelTargets, ...grid.positioned.edges.filter((e) => e.via === "bus").map((e) => e.to)]);
        rows.push({
          set, view: `${name}#${view.name}`,
          elk: measureLayout(elk.positioned), grid: measureLayout(grid.positioned),
          elkIllegal: checkLayout(elk.positioned, ctx).length,
          gridIllegal: checkLayout(strict, { ...ctx, channelTargets: trunks }).length + grid.skipped.length,
        });
      }
    }

  const tally = (list: Row[], w: Weights = WEIGHTS) => {
    const gains = list.map((r) => gain(penalty(r.elk, r.elkIllegal, w), penalty(r.grid, r.gridIllegal, w)));
    const count = (v: string) => gains.filter((g) => verdict(g) === v).length;
    const sum = (f: (r: Row) => number) => list.reduce((a, r) => a + f(r), 0);
    return {
      views: list.length, better: count("better"), same: count("same"), worse: count("worse"),
      mean: gains.reduce((a, g) => a + g, 0) / (gains.length || 1),
      total: gain(sum((r) => penalty(r.elk, r.elkIllegal, w)), sum((r) => penalty(r.grid, r.gridIllegal, w))),
    };
  };
  const pct = (x: number) => `${x >= 0 ? "+" : ""}${Math.round(x * 100)}%`;
  const line = (label: string, t: ReturnType<typeof tally>) =>
    `${label.padEnd(22)} ${String(t.views).padStart(4)} views   better ${String(t.better).padStart(3)}   same ${String(t.same).padStart(3)}   worse ${String(t.worse).padStart(3)}   mean gain ${pct(t.mean).padStart(5)}   total penalty ${pct(-t.total).padStart(5)}`;
  console.log("\nIs the view better on the new engine? (penalty, lower is better; ±5% is the same)\n");
  for (const set of ["corpus", "trial", "round 2", "random"]) console.log(line(set, tally(rows.filter((r) => r.set === set))));
  console.log(line("everything", tally(rows)));
  console.log(line("  explicit views only", tally(rows.filter((r) => !r.view.includes("#auto") && r.set !== "random"))));

  console.log("\nDoes the verdict depend on the weights?\n");
  for (const key of Object.keys(WEIGHTS) as (keyof Weights)[])
    for (const f of WEIGHTS[key] ? [0.5, 2] : []) console.log(line(`${key} ×${f}`, tally(rows, { ...WEIGHTS, [key]: WEIGHTS[key] * f })));
  console.log(line("centring not counted", tally(rows, { ...WEIGHTS, lopsided: 0 })));
  console.log(line("canvas size counted", tally(rows, { ...WEIGHTS, area: 1 / 40_000 })));

  const scored = rows.map((r) => ({ r, pe: penalty(r.elk, r.elkIllegal), pg: penalty(r.grid, r.gridIllegal) })).map((x) => ({ ...x, g: gain(x.pe, x.pg) }));
  const show = (x: (typeof scored)[number]) =>
    `  ${pct(x.g).padStart(5)}  ${x.r.view.padEnd(44)} ELK ${x.pe.toFixed(0).padStart(4)} grid ${x.pg.toFixed(0).padStart(4)}   cross ${x.r.elk.crossings}/${x.r.grid.crossings} bends ${x.r.elk.bends}/${x.r.grid.bends} kinks ${x.r.elk.kinks}/${x.r.grid.kinks} lopsided ${x.r.elk.lopsided}/${x.r.grid.lopsided} illegal ${x.r.elkIllegal}/${x.r.gridIllegal} ${x.r.elk.width}×${x.r.elk.height} → ${x.r.grid.width}×${x.r.grid.height}`;
  // what the lost views lose on: each term's share of the penalty they gave away
  const terms: [string, (m: Metrics, illegal: number) => number][] = [
    ["illegal", (m, i) => WEIGHTS.illegal * (i + m.throughNode)], ["crossings", (m) => WEIGHTS.crossings * m.crossings],
    ["kinks", (m) => WEIGHTS.kinks * m.kinks], ["nearMiss", (m) => WEIGHTS.nearMiss * m.nearMiss], ["lopsided", (m) => WEIGHTS.lopsided * m.lopsided], ["unstraight", (m) => WEIGHTS.unstraight * m.unstraight], ["offCentre", (m) => WEIGHTS.offCentre * m.offCentre],
    ["bends", (m) => WEIGHTS.bends * m.bends], ["wire", (m) => WEIGHTS.wire * m.wire], ["area", (m) => WEIGHTS.area * m.area],
  ];
  for (const [label, pick] of [["lost", "worse"], ["won", "better"]] as const) {
    const list = scored.filter((x) => verdict(x.g) === pick);
    console.log(`\nIn the ${list.length} views ${label}, penalty by term (ELK → grid):\n` + terms.map(([name, f]) => {
      const e = list.reduce((a, x) => a + f(x.r.elk, x.r.elkIllegal), 0), g = list.reduce((a, x) => a + f(x.r.grid, x.r.gridIllegal), 0);
      return `  ${name.padEnd(11)} ${e.toFixed(0).padStart(6)} → ${g.toFixed(0).padStart(6)}   ${(g - e >= 0 ? "+" : "") + (g - e).toFixed(0)}`;
    }).join("\n"));
  }
  console.log("\nTotals, everything but the random set (ELK → grid):\n" + (["crossings", "kinks", "nearMiss", "lopsided", "unstraight", "offCentre", "bends", "wire"] as const).map((k) => {
    const list = rows.filter((r) => r.set !== "random");
    const e = list.reduce((a, r) => a + r.elk[k], 0), g = list.reduce((a, r) => a + r.grid[k], 0);
    return `  ${k.padEnd(11)} ${String(e).padStart(7)} → ${String(g).padStart(7)}   ×${(g / (e || 1)).toFixed(2)}`;
  }).join("\n") + `\n  illegal     ${String(rows.filter((r) => r.set !== "random").reduce((a, r) => a + r.elkIllegal, 0)).padStart(7)} → ${String(rows.filter((r) => r.set !== "random").reduce((a, r) => a + r.gridIllegal, 0)).padStart(7)}`);
  const named = scored.filter((x) => x.r.set !== "random");
  console.log("\nWhere the new engine is furthest behind (ELK/grid):\n" + [...named].sort((a, b) => a.g - b.g).slice(0, 25).map(show).join("\n"));
  console.log("\nWhere it is furthest ahead:\n" + [...named].sort((a, b) => b.g - a.g).slice(0, 15).map(show).join("\n"));
  console.log("\nRandom diagrams with the most crossings to make up:\n" + scored.filter((x) => x.r.set === "random")
    .sort((a, b) => (b.r.grid.crossings - b.r.elk.crossings) - (a.r.grid.crossings - a.r.elk.crossings)).slice(0, 10).map(show).join("\n"));
  console.log("\nRound 2, every view:\n" + scored.filter((x) => x.r.set === "round 2").map(show).join("\n"));

  expect(rows.reduce((a, r) => a + r.gridIllegal, 0)).toBe(0);
}, 900_000);
