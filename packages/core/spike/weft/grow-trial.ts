// The growing-leaves experiment (`grow.ts`), measured: every view of every
// set by the engine as it is and with each way of growing, scored alike.
//   npx tsx spike/weft/grow-trial.ts [corpus|trial|round2|random] [NR=<n>]
import "../../src/packs/node-fs.js";
import { readdirSync, readFileSync } from "node:fs";
import { buildProject } from "../../src/index.js";
import { corpus } from "../../test/helpers/corpus.js";
import { checkLayout } from "../../test/invariants.js";
import { layoutViewGrid } from "../grid/layout.js";
import { measureLayout } from "../grid/metrics.js";
import { randomDiagram } from "../grid/random.js";
import { gain, penalty, verdict } from "../grid/score.js";
import { solve } from "./engine.js";
import { grown } from "./grow.js";

const only = process.argv[2];
const variants = {
  even: grown(solve, { even: true }),
  span: grown(solve, { span: true }),
  both: grown(solve, { even: true, span: true }),
};
const keys = ["crossings", "bends", "kinks", "nearMiss", "lopsided", "offCentre", "unstraight"] as const;
const dir = (d: string) => readdirSync("spike/grid/" + d).filter((f) => f.endsWith(".squinch")).sort().map((f) => ({ name: f, src: readFileSync(`spike/grid/${d}/${f}`, "utf8") }));
const sets = [
  ["corpus", corpus().map((f) => ({ name: f.name, src: f.src }))],
  ["trial", dir("trial")], ["round2", dir("round2")],
  ["random", Array.from({ length: +(process.env.NR ?? 80) }, (_, i) => ({ name: `random-${i}`, src: randomDiagram(i) }))],
] as const;

for (const [set, sources] of sets) {
  if (only && set !== only) continue;
  const names = ["weft", ...Object.keys(variants)];
  const tot = Object.fromEntries(names.map((n) => [n, Object.fromEntries([...keys, "illegal", "area"].map((k) => [k, 0]))]));
  const tally = Object.fromEntries(Object.keys(variants).map((n) => [n, { better: 0, same: 0, worse: 0, list: [] as string[] }]));
  for (const { name, src } of sources) {
    const b = buildProject([{ name, src }]);
    if (b.diagnostics.some((d) => d.severity === "error")) continue;
    for (const v of b.model.views.filter((x) => set === "corpus" || !x.auto)) {
      const draw = (n: string, solver: typeof solve) => {
        const out = layoutViewGrid(b.model, v, undefined, solver);
        const strict = { ...out.positioned, edges: out.positioned.edges.map((e) => ({ ...e, coplanar: true as const })) };
        const trunks = new Set(out.positioned.edges.filter((e) => e.via === "bus").map((e) => e.to));
        const ill = checkLayout(strict, { zoneMembers: new Map(b.model.zones.map((z) => [z.id, z.members])), channelTargets: new Set([...b.model.views.flatMap((x) => x.layout.channels.map((c) => c.target)), ...trunks]) }).length;
        const m = measureLayout(out.positioned);
        for (const k of keys) tot[n][k] += m[k];
        tot[n].illegal += ill; tot[n].area += (m.width * m.height) / 1e6;
        return { m, p: penalty(m, ill) };
      };
      const base = draw("weft", solve);
      for (const [n, solver] of Object.entries(variants)) {
        const mine = draw(n, solver), g = gain(base.p, mine.p), vd = verdict(g), t = tally[n];
        t[vd]++;
        if (vd !== "same") t.list.push(`${Math.round(g * 100)}% ${name.replace(/^.*\//, "")}#${v.name} bends ${base.m.bends}/${mine.m.bends} lop ${base.m.lopsided}/${mine.m.lopsided} cross ${base.m.crossings}/${mine.m.crossings}`);
      }
    }
  }
  console.log(`\n${set}\n  ${"".padEnd(6)}${[...keys, "illegal", "area"].map((k) => k.padStart(11)).join("")}`);
  for (const n of names) console.log(`  ${n.padEnd(6)}${[...keys, "illegal", "area"].map((k) => String(Math.round(tot[n][k])).padStart(11)).join("")}`);
  for (const [n, t] of Object.entries(tally)) {
    console.log(`  ${n} against weft as it is: better ${t.better} · same ${t.same} · worse ${t.worse}`);
    const sorted = t.list.sort((a, b) => parseInt(a) - parseInt(b));
    console.log([...sorted.slice(0, 4), "     …", ...sorted.slice(-4)].map((w) => "     " + w).join("\n"));
  }
}
