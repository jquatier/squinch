import "../../src/packs/node-fs.js";
import { readFileSync } from "node:fs";
import { buildProject } from "../../src/index.js";
import { layoutViewGrid } from "../grid/layout.js";
import { measureLayout } from "../grid/metrics.js";
import { solve } from "./engine.js";
for (const file of process.argv.slice(2)) {
  const b = buildProject([{ name: file, src: readFileSync(file, "utf8") }]);
  const v = b.model.views.find((x) => !x.auto)!;
  const t = performance.now();
  const p = layoutViewGrid(b.model, v, undefined, solve).positioned;
  console.log(file.replace(/^.*\//, ""), Math.round(performance.now() - t) + "ms", "crossings", measureLayout(p).crossings);
}
