// Before and after: the two earlier spike engines (`../grid`, `../loom`) and
// this one, drawing every view of every set, scored the same way. Run by hand:
//   BEFORE_AFTER=1 npx vitest run spike/braid/before-after.test.ts --disable-console-intercept
//   ONLY=corpus|trial|round2|random  NR=<how many random diagrams>  AGAINST=grid|loom (default: both)
import { it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { buildProject } from "../../src/index.js";
import { corpus } from "../../test/helpers/corpus.js";
import { checkLayout } from "../../test/invariants.js";
import { layoutViewGrid } from "../grid/layout.js";
import { measureLayout, type Metrics } from "../grid/metrics.js";
import { randomDiagram } from "../grid/random.js";
import { penalty, gain, verdict } from "../grid/score.js";
import { solve as loom } from "../loom/engine.js";
import { solve as braid } from "./engine.js";

const ONLY = process.env.ONLY, AGAINST = process.env.AGAINST;
it.skipIf(!process.env.BEFORE_AFTER)("this engine against the two before it", () => {
  const dir = (d: string) => readdirSync("spike/grid/" + d).filter((f) => f.endsWith(".squinch")).sort().map((f) => ({ name: f, src: readFileSync(`spike/grid/${d}/${f}`, "utf8") }));
  const sets = [["corpus", corpus().map((f) => ({ name: f.name, src: f.src }))], ["trial", dir("trial")], ["round2", dir("round2")], ["random", Array.from({ length: +(process.env.NR ?? 80) }, (_, i) => ({ name: `random-${i}`, src: randomDiagram(i) }))]] as const;
  const others = (["grid", "loom"] as const).filter((e) => !AGAINST || e === AGAINST);
  const keys = ["crossings", "bends", "kinks", "nearMiss", "lopsided", "offCentre", "unstraight"] as const;
  for (const [set, sources] of sets) {
    if (ONLY && set !== ONLY) continue;
    const zero = () => Object.fromEntries(keys.map((k) => [k, 0])) as Record<(typeof keys)[number], number>;
    const tot = { grid: zero(), loom: zero(), braid: zero() }, ms = { grid: 0, loom: 0, braid: 0 };
    const tally = { grid: { better: 0, same: 0, worse: 0, worst: [] as string[] }, loom: { better: 0, same: 0, worse: 0, worst: [] as string[] } };
    let bad = 0, views = 0;
    for (const { name, src } of sources) {
      const b = buildProject([{ name, src }]);
      if (b.diagnostics.some((d) => d.severity === "error")) continue;
      for (const v of b.model.views.filter((x) => set === "corpus" || !x.auto)) {
        const draw = (engine: "grid" | "loom" | "braid") => {
          const t = performance.now();
          const out = layoutViewGrid(b.model, v, undefined, engine === "grid" ? undefined : engine === "loom" ? loom : braid);
          ms[engine] += performance.now() - t;
          return out;
        };
        let mine;
        try { mine = draw("braid"); } catch (e) { console.log("CRASH", name, v.name, String(e).slice(0, 120)); bad++; continue; }
        views++;
        const strict = { ...mine.positioned, edges: mine.positioned.edges.map((e) => ({ ...e, coplanar: true as const })) };
        const trunks = new Set(mine.positioned.edges.filter((e) => e.via === "bus").map((e) => e.to));
        const ill = checkLayout(strict, { zoneMembers: new Map(b.model.zones.map((z) => [z.id, z.members])), channelTargets: new Set([...b.model.views.flatMap((x) => x.layout.channels.map((c) => c.target)), ...trunks]) });
        if (ill.length) { bad++; if (bad < 6) console.log("ILLEGAL", name, v.name, ill[0]); }
        const mm = measureLayout(mine.positioned);
        for (const k of keys) tot.braid[k] += mm[k];
        for (const other of others) {
          const mo: Metrics = measureLayout(draw(other).positioned);
          for (const k of keys) tot[other][k] += mo[k];
          const gn = gain(penalty(mo, 0), penalty(mm, ill.length)), vd = verdict(gn);
          tally[other][vd]++;
          if (vd === "worse") tally[other].worst.push(`${Math.round(gn * 100)}% ${name.replace(/^.*\//, "")}#${v.name} cross ${mo.crossings}/${mm.crossings} bends ${mo.bends}/${mm.bends} kinks ${mo.kinks}/${mm.kinks} lop ${mo.lopsided}/${mm.lopsided} unst ${mo.unstraight}/${mm.unstraight}`);
        }
      }
    }
    console.log(`\n${set}: ${views} views · illegal/crash ${bad} · braid ${Math.round(ms.braid)}ms${others.map((o) => ` · ${o} ${Math.round(ms[o])}ms`).join("")}`);
    console.log(`   braid  ${keys.map((k) => `${k} ${tot.braid[k]}`).join("  ")}`);
    for (const other of others) {
      const t = tally[other];
      console.log(`   ${other.padEnd(6)} ${keys.map((k) => `${k} ${tot[other][k]}`).join("  ")}`);
      console.log(`   against ${other}: better ${t.better} · same ${t.same} · worse ${t.worse}`);
      console.log(t.worst.sort((a, b) => parseInt(a) - parseInt(b)).slice(0, +(process.env.WORST ?? 8)).map((w) => "      " + w).join("\n"));
    }
  }
}, 1_800_000);
