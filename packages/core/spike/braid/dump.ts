// One view's geometry from this engine, as text, with what both judges say.
//   npx tsx spike/braid/dump.ts <file.squinch | random-N> <view> [right]
import "../../src/packs/node-fs.js";
import { readFileSync } from "node:fs";
import { buildProject } from "../../src/index.js";
import { checkLayout } from "../../test/invariants.js";
import { layoutViewGrid } from "../grid/layout.js";
import { measureLayout } from "../grid/metrics.js";
import { plan } from "../grid/problem.js";
import { randomDiagram } from "../grid/random.js";
import { audit } from "./audit.js";
import { solve } from "./engine.js";

const [file, name, turn] = process.argv.slice(2);
const src = file.startsWith("random-") ? randomDiagram(+file.slice(7)) : readFileSync(file, "utf8");
const built = buildProject([{ name: file, src }]);
let view = built.model.views.find((v) => v.name === name)!;
if (turn) view = { ...view, layout: { ...view.layout, direction: "right" } };
const p = layoutViewGrid(built.model, view, undefined, solve).positioned;
console.log(`── ${p.width}×${p.height}`);
for (const z of p.zones) console.log(`zone  ${z.id.padEnd(18)} ${z.x},${z.y} ${z.w}×${z.h}`);
for (const f of p.frames) console.log(`frame ${f.path.padEnd(18)} ${f.x},${f.y} ${f.w}×${f.h}`);
for (const n of p.nodes) console.log(`node  ${n.path.padEnd(18)} ${n.x},${n.y} ${n.w}×${n.h} rank ${n.rank}`);
for (const e of p.edges) console.log(`wire  ${e.id} ${e.from} → ${e.to}: ${e.points.map((q) => `${q.x},${q.y}`).join(" ")}${e.labelRect ? `  label ${e.labelRect.x},${e.labelRect.y} ${e.labelRect.w}×${e.labelRect.h}` : ""}`);
const m = measureLayout(p);
console.log(`crossings ${m.crossings} bends ${m.bends} kinks ${m.kinks} lopsided ${m.lopsided} nearMiss ${m.nearMiss} offCentre ${m.offCentre} unstraight ${m.unstraight}`);
const problem = plan(built.model, view, { metrics: "inter", scale: 1 }).problem;
for (const b of checkLayout({ ...p, edges: p.edges.map((e) => ({ ...e, coplanar: true as const })) })) console.log("[check]", b);
for (const b of audit(problem, solve(problem))) console.log("[audit]", b);
