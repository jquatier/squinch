// Before/after renders for a change that moves geometry.
//
//   npx tsx scripts/compare.mts before          # capture the current engine
//   …make the change, rebuild core…
//   npx tsx scripts/compare.mts after           # capture again
//
// Writes PNGs to `.compare-tmp/<label>/<file>.<view>.png` (gitignored, same
// convention as `.hero-tmp/` and `gauntlet/.run/`). Both passes render through
// `packages/core/dist`, so "after" means "after `pnpm --filter @squinch/core
// build`" — capturing before you rebuild gets you two identical sets and a
// false all-clear.
//
// Why this exists: a renderer change that only moves things a few pixels is
// invisible in a byte diff — you see that 12 files changed and nothing about
// whether the diagrams got better or worse. `git diff` answers "did it move";
// this answers "does it look right", which is the only question DESIGN §9 asks.
//
// Deliberately not a compositor: two PNGs viewed side by side is the whole
// requirement, and stitching them into one image means inheriting hero-gif's
// resvg landmines (a nested viewport inside a scaled group panics; so does a
// group scaled wholly outside the viewport).
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildProject, renderProject } from "../packages/core/dist/index.js";
import { svgToPng } from "../packages/cli/src/raster.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const label = process.argv[2];
if (!label) {
  console.error("usage: tsx scripts/compare.mts <label>   (e.g. before | after)");
  process.exit(2);
}

/** The views a change is expected to touch. Edit per change — a fixed list
 *  keeps the review small and makes an unexpected mover obvious by its absence
 *  from the pictures rather than by hiding in a hundred of them. */
const TARGETS: { file: string; views?: string[] }[] = [
  { file: "lookbook/cases/04-deep-chain.squinch" },
  { file: "lookbook/cases/21-logos.squinch" },
  { file: "lookbook/cases/14-sidecar-routes.squinch" },
];

const out = join(root, ".compare-tmp", label);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

let n = 0;
for (const t of TARGETS) {
  const name = t.file.split("/").pop()!;
  const src = readFileSync(join(root, t.file), "utf8");
  const built = buildProject([{ name, src }]);
  if (built.diagnostics.some((d) => d.severity === "error")) {
    console.error(`  SKIP ${t.file} — does not build`);
    continue;
  }
  const explicit = built.model.views.filter((v) => !v.auto).map((v) => v.name);
  const all = explicit.length ? explicit : built.model.views.map((v) => v.name);
  for (const view of t.views ?? all) {
    const r = await renderProject([{ name, src }], { view, theme: "light" });
    if (!r.ok) {
      console.error(`  FAIL ${t.file}#${view}`);
      continue;
    }
    // 2× so a 4px shift is actually visible when the image is scaled to fit
    const png = svgToPng(r.svg!, { width: widthOf(r.svg!) * 2, background: "#ffffff" });
    writeFileSync(join(out, `${name.replace(/\.squinch$/, "")}.${view}.png`), png);
    n++;
  }
}

function widthOf(svg: string): number {
  const m = /<svg[^>]*width="(\d+)"/.exec(svg);
  if (!m) throw new Error("no width on the root <svg>");
  return +m[1];
}

console.log(`${label}: wrote ${n} render(s) to ${join(".compare-tmp", label)}`);
