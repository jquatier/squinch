// Before and after: every view of every set drawn by this engine and by the
// three spike engines before it (`../grid`, `../loom`, `../braid` — black
// boxes here), scored by the same function. Run by hand:
//   BEFORE_AFTER=1 npx vitest run spike/weft/before-after.test.ts --disable-console-intercept
//   ONLY=corpus|trial|round2|random   NR=<how many random diagrams>
//   VS=grid,loom,braid (which to compare against; grid and loom take minutes on the random set)
import { it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { buildProject } from "../../src/index.js";
import { corpus } from "../../test/helpers/corpus.js";
import { checkLayout } from "../../test/invariants.js";
import { layoutViewGrid } from "../grid/layout.js";
import { measureLayout, type Metrics } from "../grid/metrics.js";
import { randomDiagram } from "../grid/random.js";
import { penalty, gain, verdict } from "../grid/score.js";
import { solve as grid } from "../grid/engine.js";
import { solve as loom } from "../loom/engine.js";
import { solve as braid } from "../braid/engine.js";
import { solve as weft } from "./engine.js";
import { plan } from "../grid/problem.js";
import type { Positioned } from "../../src/layout/layout.js";

/** REQUIREMENTS §3.5, which `checkLayout` does not hold anyone to: how many
 *  pairs of wires that are not one bundle run along the same line. */
function stacked(p: Positioned, bundle: Map<string, string | undefined>): number {
  const segs = p.edges.flatMap((e) => e.points.slice(1).map((b, i) => {
    const a = e.points[i];
    return { id: e.id, flat: a.y === b.y, at: a.y === b.y ? a.y : a.x, lo: Math.min(a.x + a.y, b.x + b.y) - (a.y === b.y ? a.y : a.x), hi: Math.max(a.x + a.y, b.x + b.y) - (a.y === b.y ? a.y : a.x) };
  }));
  const pairs = new Set<string>();
  for (let i = 0; i < segs.length; i++)
    for (let j = i + 1; j < segs.length; j++) {
      const s = segs[i], t = segs[j];
      if (s.id === t.id || s.flat !== t.flat || s.at !== t.at || s.lo >= t.hi || t.lo >= s.hi) continue;
      if (bundle.get(s.id) && bundle.get(s.id) === bundle.get(t.id)) continue;
      pairs.add(s.id < t.id ? `${s.id}|${t.id}` : `${t.id}|${s.id}`);
    }
  return pairs.size;
}

const ONLY = process.env.ONLY;
const others = { grid, loom, braid } as Record<string, typeof weft>;
const VS = (process.env.VS ?? "grid,loom,braid").split(",").filter((n) => n in others);
const keys = ["crossings", "bends", "kinks", "nearMiss", "lopsided", "offCentre", "unstraight", "overlaps"] as const;

it.skipIf(!process.env.BEFORE_AFTER)("this engine against the three before it", () => {
  const dir = (d: string) => readdirSync("spike/grid/" + d).filter((f) => f.endsWith(".squinch")).sort().map((f) => ({ name: f, src: readFileSync(`spike/grid/${d}/${f}`, "utf8") }));
  const sets = [["corpus", corpus().map((f) => ({ name: f.name, src: f.src }))], ["trial", dir("trial")], ["round2", dir("round2")], ["random", Array.from({ length: +(process.env.NR ?? 80) }, (_, i) => ({ name: `random-${i}`, src: randomDiagram(i) }))]] as const;
  let illegal = 0;
  for (const [set, sources] of sets) {
    if (ONLY && set !== ONLY) continue;
    const names = ["weft", ...VS];
    const tot = Object.fromEntries(names.map((n) => [n, Object.fromEntries(keys.map((k) => [k, 0]))])) as Record<string, Record<string, number>>;
    const ms = Object.fromEntries(names.map((n) => [n, 0])) as Record<string, number>;
    const tally = Object.fromEntries(VS.map((n) => [n, { better: 0, same: 0, worse: 0, worst: [] as string[] }]));
    let views = 0, bad = 0;
    for (const { name, src } of sources) {
      const b = buildProject([{ name, src }]);
      if (b.diagnostics.some((d) => d.severity === "error")) continue;
      for (const v of b.model.views.filter((x) => set === "corpus" || !x.auto)) {
        const run = (n: string, solver: typeof weft) => { const t = performance.now(); const out = layoutViewGrid(b.model, v, undefined, solver); ms[n] += performance.now() - t; return out; };
        let mine;
        try { mine = run("weft", weft); } catch (e) { console.log("CRASH", name, v.name, String((e as Error).stack).slice(0, 300)); bad++; continue; }
        views++;
        const strict = { ...mine.positioned, edges: mine.positioned.edges.map((e) => ({ ...e, coplanar: true as const })) };
        const trunks = new Set(mine.positioned.edges.filter((e) => e.via === "bus").map((e) => e.to));
        const ill = [
          ...checkLayout(strict, { zoneMembers: new Map(b.model.zones.map((z) => [z.id, z.members])), channelTargets: new Set([...b.model.views.flatMap((x) => x.layout.channels.map((c) => c.target)), ...trunks]) }),
          ...mine.skipped.map((w) => `wire ${w} not drawn`),
        ];
        const bundles = new Map(plan(b.model, v, { metrics: "inter", scale: 1 }).problem.wires.map((w) => [w.id, w.bundle]));
        const lying = stacked(mine.positioned, bundles);
        if (lying) ill.push(`${lying} pair(s) of wires drawn along one line`);
        if (ill.length) { bad++; if (bad < 12) console.log("ILLEGAL", name, v.name, ill.length, ill[0]); }
        const m: Record<string, Metrics> = { weft: measureLayout(mine.positioned) };
        const pw = penalty(m.weft, ill.length);
        for (const n of VS) {
          m[n] = measureLayout(run(n, others[n]).positioned);
          const g = gain(penalty(m[n], 0), pw), vd = verdict(g), t = tally[n];
          if (vd === "better") t.better++; else if (vd === "same") t.same++;
          else { t.worse++; t.worst.push(`${Math.round(g * 100)}% ${name.replace(/^.*\//, "")}#${v.name} cross ${m[n].crossings}/${m.weft.crossings} bends ${m[n].bends}/${m.weft.bends} lop ${m[n].lopsided}/${m.weft.lopsided} kinks ${m[n].kinks}/${m.weft.kinks}`); }
        }
        for (const n of names) for (const k of keys) tot[n][k] += m[n][k];
      }
    }
    illegal += bad;
    console.log(`\n${set}: ${views} views · illegal or crashed ${bad}`);
    console.log(`  ${"".padEnd(6)} ${keys.map((k) => k.padStart(10)).join("")}        ms`);
    for (const n of names) console.log(`  ${n.padEnd(6)} ${keys.map((k) => String(tot[n][k]).padStart(10)).join("")}  ${String(Math.round(ms[n])).padStart(8)}`);
    for (const n of VS) {
      const t = tally[n];
      console.log(`  against ${n}: better ${t.better} · same ${t.same} · worse ${t.worse}`);
      console.log(t.worst.sort((a, b) => parseInt(a) - parseInt(b)).slice(0, +(process.env.WORST ?? 6)).map((w) => "     " + w).join("\n"));
    }
  }
  expect(illegal).toBe(0);
}, 1_800_000);
