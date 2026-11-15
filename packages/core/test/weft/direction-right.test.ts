// Left to right. Two questions:
//   1. does a rightward diagram read rightward — every wire out of an east
//      wall and into a west one, every column on one left edge?
//   2. are arrangements stated under a rightward flow honoured (there a
//      `rows` band is a column)?
// Whether everything we own is still legal turned on its side is
// `sets.test.ts`.
import { describe, it, expect } from "vitest";
import { buildProject } from "../../src/index.js";
import { layoutView, type Positioned } from "../../src/layout/layout.js";
import { checkLayout } from "../invariants.js";
import { column, flush, leftOf, level, row, sys, zone, view, type Ask } from "./asks.js";

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

const lay = async (name: string, src: string) => {
  const built = buildProject([{ name, src }]);
  const errs = built.diagnostics.filter((d) => d.severity === "error");
  if (errs.length) throw new Error(`${name}: ${errs[0].message}`);
  const { positioned } = await layoutView(built.model, built.model.views.find((x) => x.name === "v")!);
  return { positioned, illegal: checkLayout(positioned, { zoneMembers: new Map(built.model.zones.map((z) => [z.id, z.members])) }) };
};

describe("an acyclic diagram with nothing arranged by hand reads left to right", () => {
  for (const f of flows)
    it(f.name, async () => {
      const { positioned, illegal } = await lay(f.name, f.src);
      expect(illegal).toEqual([]);
      const r = reading(positioned);
      expect(`${r.eastToWest}/${r.wires} wires leave an east wall and enter a west one`).toBe(`${r.wires}/${r.wires} wires leave an east wall and enter a west one`);
      expect(`${r.flushColumns}/${r.columns} columns flush left`).toBe(`${r.columns}/${r.columns} columns flush left`);
    });
});

describe("arrangements stated under a rightward flow are honoured", () => {
  const uneven: string[] = [];
  for (const c of cases)
    it(c.name, async () => {
      const { positioned, illegal } = await lay(c.name, c.src);
      expect(illegal).toEqual([]);
      const missed = c.asks.filter((a) => !a.holds(positioned));
      uneven.push(...missed.filter((a) => a.polish).map((a) => `${c.name}: ${a.say}`));
      expect(missed.filter((a) => !a.polish).map((a) => a.say)).toEqual([]);
    });

  // `level` and `flush` are tidiness, not arrangement: the boxes are where
  // they were asked to be, on lines that do not quite match. One case is
  // uneven today — three zones of different heights that nobody arranged are
  // centred on the flow rather than standing on one top line — and the list
  // is spelled out so that a second one is noticed.
  it("and tidily: tops level and left edges flush, with the one exception known", () => {
    expect(uneven).toEqual(["three zones, one after another: a, b, c level"]);
  });
});
