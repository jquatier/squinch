// Draw one view with both engines, side by side, for looking at.
//   npx tsx spike/grid/render-pair.ts <file.squinch> [view] <out.html>
import "../../src/packs/node-fs.js";
import { readFileSync, writeFileSync } from "node:fs";
import { buildProject, renderSVG, themes } from "../../src/index.js";
import { layoutView } from "../../src/layout/layout.js";
import { layoutViewGrid } from "./layout.js";
import { measureLayout } from "./metrics.js";

const [file, ...rest] = process.argv.slice(2);
const out = rest.pop()!;
const built = buildProject([{ name: file, src: readFileSync(file, "utf8") }]);
const views = rest.length ? built.model.views.filter((v) => rest.includes(v.name)) : built.model.views;
const fmt = (m: ReturnType<typeof measureLayout>) => `${m.width}×${m.height} · bends ${m.bends} · crossings ${m.crossings} · kinks ${m.kinks}`;
let html = `<body style="background:#fff;font:13px sans-serif;margin:16px">`;
for (const view of views) {
  const elk = (await layoutView(built.model, view)).positioned;
  const grid = layoutViewGrid(built.model, view).positioned;
  const draw = (p: typeof elk) => renderSVG(p, themes.light, { embedFonts: false });
  html += `<h3>${view.name}</h3><div style="display:flex;gap:24px;align-items:flex-start">` +
    `<div><div>ELK — ${fmt(measureLayout(elk))}</div>${draw(elk)}</div>` +
    `<div><div>grid — ${fmt(measureLayout(grid))}</div>${draw(grid)}</div></div>`;
}
writeFileSync(out, html);
