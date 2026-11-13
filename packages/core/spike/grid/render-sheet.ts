// Many views on one page, grid engine only, for looking at a lot at once.
//   npx tsx spike/grid/render-sheet.ts out.html file.squinch[:view] …
import "../../src/packs/node-fs.js";
import { readFileSync, writeFileSync } from "node:fs";
import { buildProject, renderSVG, themes } from "../../src/index.js";
import { layoutViewGrid } from "./layout.js";

const [out, ...specs] = process.argv.slice(2);
let html = `<body style="background:#fff;font:12px sans-serif;margin:12px;display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start">`;
for (const spec of specs) {
  const [file, only] = spec.split(":");
  const built = buildProject([{ name: file, src: readFileSync(file, "utf8") }]);
  for (const view of built.model.views.filter((v) => (only ? v.name === only : !v.auto))) {
    const p = layoutViewGrid(built.model, view).positioned;
    html += `<div><div>${file.replace(/^.*\//, "").replace(".squinch", "")} · ${view.name}</div><div style="zoom:0.6">${renderSVG(p, themes.light, { embedFonts: false })}</div></div>`;
  }
}
writeFileSync(out, html);
