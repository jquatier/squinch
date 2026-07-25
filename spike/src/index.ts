// Phase-0 harness: runs the three cases, renders SVGs, and checks the five
// exit criteria from docs/PLAN.md §3. Exit code 0 = all pass.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { canonical, stability, fanin } from "./model.js";
import { layoutModel, type Positioned } from "./layout.js";
import { renderSVG } from "./render.js";

const results: { criterion: string; pass: boolean; detail: string }[] = [];
const check = (criterion: string, pass: boolean, detail: string) =>
  results.push({ criterion, pass, detail });

const bandOf = (p: Positioned, id: string) => p.nodes.find((n) => n.id === id)!.y;
const xOf = (p: Positioned, id: string) => p.nodes.find((n) => n.id === id)!.x;

function rowMembership(p: Positioned): Map<number, string[]> {
  const bands = new Map<number, string[]>();
  for (const n of [...p.nodes].sort((a, b) => a.x - b.x))
    bands.set(n.y, [...(bands.get(n.y) ?? []), n.id]);
  return bands;
}

async function main() {
  mkdirSync("out", { recursive: true });
  const cases = [canonical, stability, fanin];
  const first = new Map<string, { p: Positioned; svg: string }>();

  for (const m of cases) {
    const p = await layoutModel(m);
    const svg = renderSVG(p);
    writeFileSync(`out/${m.name}.svg`, svg);
    first.set(m.name, { p, svg });
  }

  const can = first.get("canonical")!.p;
  const sta = first.get("stability")!.p;
  const fan = first.get("fanin")!.p;

  // ── Criterion 1: rows pinning + stability under one added node ──────────
  {
    const bands = [...rowMembership(can).entries()].sort((a, b) => a[0] - b[0]);
    const rows = bands.map(([, ids]) => ids);
    const rowsOk =
      rows.length === 3 &&
      rows[0].join() === "api" &&
      rows[1].join() === "create,get,search" &&
      rows[2].join() === "db,sync,files,idx"; // sync inserted by `place`
    const sBands = [...rowMembership(sta).entries()].sort((a, b) => a[0] - b[0]);
    const sRows = sBands.map(([, ids]) => ids);
    const stableOk =
      sRows.length === 3 &&
      sRows[0].join() === "api" &&
      sRows[1].join() === "create,get,search,cache" && // originals unmoved, cache appended
      sRows[2].join() === "db,sync,files,idx";
    check(
      "1 rows pinning + stability",
      rowsOk && stableOk,
      `canonical=[${rows.map((r) => r.join(" "))}] stability=[${sRows.map((r) => r.join(" "))}]`,
    );
  }

  // ── Criterion 2: place sync right-of db, adjacent, same band ─────────────
  {
    const db = can.nodes.find((n) => n.id === "db")!;
    const sync = can.nodes.find((n) => n.id === "sync")!;
    const sameBand = db.y === sync.y;
    const rightOf = sync.x > db.x + db.w;
    const between = can.nodes.filter(
      (n) => n.y === db.y && n.x > db.x && n.x < sync.x && n.id !== "sync" && n.id !== "db",
    );
    check(
      "2 place right-of",
      sameBand && rightOf && between.length === 0,
      `db.y=${db.y} sync.y=${sync.y} gap=${sync.x - (db.x + db.w)} between=[${between.map((n) => n.id)}]`,
    );
  }

  // ── Criterion 3: route db ~> sync from east to west ──────────────────────
  {
    const db = can.nodes.find((n) => n.id === "db")!;
    const sync = can.nodes.find((n) => n.id === "sync")!;
    const e8 = can.edges.find((e) => e.id === "e8")!;
    const start = e8.points[0];
    const end = e8.points[e8.points.length - 1];
    const exitsEast = start.x === db.x + db.w && start.y > db.y && start.y < db.y + db.h;
    const entersWest = end.x === sync.x && end.y > sync.y && end.y < sync.y + sync.h;
    const firstHorizontal = e8.points[1].y === start.y && e8.points[1].x > start.x;
    check(
      "3 route east→west",
      exitsEast && entersWest && firstHorizontal,
      `start=(${start.x},${start.y}) dbRight=${db.x + db.w} end=(${end.x},${end.y}) syncLeft=${sync.x}`,
    );
  }

  // ── Criterion 4: fan-in port spread + perpendicular stubs ────────────────
  {
    const sink = fan.nodes.find((n) => n.id === "sink")!;
    const inPorts = fan.ports
      .filter((p) => p.node === "sink" && p.side === "NORTH")
      .sort((a, b) => a.x - b.x);
    const distinct = new Set(inPorts.map((p) => p.x)).size === 4;
    const gaps = inPorts.slice(1).map((p, i) => p.x - inPorts[i].x);
    const even = gaps.every((g) => Math.abs(g - gaps[0]) <= 1);
    const stubsOk = fan.edges.every((e) => {
      const n = e.points.length;
      const a = e.points[n - 2], b = e.points[n - 1];
      return a.x === b.x && b.y - a.y >= 16; // final segment vertical, ≥16 long
    });
    check(
      "4 fan-in ports + stubs",
      inPorts.length === 4 && distinct && even && stubsOk,
      `ports.x=[${inPorts.map((p) => p.x)}] gaps=[${gaps}] sinkW=${sink.w}`,
    );
  }

  // ── Criterion 5: determinism — re-layout + re-render, byte-compare ──────
  {
    let identical = true;
    const hashes: Record<string, string> = {};
    for (const m of cases) {
      const again = renderSVG(await layoutModel(m));
      if (again !== first.get(m.name)!.svg) identical = false;
      hashes[m.name] = createHash("sha256").update(first.get(m.name)!.svg).digest("hex");
    }
    const lfOnly = [...first.values()].every(({ svg }) => !svg.includes("\r"));
    writeFileSync("out/hashes.json", JSON.stringify(hashes, null, 2) + "\n");
    let goldenMsg = "no golden yet";
    let goldenOk = true;
    if (existsSync("golden/hashes.json")) {
      const golden = JSON.parse(readFileSync("golden/hashes.json", "utf8"));
      goldenOk = Object.keys(hashes).every((k) => golden[k] === hashes[k]);
      goldenMsg = goldenOk ? "matches golden" : "GOLDEN MISMATCH";
    }
    check("5 determinism", identical && lfOnly && goldenOk, `re-render identical=${identical} LF-only=${lfOnly} ${goldenMsg}`);
  }

  const width = Math.max(...results.map((r) => r.criterion.length));
  let failed = 0;
  for (const r of results) {
    if (!r.pass) failed++;
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.criterion.padEnd(width)}  ${r.detail}`);
  }
  console.log(failed === 0 ? "\nPhase 0: ALL EXIT CRITERIA PASS" : `\nPhase 0: ${failed} criteria failing`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
