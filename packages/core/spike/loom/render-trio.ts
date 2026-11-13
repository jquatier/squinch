// One view three ways, side by side, for looking at: ELK, the first spike
// engine, and the loom.
//   npx tsx spike/loom/render-trio.ts <out.html> <file.squinch>[:view][=Title] …
import "../../src/packs/node-fs.js";
import { readFileSync, writeFileSync } from "node:fs";
import { buildProject, renderSVG, themes } from "../../src/index.js";
import { layoutView } from "../../src/layout/layout.js";
import { layoutViewGrid } from "../grid/layout.js";
import { measureLayout } from "../grid/metrics.js";
import { layoutViewLoom } from "./layout.js";

const [out, ...specs] = process.argv.slice(2);
const says = (m: ReturnType<typeof measureLayout>) => `${m.crossings} crossing${m.crossings === 1 ? "" : "s"} · ${m.bends} bends · ${m.width}×${m.height}`;
let html = `<body style="background:#fff;font:13px sans-serif;margin:16px">`;
for (const spec of specs) {
  const [target, title] = spec.split("=");
  const [file, only] = target.split(":");
  const built = buildProject([{ name: file, src: readFileSync(file, "utf8") }]);
  for (const view of built.model.views.filter((v) => (only ? v.name === only : !v.auto))) {
    const drawn = [
      ["OLD (ELK)", (await layoutView(built.model, view)).positioned],
      ["FIRST SPIKE", layoutViewGrid(built.model, view).positioned],
      ["REBUILT", layoutViewLoom(built.model, view).positioned],
    ] as const;
    html += `<h3 style="font-size:20px">${title ?? `${file.replace(/^.*\//, "").replace(".squinch", "")} · ${view.name}`}</h3><div style="display:flex;gap:24px;align-items:flex-start">`
      + drawn.map(([name, p]) => `<div><div><b>${name}</b> — ${says(measureLayout(p))}</div>${renderSVG(p, themes.light, { embedFonts: false })}</div>`).join("") + `</div>`;
  }
}
writeFileSync(out, html);
