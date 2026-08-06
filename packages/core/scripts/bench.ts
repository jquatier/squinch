// Performance budgets from docs/ENGINEERING.md — acceptance criteria, enforced in
// CI. Synthesizes a 200-node model (no fixtures to rot) and measures:
//
//   full parse            < 50ms
//   incremental reparse   < 10ms   (one-keystroke edit, Lezer fragments)
//   layout + render       < 500ms  (the fully-expanded 200-node view)
//
// Medians of BENCH_RUNS runs after warmup, so a GC pause on a CI runner
// doesn't fail the build. Exit 1 on any budget breach.
//
// Budgets catch catastrophes; they do not catch creep. `bench.baseline.json`
// holds recorded medians per machine, and a run on a machine it knows about
// flags anything more than DRIFT above its own recorded number — the ELK label
// dummies grew layout 66ms → 86ms across one session, all of it explained, none
// of it noticed automatically. Timings are not comparable across machines, so a
// run on an unrecorded one (CI, someone else's laptop) prints the comparison as
// informational and gates on the absolute budgets only.
//
//   npx tsx scripts/bench.ts                     (run from packages/core)
//   npx tsx scripts/bench.ts --update-baseline   (record this machine)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { cpus, platform, arch } from "node:os";
import { TreeFragment, type ChangedRange } from "@lezer/common";
// @ts-ignore generated
import { parser } from "../src/grammar/parser.js";
import { buildModel } from "../src/model/build.js";
import { layoutView } from "../src/layout/layout.js";
import { renderSVG } from "../src/render/svg.js";
import { validateSVG } from "../src/render/validate.js";
import { themes } from "../src/themes/index.js";
import "../src/packs/node-fs.js"; // register disk packs

const SYSTEMS = 10;
const PER_SYSTEM = 20; // 10 × 20 = 200 nodes
const RUNS = 9;
const WARMUP = 3;

const ICONS = ["aws/lambda", "aws/dynamodb", "aws/s3", "aws/sqs", "aws/sns"];

/** Deterministic 200-node model: SYSTEMS systems, chained internals plus
 *  cross-system calls — shaped like a real estate, not a random graph. */
function synth(): string {
  const L: string[] = ["pack aws", ""];
  for (let s = 0; s < SYSTEMS; s++) {
    L.push(`system svc${s} "Service ${s}" {`);
    L.push(`  description: "Synthetic benchmark service number ${s}"`);
    for (let n = 0; n < PER_SYSTEM; n++)
      L.push(`  n${n} = ${ICONS[(s + n) % ICONS.length]} "Node ${s}-${n}"`);
    for (let n = 0; n < PER_SYSTEM - 1; n++)
      L.push(`  n${n} -> n${n + 1} "step"`);
    L.push(`}`);
  }
  // ring of cross-system calls so lifting has work to do
  for (let s = 0; s < SYSTEMS; s++)
    L.push(`svc${s}.n${PER_SYSTEM - 1} -> svc${(s + 1) % SYSTEMS}.n0 "calls"`);
  L.push("", `view all {`);
  for (let s = 0; s < SYSTEMS; s++) L.push(`  expand svc${s}`);
  L.push(`}`);
  return L.join("\n") + "\n";
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

async function bench(name: string, fn: () => Promise<void> | void): Promise<number> {
  for (let i = 0; i < WARMUP; i++) await fn();
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    await fn();
    times.push(performance.now() - t0);
  }
  const med = median(times);
  console.log(`${name.padEnd(22)} median ${med.toFixed(1)}ms  (min ${Math.min(...times).toFixed(1)}, max ${Math.max(...times).toFixed(1)})`);
  return med;
}

const src = synth();
const model = buildModel(src);
if (!model.ok) throw new Error("synthetic model failed to build");
const nodeCount = model.model.nodes.size;
console.log(`synthetic model: ${nodeCount} nodes, ${model.model.edges.length} edges\n`);
if (nodeCount !== SYSTEMS * PER_SYSTEM) throw new Error(`expected ${SYSTEMS * PER_SYSTEM} nodes`);

const results: [string, number, number][] = [];

results.push(["full parse", await bench("full parse", () => { parser.parse(src); }), 50]);

// incremental: reuse fragments across a one-character insertion mid-file
const baseTree = parser.parse(src);
const editAt = Math.floor(src.length / 2);
const edited = src.slice(0, editAt) + "x" + src.slice(editAt);
const changes: ChangedRange[] = [{ fromA: editAt, toA: editAt, fromB: editAt, toB: editAt + 1 }];
results.push([
  "incremental reparse",
  await bench("incremental reparse", () => {
    const frags = TreeFragment.applyChanges(TreeFragment.addTree(baseTree), changes);
    parser.parse(edited, frags);
  }),
  10,
]);

const view = model.model.views.find((v) => v.name === "all")!;
let lastSVG = "";
results.push([
  "layout + render",
  await bench("layout + render", async () => {
    const { positioned, diagnostics } = await layoutView(model.model, view);
    if (diagnostics.some((d) => d.severity === "error")) throw new Error("layout error");
    lastSVG = renderSVG(positioned, themes.light, {});
  }),
  500,
]);

const valid = validateSVG(lastSVG);
if (!valid.ok) throw new Error(`benchmark SVG invalid: ${valid.error}`);

console.log("");
let fail = false;
for (const [name, med, budget] of results) {
  const ok = med < budget;
  if (!ok) fail = true;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: ${med.toFixed(1)}ms (budget ${budget}ms)`);
}

// ── drift against this machine's recorded medians ────────────────────────────
const DRIFT = 1.25;
// below this, a 25% band is scheduler noise: the parse medians are under a
// millisecond, where one GC pause is a 50% "regression". Reported, never failed.
const FLOOR_MS = 5;
const BASELINE = join(dirname(fileURLToPath(import.meta.url)), "bench.baseline.json");
type Baseline = { note: string; machines: Record<string, Record<string, number>> };
const machine = `${platform()}-${arch()}-${(cpus()[0]?.model ?? "unknown").replace(/\s+/g, "_")}`;
const file: Baseline = existsSync(BASELINE)
  ? JSON.parse(readFileSync(BASELINE, "utf8"))
  : { note: "medians in ms, per machine; timings do not compare across machines", machines: {} };

if (process.argv.includes("--update-baseline")) {
  file.machines[machine] = Object.fromEntries(results.map(([n, m]) => [n, +m.toFixed(1)]));
  writeFileSync(BASELINE, JSON.stringify(file, null, 2) + "\n");
  console.log(`\nbaseline recorded for ${machine}`);
} else {
  const recorded = file.machines[machine];
  console.log("");
  if (!recorded) {
    console.log(`no baseline for ${machine} — budgets only`);
    console.log(`(record one with \`npx tsx scripts/bench.ts --update-baseline\`)`);
  } else {
    for (const [name, med] of results) {
      const was = recorded[name];
      if (was === undefined) continue;
      const ratio = med / was;
      const drifted = ratio > DRIFT && was >= FLOOR_MS;
      if (drifted) fail = true;
      console.log(
        `${drifted ? "DRIFT" : "  ok "} ${name}: ${med.toFixed(1)}ms vs baseline ${was}ms ` +
        `(${ratio >= 1 ? "+" : ""}${((ratio - 1) * 100).toFixed(0)}%)` +
        (was < FLOOR_MS ? " — under the noise floor, not gated" : ""),
      );
    }
    if (fail) console.log(`\nover ${((DRIFT - 1) * 100).toFixed(0)}% slower than recorded. If the ` +
      `cost is understood and wanted, re-record with --update-baseline in the same commit.`);
  }
}
process.exit(fail ? 1 : 0);
