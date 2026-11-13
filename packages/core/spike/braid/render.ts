// One view four ways, side by side, for looking at: ELK, the two earlier
// spike engines, and this one.
//   npx tsx spike/braid/render.ts <out.html> <file.squinch | random-N>[:view][=Title] …
//   ONLY=braid,loom to draw fewer; TURN=1 to turn every view to flow rightward
import "../../src/packs/node-fs.js";
import { readFileSync, writeFileSync } from "node:fs";
import { buildProject, renderSVG, themes } from "../../src/index.js";
import { layoutView } from "../../src/layout/layout.js";
import { layoutViewGrid } from "../grid/layout.js";
import { measureLayout } from "../grid/metrics.js";
import { randomDiagram } from "../grid/random.js";
import { solve as loom } from "../loom/engine.js";
import { layoutViewBraid } from "./layout.js";

const [out, ...specs] = process.argv.slice(2);
const only = process.env.ONLY?.split(",");
const says = (m: ReturnType<typeof measureLayout>) => `${m.crossings} crossing${m.crossings === 1 ? "" : "s"} · ${m.bends} bends · ${m.kinks} kinks · ${m.lopsided} lopsided · ${m.width}×${m.height}`;
let html = `<body style="background:#fff;font:13px sans-serif;margin:16px">`;
for (const spec of specs) {
  const [target, title] = spec.split("=");
  const [file, pick] = target.split(":");
  const src = file.startsWith("random-") ? randomDiagram(+file.slice(7)) : readFileSync(file, "utf8");
  const built = buildProject([{ name: file, src }]);
  for (let view of built.model.views.filter((v) => (pick ? v.name === pick : !v.auto))) {
    if (process.env.TURN) view = { ...view, layout: { ...view.layout, direction: "right" } };
    const engines: [string, () => Promise<ReturnType<typeof layoutViewBraid>["positioned"]>][] = [
      ["elk", async () => (await layoutView(built.model, view)).positioned],
      ["grid", async () => layoutViewGrid(built.model, view).positioned],
      ["loom", async () => layoutViewGrid(built.model, view, undefined, loom).positioned],
      ["braid", async () => layoutViewBraid(built.model, view).positioned],
    ];
    html += `<h3 style="font-size:20px">${title ?? `${file.replace(/^.*\//, "").replace(".squinch", "")} · ${view.name}`}</h3><div style="display:flex;gap:24px;align-items:flex-start">`;
    for (const [name, draw] of engines) {
      if (only && !only.includes(name)) continue;
      const p = await draw();
      html += `<div><div><b>${name.toUpperCase()}</b> — ${says(measureLayout(p))}</div>${renderSVG(p, themes.light, { embedFonts: false })}</div>`;
    }
    html += `</div>`;
  }
}
writeFileSync(out, html);
