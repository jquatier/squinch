// One view's geometry from the first spike engine and the rebuilt one, as text.
//   npx tsx spike/loom/dump.ts <file.squinch> <view>
import "../../src/packs/node-fs.js";
import { readFileSync } from "node:fs";
import { buildProject } from "../../src/index.js";
import { layoutViewGrid } from "../grid/layout.js";
import { solve } from "./engine.js";

const [file, name] = process.argv.slice(2);
const built = buildProject([{ name: file, src: readFileSync(file, "utf8") }]);
const view = built.model.views.find((v) => v.name === name)!;
for (const [engine, p] of [["grid", layoutViewGrid(built.model, view).positioned], ["loom", layoutViewGrid(built.model, view, undefined, solve).positioned]] as const) {
  console.log(`── ${engine} ${p.width}×${p.height}`);
  for (const z of p.zones) console.log(`zone  ${z.id.padEnd(18)} ${z.x},${z.y} ${z.w}×${z.h}`);
  for (const f of p.frames) console.log(`frame ${f.path.padEnd(18)} ${f.x},${f.y} ${f.w}×${f.h}`);
  for (const n of p.nodes) console.log(`node  ${n.path.padEnd(18)} ${n.x},${n.y} ${n.w}×${n.h}`);
  for (const e of p.edges) console.log(`wire  ${e.from} → ${e.to}: ${e.points.map((q) => `${q.x},${q.y}`).join(" ")}`);
}
