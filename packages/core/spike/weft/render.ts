// A look at the pictures: one view drawn by ELK and by this engine,
// side by side, as plain boxes and lines. Not the product's renderer — just
// enough to judge a layout by eye.
//
//   npx tsx spike/weft/render.ts <out-dir> <spec>…
//
// A spec is `path/to/file.squinch#view` (or `#*` for every explicit view),
// `random:<seed>`, or `right:<spec>` to turn the view to flow rightward.
// Writes `<out-dir>/<name>.html` and, where Playwright is installed, a PNG
// beside it. ENGINES=elk,weft picks the columns.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildProject } from "../../src/index.js";
import { layoutView, type Positioned } from "../../src/layout/layout.js";
import { checkLayout } from "../../test/invariants.js";
import { layoutViewWeft } from "./layout.js";
import { measureLayout } from "./metrics.js";
import { randomDiagram } from "./random.js";

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");

export function svg(p: Positioned): string {
  const out: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${p.width}" height="${p.height}" viewBox="0 0 ${p.width} ${p.height}" font-family="sans-serif" font-size="11">`,
    `<defs><marker id="a" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" fill="#345"/></marker></defs>`,
    `<rect width="100%" height="100%" fill="#fff"/>`];
  for (const z of [...p.zones].sort((a, b) => a.depth - b.depth)) out.push(`<rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" fill="none" stroke="#9a7" stroke-dasharray="5 3"/><text x="${z.x + 6}" y="${z.y + 12}" fill="#586">${esc(z.label)}</text>`);
  for (const f of [...p.frames].sort((a, b) => a.depth - b.depth)) out.push(`<rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" fill="#f4f6fa" fill-opacity=".6" stroke="#89a"/><text x="${f.x + 10}" y="${f.y + 20}" fill="#345" font-weight="600">${esc(f.label)}</text>`);
  for (const n of p.nodes) out.push(`<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="6" fill="#fff" stroke="#234"/><text x="${n.x + n.w / 2}" y="${n.y + Math.min(n.h, 64) / 2 + 4}" text-anchor="middle">${esc(n.label ?? n.path)}</text>`);
  for (const e of p.edges) out.push(`<polyline points="${e.points.map((q) => `${q.x},${q.y}`).join(" ")}" fill="none" stroke="${e.async ? "#a53" : "#345"}" stroke-width="1.3" marker-end="url(#a)"/>`);
  for (const e of p.edges) if (e.labelRect) out.push(`<rect x="${e.labelRect.x}" y="${e.labelRect.y}" width="${e.labelRect.w}" height="${e.labelRect.h}" rx="9" fill="#ffe" stroke="#cb8"/><text x="${e.labelRect.x + e.labelRect.w / 2}" y="${e.labelRect.y + e.labelRect.h / 2 + 4}" text-anchor="middle" fill="#653">${esc(e.label ?? "")}</text>`);
  return out.join("") + "</svg>";
}

async function main() {
  const [outDir, ...specs] = process.argv.slice(2);
  mkdirSync(outDir, { recursive: true });
  const engines = (process.env.ENGINES ?? "elk,weft").split(",");
  const pages: string[] = [];
  for (let spec of specs) {
    const right = spec.startsWith("right:");
    if (right) spec = spec.slice(6);
    const [file, want] = spec.startsWith("random:") ? [spec, "v"] : spec.split("#");
    const src = spec.startsWith("random:") ? randomDiagram(+spec.slice(7)) : readFileSync(file, "utf8");
    const built = buildProject([{ name: file, src }]);
    const errors = built.diagnostics.filter((d) => d.severity === "error");
    if (errors.length) { console.log(spec, errors[0].message); continue; }
    for (let view of built.model.views.filter((v) => (want === "*" ? !v.auto : v.name === want))) {
      if (right) view = { ...view, layout: { ...view.layout, direction: "right" } };
      const cells: string[] = [];
      for (const name of engines) {
        let p: Positioned, note = "";
        try {
          p = name === "elk" ? (await layoutView(built.model, view)).positioned : layoutViewWeft(built.model, view).positioned;
        } catch (e) { cells.push(`<td><b>${name}</b> crashed: ${esc(String(e))}</td>`); continue; }
        const m = measureLayout(p);
        if (name !== "elk") {
          const bad = checkLayout({ ...p, edges: p.edges.map((e) => ({ ...e, coplanar: true as const })) });
          note = bad.length ? ` · <span style="color:#c00">${bad.length} illegal: ${esc(bad[0])}</span>` : "";
        }
        cells.push(`<td><b>${name}</b> · cross ${m.crossings} · bends ${m.bends} · lopsided ${m.lopsided} · jogs ${m.kinks} · off-centre ${m.offCentre}${note}<br>${svg(p)}</td>`);
      }
      const title = `${file.replace(/^.*\//, "")}#${view.name}${right ? " (rightward)" : ""}`;
      const name = title.replace(/[^\w.-]+/g, "_");
      writeFileSync(join(outDir, `${name}.html`), `<!doctype html><meta charset="utf-8"><body style="font:12px sans-serif;margin:8px"><h3 style="margin:0 0 6px">${esc(title)}</h3><table><tr style="vertical-align:top">${cells.join("")}</tr></table>`);
      pages.push(name);
    }
  }
  // screenshots, where a Playwright that matches its browser can be found
  try {
    const { createRequire } = await import("node:module");
    const { chromium } = createRequire(join(process.cwd(), "x.js"))(process.env.PLAYWRIGHT ?? "playwright") as typeof import("@playwright/test");
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    for (const name of pages) {
      await page.goto(`file://${join(outDir, `${name}.html`)}`);
      await page.screenshot({ path: join(outDir, `${name}.png`), fullPage: true });
      console.log(join(outDir, `${name}.png`));
    }
    await browser.close();
  } catch (e) { console.log(`wrote ${pages.length} page(s) to ${outDir}; no screenshots: ${String(e).slice(0, 100)}`); }
}
main();
