// ELK beside weft, as the product draws them: every view of the corpus
// rendered twice through `render` — titles, legends, notes, flow badges and
// all — with each engine's diagnostics under its picture. For looking at
// before the engine is swapped; goes when ELK does.
//
//   npx tsx scripts/engine-compare.ts <out.html> [substring of a corpus path…]
import "../src/packs/node-fs.js";
import { writeFileSync } from "node:fs";
import { buildProject, render, setLayoutEngine } from "../src/index.js";
import { corpus } from "../test/helpers/corpus.js";

const [out, ...only] = process.argv.slice(2);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const sections: string[] = [];
const count = { views: 0, weftFailed: 0, elkFailed: 0, differ: 0 };

for (const f of corpus()) {
  if (only.length && !only.some((o) => f.name.includes(o))) continue;
  const built = buildProject([{ name: f.name, src: f.src }]);
  if (built.diagnostics.some((d) => d.severity === "error")) continue;
  for (const view of built.model.views) {
    const draw = async (engine: "elk" | "weft") => {
      setLayoutEngine(engine);
      try {
        const r = await render(f.src, { view: view.name, embedFonts: false });
        return { svg: r.svg, says: r.diagnostics.map((d) => `${d.severity}: ${d.message}`) };
      } catch (e) {
        return { svg: undefined, says: [`crash: ${String(e).slice(0, 200)}`] };
      }
    };
    const elk = await draw("elk"), weft = await draw("weft");
    count.views++;
    if (!elk.svg) count.elkFailed++;
    if (!weft.svg) count.weftFailed++;
    const differ = elk.says.join("\n") !== weft.says.join("\n");
    if (differ) count.differ++;
    const fig = (label: string, r: typeof elk) =>
      `<figure><figcaption><b>${label}</b></figcaption>${r.svg ?? `<p class="none">no picture</p>`}` +
      (r.says.length ? `<ul>${r.says.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : "") + `</figure>`;
    sections.push(
      `<section><h3>${esc(f.name.replace(".squinch", ""))} · ${esc(view.name)}${view.auto ? " (auto)" : ""}` +
      `${differ ? ` <span class="t">diagnostics differ</span>` : ""}</h3>` +
      `<div class="pair">${fig("ELK (production)", elk)}${fig("WEFT", weft)}</div></section>`);
  }
}
setLayoutEngine("elk");
writeFileSync(out, `<!doctype html><meta charset="utf-8"><title>ELK beside weft</title><style>
body{font:14px system-ui,sans-serif;margin:16px;background:#fff;color:#111}h3{font-size:16px;margin:28px 0 8px}
.pair{display:flex;gap:16px;align-items:flex-start}figure{margin:0;flex:1 1 0;min-width:0}figure svg{max-width:100%;height:auto}
figcaption{font-size:12px;margin-bottom:4px}ul{font-size:12px;margin:6px 0 0;padding-left:18px;color:#733}
.t{font-size:12px;padding:2px 6px;border-radius:4px;color:#fff;background:#b60}.none{color:#a00}</style>
${sections.join("\n")}`);
console.log(count);
