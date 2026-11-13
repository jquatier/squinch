import { it } from "vitest";
const ONLY = process.env.ONLY;
import { readdirSync, readFileSync } from "node:fs";
import { buildProject } from "../../src/index.js";
import { corpus } from "../../test/helpers/corpus.js";
import { checkLayout } from "../../test/invariants.js";
import { layoutViewGrid } from "../grid/layout.js";
import { measureLayout } from "../grid/metrics.js";
import { randomDiagram } from "../grid/random.js";
import { penalty, gain, verdict } from "../grid/score.js";
import { solve as loom } from "./engine.js";
it("loom vs grid", () => {
  const dir = (d: string) => readdirSync("spike/grid/" + d).filter((f) => f.endsWith(".squinch")).sort().map((f) => ({ name: f, src: readFileSync(`spike/grid/${d}/${f}`, "utf8") }));
  const sets = [["corpus", corpus().map((f) => ({ name: f.name, src: f.src }))], ["trial", dir("trial")], ["round2", dir("round2")], ["random", Array.from({ length: +(process.env.NR ?? 80) }, (_, i) => ({ name: `random-${i}`, src: randomDiagram(i) }))]] as const;
  for (const [set, sources] of sets) {
    if (ONLY && set !== ONLY) continue;
    const keys = ["crossings", "bends", "kinks", "nearMiss", "lopsided", "offCentre"] as const;
    const tot = { grid: {} as any, loom: {} as any }; for (const k of keys) { tot.grid[k] = 0; tot.loom[k] = 0; }
    let better = 0, same = 0, worse = 0, bad = 0, views = 0, tg = 0, tl = 0; const worst: string[] = [];
    for (const { name, src } of sources) {
      const b = buildProject([{ name, src }]);
      if (b.diagnostics.some((d) => d.severity === "error")) continue;
      for (const v of b.model.views.filter((x) => set === "corpus" || !x.auto)) {
        let t = performance.now(); const g = layoutViewGrid(b.model, v); tg += performance.now() - t;
        t = performance.now(); let l; try { l = layoutViewGrid(b.model, v, undefined, loom); } catch (e) { console.log("CRASH", name, v.name, String(e).slice(0, 120)); bad++; continue; } tl += performance.now() - t;
        views++;
        const strict = { ...l.positioned, edges: l.positioned.edges.map((e) => ({ ...e, coplanar: true as const })) };
        const trunks = new Set(l.positioned.edges.filter((e) => e.via === "bus").map((e) => e.to));
        const ill = checkLayout(strict, { zoneMembers: new Map(b.model.zones.map((z) => [z.id, z.members])), channelTargets: new Set([...b.model.views.flatMap((x) => x.layout.channels.map((c) => c.target)), ...trunks]) });
        if (ill.length) { bad++; if (bad < 6) console.log("ILLEGAL", name, v.name, ill[0]); }
        const mg = measureLayout(g.positioned), ml = measureLayout(l.positioned);
        for (const k of keys) { tot.grid[k] += mg[k]; tot.loom[k] += ml[k]; }
        const gn = gain(penalty(mg, 0), penalty(ml, ill.length)); const vd = verdict(gn);
        if (vd === "better") better++; else if (vd === "worse") { worse++; worst.push(`${Math.round(gn * 100)}% ${name.replace(/^.*\//, "")}#${v.name} cross ${mg.crossings}/${ml.crossings} bends ${mg.bends}/${ml.bends} lop ${mg.lopsided}/${ml.lopsided}`); } else same++;
      }
    }
    console.log(`${set}: ${views} views · loom better ${better} same ${same} worse ${worse} · illegal/crash ${bad} · grid ${Math.round(tg)}ms loom ${Math.round(tl)}ms`);
    console.log("   " + keys.map((k) => `${k} ${tot.grid[k]}→${tot.loom[k]}`).join("  "));
    console.log(worst.sort((a, b) => parseInt(a) - parseInt(b)).slice(0, 6).map((w) => "   " + w).join("\n"));
  }
}, 900_000);
