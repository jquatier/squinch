// Every set of diagrams through this engine alone, held to both judges
// (`checkLayout`, strict, and this directory's `audit`) and measured.
//   npx tsx spike/braid/sweep.ts [corpus|trial|round2|random|right] [-v] [NR=<n>]
import "../../src/packs/node-fs.js";
import { readdirSync, readFileSync } from "node:fs";
import { buildProject } from "../../src/index.js";
import type { SView } from "../../src/model/types.js";
import { corpus } from "../../test/helpers/corpus.js";
import { checkLayout } from "../../test/invariants.js";
import { layoutViewGrid } from "../grid/layout.js";
import { measureLayout } from "../grid/metrics.js";
import { plan } from "../grid/problem.js";
import { randomDiagram } from "../grid/random.js";
import { penalty } from "../grid/score.js";
import { audit, crowded } from "./audit.js";
import { solve } from "./engine.js";

const args = process.argv.slice(2), verbose = args.includes("-v");
const only = args.find((a) => !a.startsWith("-") && !a.includes("="));
const NR = +(args.find((a) => a.startsWith("NR="))?.slice(3) ?? 80);
const dir = (d: string) => readdirSync("spike/grid/" + d).filter((f) => f.endsWith(".squinch")).sort().map((f) => ({ name: `${d}/${f}`, src: readFileSync(`spike/grid/${d}/${f}`, "utf8") }));
const sets: [string, { name: string; src: string }[], boolean][] = [
  ["corpus", corpus().map((f) => ({ name: f.name, src: f.src })), false],
  ["trial", dir("trial"), false],
  ["round2", dir("round2"), false],
  ["random", Array.from({ length: NR }, (_, i) => ({ name: `random-${i}`, src: randomDiagram(i) })), false],
  ["right", [...corpus().map((f) => ({ name: f.name, src: f.src })), ...dir("trial")], true],
];
const keys = ["crossings", "bends", "kinks", "nearMiss", "lopsided", "offCentre", "unstraight", "overlaps"] as const;
for (const [set, sources, turned] of sets) {
  if (only && set !== only) continue;
  const tot: Record<string, number> = {}; for (const k of keys) tot[k] = 0;
  let views = 0, ms = 0, pen = 0, tight = 0;
  const bad: string[] = [];
  for (const { name, src } of sources) {
    const b = buildProject([{ name, src }]);
    if (b.diagnostics.some((d) => d.severity === "error")) continue;
    for (const original of b.model.views.filter((x) => set === "corpus" || set === "right" || !x.auto)) {
      if (turned && original.layout.direction === "right") continue;
      const v: SView = turned ? { ...original, layout: { ...original.layout, direction: "right" } } : original;
      const tag = `${name.replace(/^.*\//, "")}#${v.name}`;
      const t = performance.now();
      let l;
      try { l = layoutViewGrid(b.model, v, undefined, solve); } catch (e) { bad.push(`${tag} CRASH ${String((e as Error).stack).split("\n").slice(0, 3).join(" | ")}`); continue; }
      ms += performance.now() - t;
      views++;
      const strict = { ...l.positioned, edges: l.positioned.edges.map((e) => ({ ...e, coplanar: true as const })) };
      const trunks = new Set(l.positioned.edges.filter((e) => e.via === "bus").map((e) => e.to));
      const ill = checkLayout(strict, { zoneMembers: new Map(b.model.zones.map((z) => [z.id, z.members])), channelTargets: new Set([...b.model.views.flatMap((x) => x.layout.channels.map((c) => c.target)), ...trunks]) });
      const p = plan(b.model, v, { metrics: "inter", scale: 1 }).problem;
      const sol = solve(p);
      const mine = audit(p, sol);
      tight += crowded(p, sol);
      for (const x of ill) bad.push(`${tag} [check] ${x}`);
      for (const x of mine) bad.push(`${tag} [audit] ${x}`);
      for (const x of l.skipped) bad.push(`${tag} wire ${x} not drawn`);
      const m = measureLayout(l.positioned);
      for (const k of keys) tot[k] += m[k];
      pen += penalty(m, ill.length);
      if (verbose) console.log(`${tag.padEnd(48)} cross ${m.crossings} bends ${m.bends} kinks ${m.kinks} lop ${m.lopsided} near ${m.nearMiss} off ${m.offCentre} unst ${m.unstraight}`);
    }
  }
  console.log(`${set}: ${views} views · ${Math.round(ms)}ms · ${bad.length} violations · penalty ${Math.round(pen)} · crowded walls ${tight}`);
  console.log("   " + keys.map((k) => `${k} ${tot[k]}`).join("  "));
  const kinds = new Map<string, number>();
  for (const x of bad) { const k = x.replace(/^\S+ /, "").replace(/[\w.:>~-]*\d[\w.:>~,-]*/g, "#").slice(0, 60); kinds.set(k, (kinds.get(k) ?? 0) + 1); }
  for (const [k, n] of [...kinds].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`   ${String(n).padStart(4)} × ${k}`);
  for (const x of bad.slice(0, verbose ? 60 : 8)) console.log("   " + x);
}
