// Left to right. Three questions, both engines:
//   1. does a rightward diagram read rightward — every wire out of an east
//      wall and into a west one, every column on one left edge?
//   2. are arrangements stated under a rightward flow honoured (there a
//      `rows` band is a column)?
//   3. turned on its side, is every view we own still legal, and how good?
//   npx vitest run spike/grid/direction-right.test.ts --disable-console-intercept
import { it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildProject } from "../../src/index.js";
import { layoutView, type Positioned } from "../../src/layout/layout.js";
import type { SView } from "../../src/model/types.js";
import { corpus } from "../../test/helpers/corpus.js";
import { checkLayout } from "../../test/invariants.js";
import { column, flush, leftOf, level, row, stack, sys, zone, view, rectOf, type Ask } from "./asks.js";
import { layoutViewGrid } from "./layout.js";
import { measureLayout, type Metrics } from "./metrics.js";

const here = dirname(fileURLToPath(import.meta.url));
const right = (v: SView): SView => ({ ...v, layout: { ...v.layout, direction: "right" } });
const strictly = (p: Positioned) => ({ ...p, edges: p.edges.map((e) => ({ ...e, coplanar: true as const })) });

// ── 1. reading rightward ─────────────────────────────────────────────────────
/** Acyclic and unhinted, so every wire should run left to right. */
const boxes = (ids: string[]) => ids.map((id) => `${id} = box "${id}"`).join("\n") + "\n";
const edges = (...es: string[]) => es.join("\n") + "\n";
const flows: { name: string; src: string }[] = [
  { name: "a chain of six", src: boxes(["a", "b", "c", "d", "e", "f"]) + edges("a -> b", "b -> c", "c -> d", "d -> e", "e -> f") },
  { name: "a chain with labels", src: boxes(["a", "b", "c", "d"]) + edges('a -> b "parse"', 'b -> c "validate the payload"', 'c -> d "store"') },
  { name: "fan out to five", src: boxes(["hub", "t1", "t2", "t3", "t4", "t5"]) + edges(...["t1", "t2", "t3", "t4", "t5"].map((t) => `hub -> ${t}`)) },
  { name: "fan in from five", src: boxes(["s1", "s2", "s3", "s4", "s5", "sink"]) + edges(...["s1", "s2", "s3", "s4", "s5"].map((t) => `${t} -> sink`)) },
  { name: "diamond", src: boxes(["a", "b", "c", "d"]) + edges("a -> b", "a -> c", "b -> d", "c -> d") },
  { name: "lattice", src: boxes(["t", "a1", "a2", "b1", "b2", "b3", "z"]) + edges("t -> a1", "t -> a2", "a1 -> b1", "a1 -> b2", "a2 -> b2", "a2 -> b3", "b1 -> z", "b2 -> z", "b3 -> z") },
  { name: "skips", src: boxes(["s1", "s2", "s3", "s4", "s5"]) + edges("s1 -> s2", "s2 -> s3", "s3 -> s4", "s4 -> s5", "s1 -> s3", "s2 -> s5", "s1 -> s5") },
  { name: "a binary tree", src: boxes(Array.from({ length: 15 }, (_, i) => `n${i + 1}`)) + edges(...Array.from({ length: 14 }, (_, i) => `n${Math.floor((i + 2) / 2)} -> n${i + 2}`)) },
  { name: "three tiers", src: boxes(["w1", "w2", "w3", "a1", "a2", "d1", "d2", "d3"]) + edges("w1 -> a1", "w2 -> a1", "w2 -> a2", "w3 -> a2", "a1 -> d1", "a1 -> d2", "a2 -> d2", "a2 -> d3") },
  { name: "wide and narrow boxes", src: 'a = box "A"\nb = box "A much longer name for this stage"\nc = box "C"\nd = box "Another long stage name here"\n' + edges("a -> b", "b -> c", "a -> d", "d -> c") },
  { name: "people and stores", src: 'person u "User"\nperson s "Staff"\n' + boxes(["app", "admin", "api", "db"]) + edges("u -> app", "s -> admin", "app -> api", "admin -> api", "api -> db") },
  { name: "a pipeline with side lookups", src: boxes(["in", "parse", "enrich", "score", "out", "geo", "rules"]) + edges("in -> parse", "parse -> enrich", "enrich -> score", "score -> out", "enrich -> geo", "score -> rules") },
].map((f) => ({ ...f, src: f.src + "view v { include *\n  layout { direction right } }\n" }));

/** How a rightward picture reads. */
function reading(p: Positioned) {
  const at = (path: string) => p.nodes.find((n) => n.path === path)!;
  let wires = 0, eastToWest = 0, columns = 0, flushColumns = 0;
  for (const e of p.edges) {
    const a = at(e.from), b = at(e.to), first = e.points[0], last = e.points[e.points.length - 1];
    wires++;
    if (first.x === a.x + a.w && last.x === b.x) eastToWest++;
  }
  const byRank = new Map<number, number[]>();
  for (const n of p.nodes) (byRank.get(n.rank) ?? byRank.set(n.rank, []).get(n.rank)!).push(n.x);
  for (const xs of byRank.values()) { columns++; if (new Set(xs).size === 1) flushColumns++; }
  return { wires, eastToWest, columns, flushColumns };
}

// ── 2. arrangements under a rightward flow ───────────────────────────────────
const web = sys("web", "Web", ["ui", "bff"], ["ui -> bff"]);
const api = sys("api", "API", ["gw", "svc", "db"], ["gw -> svc", "svc -> db"]);
const data = sys("data", "Data", ["lake", "jobs"], ["jobs -> lake"]);
const R = "layout { direction right";
export const cases: { name: string; src: string; asks: Ask[] }[] = [
  { name: "three zones, one after another",
    src: web + api + data + "web.bff -> api.gw\napi.svc -> data.lake\n" + zone("a", "Edge", "vpc", "web") + zone("b", "App", "vpc", "api") + zone("c", "Data", "vpc", "data") + view(`expand *\n${R} }`),
    asks: [row("a", "b", "c"), level("a", "b", "c")] },
  { name: "three zones, columns stated",
    src: web + api + data + "web.bff -> api.gw\napi.svc -> data.lake\n" + zone("a", "Edge", "vpc", "web") + zone("b", "App", "vpc", "api") + zone("c", "Data", "vpc", "data") + view(`expand *\n${R}\n rows [web] [api] [data] }`),
    asks: [leftOf("a", "b"), leftOf("b", "c")] },
  { name: "two zones in one column, a third after them",
    src: web + api + data + "web.bff -> data.lake\napi.svc -> data.lake\n" + zone("a", "Edge", "vpc", "web") + zone("b", "App", "vpc", "api") + zone("c", "Data", "vpc", "data") + view(`expand *\n${R}\n rows [web api] [data] }`),
    asks: [column("a", "b"), flush("a", "b"), leftOf("a", "c"), leftOf("b", "c")] },
  { name: "two zones in one column, a wire between them",
    src: web + api + "web.bff -> api.gw\n" + zone("a", "Edge", "vpc", "web") + zone("b", "App", "vpc", "api") + view(`expand *\n${R}\n rows [web api] }`),
    asks: [column("a", "b"), flush("a", "b")] },
  { name: "a column of three expanded systems, then a store",
    src: web + api + data + 'store = box "Store"\nweb.bff -> store\napi.svc -> store\ndata.jobs -> store\n' + view(`expand *\n${R}\n rows [web api data] [store] }`),
    asks: [column("web", "api", "data"), flush("web", "api", "data"), leftOf("web", "store"), leftOf("data", "store")] },
  { name: "a cloud holding two VPCs, one after the other",
    src: web + api + "web.bff -> api.gw\n" + zone("cloud", "Cloud", "cloud", "web", "api") + zone("a", "VPC one", "vpc", "web") + zone("b", "VPC two", "vpc", "api") + view(`expand *\n${R} }`),
    asks: [row("a", "b"), level("a", "b")] },
  { name: "a cloud holding two VPCs stacked in one column",
    src: web + api + "web.bff -> api.gw\n" + zone("cloud", "Cloud", "cloud", "web", "api") + zone("a", "VPC one", "vpc", "web") + zone("b", "VPC two", "vpc", "api") + view(`expand *\n${R}\n rows [web api] }`),
    asks: [column("a", "b"), flush("a", "b")] },
  { name: "a downward container inside a rightward view",
    src: 'src = box "Source"\nsystem s "Service" {\n  a = box "a"\n  b = box "b"\n  c = box "c"\n  a -> b\n  b -> c\n  layout { direction down }\n}\nsink = box "Sink"\nsrc -> s.a\ns.c -> sink\n' + view(`expand s\n${R} }`),
    asks: [column("s.a", "s.b", "s.c"), leftOf("src", "s"), leftOf("s", "sink")] },
  { name: "a wire running back against the flow, columns stated",
    src: 'a = box "A"\nb = box "B"\nc = box "C"\na -> b\nb -> c\nc -> a "feedback"\n' + view(`${R}\n rows [a] [b] [c] }`),
    asks: [leftOf("a", "b"), leftOf("b", "c"), level("a", "b", "c")] },
  { name: "two lanes: a column of two feeding a column of two",
    src: 'a1 = box "A1"\na2 = box "A2"\nb1 = box "B1"\nb2 = box "B2"\na1 -> b1\na2 -> b2\na1 -> a2\nb1 -> b2\n' + view(`${R}\n rows [a1 a2] [b1 b2] }`),
    asks: [column("a1", "a2"), column("b1", "b2"), flush("a1", "a2"), flush("b1", "b2"), leftOf("a1", "b1"), level("a1", "b1"), level("a2", "b2")] },
  { name: "a chain of nine folded into columns of three",
    src: Array.from({ length: 9 }, (_, i) => `s${i + 1} = box "s${i + 1}"`).join("\n") + "\n" + Array.from({ length: 8 }, (_, i) => `s${i + 1} -> s${i + 2}`).join("\n") + "\n" + view(`${R}\n wrap 3 }`),
    asks: [column("s1", "s2", "s3"), leftOf("s1", "s4"), leftOf("s4", "s7")] },
  { name: "tables side by side, a reference between them",
    src: 'system db "Database" {\n  orders = sys/table "orders" datastore {\n    fields {\n      id uuid pk\n      customer_id uuid fk\n      total bigint\n    }\n  }\n  customers = sys/table "customers" datastore {\n    fields {\n      id uuid pk\n      email text\n    }\n  }\n  orders -> customers "customer_id"\n}\nview v { scope db\n  layout { direction right } }\n',
    asks: [leftOf("db.orders", "db.customers")] },
];

it("left to right: does it read rightward, is it arranged as asked, and is everything still legal on its side?", async () => {
  const bad: string[] = [];
  const strict = (name: string, p: Positioned, ctx = {}) => bad.push(...checkLayout(strictly(p), ctx).map((b) => `${name}: ${b}`));

  // 1 ─ reading
  console.log(`\n1. Reading rightward — ${flows.length} acyclic diagrams, nothing arranged by hand`);
  console.log(`${"".padEnd(30)} wires east→west      columns flush left    size ELK     size grid   bends ELK/grid`);
  const sum = { elk: { wires: 0, eastToWest: 0, columns: 0, flushColumns: 0 }, grid: { wires: 0, eastToWest: 0, columns: 0, flushColumns: 0 } };
  for (const f of flows) {
    const built = buildProject([{ name: f.name, src: f.src }]);
    const errs = built.diagnostics.filter((d) => d.severity === "error");
    if (errs.length) throw new Error(`${f.name}: ${errs[0].message}`);
    const v = built.model.views.find((x) => x.name === "v")!;
    const elk = (await layoutView(built.model, v)).positioned, grid = layoutViewGrid(built.model, v).positioned;
    strict(f.name, grid);
    const e = reading(elk), g = reading(grid), me = measureLayout(elk), mg = measureLayout(grid);
    for (const k of ["wires", "eastToWest", "columns", "flushColumns"] as const) { sum.elk[k] += e[k]; sum.grid[k] += g[k]; }
    console.log(`${f.name.padEnd(30)} ELK ${`${e.eastToWest}/${e.wires}`.padEnd(6)} grid ${`${g.eastToWest}/${g.wires}`.padEnd(6)} ELK ${`${e.flushColumns}/${e.columns}`.padEnd(5)} grid ${`${g.flushColumns}/${g.columns}`.padEnd(5)}  ${`${me.width}×${me.height}`.padEnd(11)} ${`${mg.width}×${mg.height}`.padEnd(11)} ${me.bends}/${mg.bends}`);
  }
  console.log(`${"total".padEnd(30)} ELK ${sum.elk.eastToWest}/${sum.elk.wires}  grid ${sum.grid.eastToWest}/${sum.grid.wires}     ELK ${sum.elk.flushColumns}/${sum.elk.columns}  grid ${sum.grid.flushColumns}/${sum.grid.columns}`);

  // 2 ─ arrangements
  console.log(`\n2. Arrangements under a rightward flow — ${cases.length} diagrams`);
  let elkWhole = 0, gridWhole = 0, elkTidy = 0, gridTidy = 0, tidy = 0;
  for (const c of cases) {
    const built = buildProject([{ name: c.name, src: c.src }]);
    const errs = built.diagnostics.filter((d) => d.severity === "error");
    if (errs.length) throw new Error(`${c.name}: ${errs[0].message}`);
    const v = built.model.views.find((x) => x.name === "v")!;
    const elkOut = await layoutView(built.model, v);
    const elk = elkOut.positioned, grid = layoutViewGrid(built.model, v).positioned;
    strict(c.name, grid, { zoneMembers: new Map(built.model.zones.map((z) => [z.id, z.members])) });
    const e = c.asks.map((a) => a.holds(elk)), g = c.asks.map((a) => a.holds(grid));
    const placed = (ok: boolean[]) => c.asks.every((a, i) => a.polish || ok[i]);
    c.asks.forEach((a, i) => { if (a.polish) { tidy++; if (e[i]) elkTidy++; if (g[i]) gridTidy++; } });
    if (placed(e)) elkWhole++;
    if (placed(g)) gridWhole++;
    const verdict = (ok: boolean[]) => (ok.every(Boolean) ? "as asked" : placed(ok) ? "uneven" : "NOT as asked");
    const diag = elkOut.diagnostics.length;
    console.log(`${c.name.padEnd(54)} ELK ${verdict(e).padEnd(13)} grid ${verdict(g).padEnd(13)} ${`${elk.width}×${elk.height}`.padEnd(10)} ${`${grid.width}×${grid.height}`.padEnd(10)}${diag ? ` ELK:${diag} diagnostic` : ""}`);
    c.asks.forEach((a, i) => { if (!a.polish && (!e[i] || !g[i])) console.log(`      ${a.say}: ELK ${e[i] ? "yes" : "NO"}, grid ${g[i] ? "yes" : "NO"}`); });
    if (!placed(g)) bad.push(`${c.name}: not arranged as asked`);
  }
  console.log(`arranged as asked: ELK ${elkWhole}/${cases.length} · grid ${gridWhole}/${cases.length}    tidy (level, flush): ELK ${elkTidy}/${tidy} · grid ${gridTidy}/${tidy}`);

  // 3 ─ everything we own, turned on its side
  const sources = [
    ...corpus(),
    ...readdirSync(join(here, "trial")).filter((f) => f.endsWith(".squinch")).sort().map((f) => ({ name: `trial/${f}`, src: readFileSync(join(here, "trial", f), "utf8") })),
  ];
  const keys: (keyof Metrics)[] = ["area", "wire", "bends", "crossings", "kinks", "throughNode", "nearMiss"];
  const total = { elk: {} as Record<string, number>, grid: {} as Record<string, number> };
  for (const k of keys) { total.elk[k] = 0; total.grid[k] = 0; }
  let views = 0, elkBad = 0, elkErr = 0, elkCrash = 0;
  for (const f of sources) {
    const built = buildProject([{ name: f.name, src: f.src }]);
    if (built.diagnostics.some((d) => d.severity === "error")) continue;
    const ctx = {
      zoneMembers: new Map(built.model.zones.map((z) => [z.id, z.members])),
      channelTargets: new Set(built.model.views.flatMap((v) => v.layout.channels.map((c) => c.target))),
    };
    for (const original of built.model.views) {
      if (original.layout.direction === "right") continue; // already counted where it lives
      const v = right(original);
      const grid = layoutViewGrid(built.model, v).positioned;
      const trunks = new Set([...ctx.channelTargets, ...grid.edges.filter((e) => e.via === "bus").map((e) => e.to)]);
      strict(`${f.name}#${v.name}`, grid, { ...ctx, channelTargets: trunks });
      views++;
      try {
        const elk = await layoutView(built.model, v);
        elkErr += elk.diagnostics.filter((d) => d.severity === "error").length;
        elkBad += checkLayout(elk.positioned, ctx).length;
        const a = measureLayout(elk.positioned), b = measureLayout(grid);
        for (const k of keys) { total.elk[k] += a[k]; total.grid[k] += b[k]; }
      } catch { elkCrash++; }
    }
  }
  console.log(`\n3. Every corpus and trial view, turned to flow rightward — ${views} views`);
  console.log(`   ELK: ${elkErr} errors, ${elkBad} invariant violations, ${elkCrash} crashes · grid: ${bad.length} violations`);
  for (const k of keys) console.log(`   ${k.padEnd(12)} ELK ${String(total.elk[k]).padStart(10)}  grid ${String(total.grid[k]).padStart(10)}  ×${(total.grid[k] / (total.elk[k] || 1)).toFixed(2)}`);
  console.log(bad.slice(0, 30).join("\n"));
  expect(bad).toEqual([]);
}, 900_000);

void rectOf; void stack;
