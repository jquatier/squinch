// Before/after review gallery for engine changes that move many diagrams.
//
//   npx tsx scripts/gallery.mts baseline        # capture the reference set
//   …change the engine, rebuild core…
//   npx tsx scripts/gallery.mts gate1           # render current + build gallery.html
//
// `baseline` renders every view of every corpus file through packages/core/dist
// to `.compare-tmp/baseline/`. Any other label renders the same set to
// `.compare-tmp/<label>/` and writes `.compare-tmp/<label>/gallery.html`:
// side-by-side rows (baseline | current) for every pair that differs, and a
// one-line count of the pairs that are byte-identical. Open the HTML locally —
// images are referenced relative to `.compare-tmp/`, nothing is copied.
//
// Exhaustive on purpose (it replaced a hand-edited target list): a fixed list
// hides the unexpected mover — the thing DESIGN §9's anti-regression rule
// exists to catch.
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildProject, renderProject } from "../packages/core/dist/index.js";
import { svgToPng } from "../packages/cli/src/raster.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const label = process.argv[2];
if (!label) {
  console.error("usage: tsx scripts/gallery.mts <label>   (baseline | gate1 | …)");
  process.exit(2);
}

const files: string[] = [];
for (const d of ["examples", "lookbook/cases", "packages/core/examples", "gauntlet/solutions"]) {
  const walk = (p: string) => {
    for (const e of readdirSync(p)) {
      const f = join(p, e);
      statSync(f).isDirectory() ? walk(f) : f.endsWith(".squinch") && files.push(f);
    }
  };
  walk(join(root, d));
}

const out = join(root, ".compare-tmp", label);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

interface Cell { key: string; png: Buffer; w: number; h: number }
const cells: Cell[] = [];
for (const f of files) {
  const name = f.split("/").pop()!;
  const src = readFileSync(f, "utf8");
  const built = buildProject([{ name, src }]);
  if (built.diagnostics.some((d) => d.severity === "error")) continue;
  for (const v of built.model.views) {
    const r = await renderProject([{ name, src }], { view: v.name, theme: "light" });
    if (!r.ok) continue;
    const m = /<svg[^>]*width="(\d+)"[^>]*height="(\d+)"/.exec(r.svg!);
    if (!m) continue;
    // parent dir in the key: examples/orders and core/examples/orders.squinch
    // share a basename, and a bare key silently overwrote one with the other
    const dir = f.split(/[\\/]/).slice(-2, -1)[0];
    const key = `${dir}--${name.replace(/\.squinch$/, "")}.${v.name}`.replace(/[^\w.-]/g, "_");
    const png = svgToPng(r.svg!, { width: +m[1] * 2, background: "#ffffff" });
    writeFileSync(join(out, `${key}.png`), png);
    cells.push({ key, png, w: +m[1], h: +m[2] });
  }
}
console.log(`${label}: ${cells.length} views rendered`);

if (label !== "baseline") {
  const basedir = join(root, ".compare-tmp", "baseline");
  if (!existsSync(basedir)) {
    console.error("no baseline captured — run `tsx scripts/gallery.mts baseline` from the untouched engine first");
    process.exit(2);
  }
  let same = 0;
  const rows: string[] = [];
  for (const c of cells) {
    const basePng = join(basedir, `${c.key}.png`);
    if (existsSync(basePng) && readFileSync(basePng).equals(c.png)) { same++; continue; }
    const missing = !existsSync(basePng);
    rows.push(
      `<section><h2>${c.key}${missing ? " (new view)" : ""} <small>${c.w}×${c.h}</small></h2>` +
      `<div class="pair">` +
      (missing ? `<div class="side"><em>no baseline</em></div>`
               : `<div class="side"><h3>before</h3><img src="../baseline/${c.key}.png"></div>`) +
      `<div class="side"><h3>after</h3><img src="./${c.key}.png"></div>` +
      `</div></section>`,
    );
  }
  const html =
    `<!doctype html><meta charset="utf-8"><title>${label} — before/after</title>` +
    `<style>body{font-family:system-ui;margin:24px;background:#f6f5f2}` +
    `h1{font-size:20px}h2{font-size:14px;margin:32px 0 8px}h2 small{color:#888;font-weight:400}` +
    `.pair{display:flex;gap:16px;align-items:flex-start}` +
    `.side{flex:1;min-width:0}.side h3{font-size:11px;color:#888;margin:0 0 4px;text-transform:uppercase}` +
    `img{max-width:100%;border:1px solid #ddd;background:#fff}</style>` +
    `<h1>${label}: ${rows.length} changed view(s), ${same} byte-identical</h1>` +
    rows.join("\n");
  writeFileSync(join(out, "gallery.html"), html);
  console.log(`gallery: ${rows.length} changed, ${same} identical → ${join(".compare-tmp", label, "gallery.html")}`);
}
