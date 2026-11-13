// `wrap` inside containers: a container that is too wide folds its own
// members, wherever it is opened. Under ELK a view holding an expanded
// container or a zone cannot be folded at all ("wrap has no effect").
//   npx vitest run spike/grid/wrap-containers.test.ts --disable-console-intercept
import { it, expect } from "vitest";
import { buildProject } from "../../src/index.js";
import { layoutView, type Positioned } from "../../src/layout/layout.js";
import { checkLayout } from "../../test/invariants.js";
import { layoutViewBraid } from "./layout.js";

const boxes = (ids: string[], indent = "  ") => ids.map((id) => `${indent}${id} = box "${id}"`).join("\n");
const range = (p: string, n: number) => Array.from({ length: n }, (_, i) => `${p}${i + 1}`);
const view = (body: string) => `view v { include *\n${body}\n}\n`;

interface Case {
  name: string; src: string;
  /** container path or zone id → the most boxes one of its rows may hold */
  folds: Record<string, number>;
  /** the fold is the container's own: `wrap` in its layout block, not the view's */
  own?: boolean;
  right?: string[]; // containers that flow rightward: their "rows" are columns
}
export const cases: Case[] = [
  { name: "a dispatcher and nine workers, in an expanded container",
    src: `person ops "Ops"\nsystem farm "Render farm" {\n  d = box "Dispatcher"\n${boxes(range("w", 9))}\n${range("w", 9).map((w) => `  d -> ${w}`).join("\n")}\n}\nstore = box "Results"\nops -> farm.d\n${range("w", 9).map((w) => `farm.${w} -> store`).join("\n")}\n` + view("expand farm\nlayout { wrap 3 }"),
    folds: { farm: 3 } },
  { name: "a chain of eight stages, in an expanded container",
    src: `src = box "Source"\nsystem pipe "Pipeline" {\n${boxes(range("s", 8))}\n${range("s", 7).map((s, i) => `  ${s} -> s${i + 2}`).join("\n")}\n}\nsink = box "Sink"\nsrc -> pipe.s1\npipe.s8 -> sink\n` + view("expand pipe\nlayout { wrap 4 }"),
    folds: { pipe: 4 } },
  { name: "only the wide container folds; its neighbour is left alone",
    src: `system api "API" {\n  gw = box "Gateway"\n  a = box "A"\n  b = box "B"\n  gw -> a\n  gw -> b\n}\nsystem farm "Workers" {\n  q = box "Queue"\n${boxes(range("w", 8))}\n${range("w", 8).map((w) => `  q -> ${w}`).join("\n")}\n  layout { wrap 4 }\n}\napi.a -> farm.q\napi.b -> farm.q\n` + view("expand api, farm"),
    own: true, folds: { farm: 4 } },
  { name: "ten stores in a zone, one service reading them all",
    src: `svc = box "Service"\n${boxes(range("db", 10), "")}\n${range("db", 10).map((d) => `svc -> ${d}`).join("\n")}\nzone data "Data tier" vpc { contains ${range("db", 10).join(", ")} }\n` + view("layout { wrap 5 }"),
    folds: { data: 5 } },
  { name: "two inputs, eight handlers, one output — inside a container",
    src: `system etl "ETL" {\n  in1 = box "Feed A"\n  in2 = box "Feed B"\n${boxes(range("h", 8))}\n  out = box "Warehouse"\n${range("h", 8).map((h, i) => `  in${(i % 2) + 1} -> ${h}\n  ${h} -> out`).join("\n")}\n}\nbi = box "Dashboards"\netl.out -> bi\n` + view("expand etl\nlayout { wrap 4 }"),
    folds: { etl: 4 } },
  { name: "outside callers reach into a folded container",
    src: `${boxes(["web", "mobile", "partner"], "")}\nsystem svc "Services" {\n${boxes(range("s", 8))}\n}\nweb -> svc.s1\nweb -> svc.s5\nmobile -> svc.s2\nmobile -> svc.s7\npartner -> svc.s8\npartner -> svc.s3\ndb = box "Database"\n${range("s", 8).map((s) => `svc.${s} -> db`).join("\n")}\n` + view("expand svc\nlayout { wrap 4 }"),
    folds: { svc: 4 } },
  { name: "a folded container beside an ordinary one, in zones side by side",
    src: `system edge "Edge" {\n  cdn = box "CDN"\n  waf = box "WAF"\n  cdn -> waf\n}\nsystem fleet "Fleet" {\n  lb = box "Balancer"\n${boxes(range("n", 8))}\n${range("n", 8).map((n) => `  lb -> ${n}`).join("\n")}\n  layout { wrap 4 }\n}\nedge.waf -> fleet.lb\nzone a "Public" vpc { contains edge }\nzone b "Private" vpc { contains fleet }\n` + view("expand edge, fleet\nlayout { rows [edge fleet] }"),
    own: true, folds: { fleet: 4 } },
  { name: "wide inside wide: a platform of seven teams, one of them with eight services",
    src: `system plat "Platform" {\n${range("t", 6).map((t) => `  ${t} = box "Team ${t}"`).join("\n")}\n  container big "Core team" {\n${boxes(range("c", 8), "    ")}\n  }\n  hub = box "Portal"\n${range("t", 6).map((t) => `  hub -> ${t}`).join("\n")}\n  hub -> big.c1\n  hub -> big.c5\n}\n` + view("expand *\nlayout { wrap 4 }"),
    folds: { plat: 4, "plat.big": 4 } },
  { name: "a rightward container folds into columns",
    src: `system line "Assembly line" {\n  start = box "Intake"\n${boxes(range("st", 9))}\n${range("st", 9).map((s) => `  start -> ${s}`).join("\n")}\n  layout { direction right }\n}\n` + view("expand line\nlayout { wrap 3 }"),
    folds: { line: 3 }, right: ["line"] },
  { name: "a view standing inside a wide container, with its surroundings",
    src: `caller = box "Caller"\nsystem farm "Workers" {\n  q = box "Queue"\n${boxes(range("w", 10))}\n${range("w", 10).map((w) => `  q -> ${w}`).join("\n")}\n}\nstore = box "Store"\ncaller -> farm.q\nfarm.w3 -> store\nfarm.w8 -> store\nview v { scope farm\n  layout { wrap 5 }\n}\n`,
    folds: { "": 5 } },
];

type R = { x: number; y: number; w: number; h: number };
/** The most direct members of `container` that share one row (one column, if it flows right). */
function widestRow(p: Positioned, container: string, built: ReturnType<typeof buildProject>, right: boolean): number {
  const zone = built.model.zones.find((z) => z.id === container);
  const members: R[] = zone
    ? p.nodes.filter((n) => zone.members.includes(n.path))
    : container === ""
      ? p.nodes.filter((n) => !n.frame && n.kind !== "context-card" && n.kind !== "context-leaf")
      : [...p.nodes.filter((n) => n.frame === container), ...p.frames.filter((f) => f.path.startsWith(container + ".") && !f.path.slice(container.length + 1).includes("."))];
  const rows = new Map<number, number>();
  for (const m of members) rows.set(right ? m.x : m.y, (rows.get(right ? m.x : m.y) ?? 0) + 1);
  return Math.max(0, ...rows.values());
}

it("wrap folds containers: no row holds more than was asked", async () => {
  const bad: string[] = [];
  let elkFolded = 0, gridFolded = 0, asks = 0;
  console.log(`${"case".padEnd(70)} ELK canvas   grid canvas  widest row ELK/grid/asked`);
  for (const c of cases) {
    const built = buildProject([{ name: c.name, src: c.src }]);
    const errs = built.diagnostics.filter((d) => d.severity === "error");
    if (errs.length) throw new Error(`${c.name}: ${errs[0].message}`);
    const v = built.model.views.find((x) => x.name === "v")!;
    const elk = await layoutView(built.model, v);
    const grid = layoutViewBraid(built.model, v).positioned;
    const strict = { ...grid, edges: grid.edges.map((e) => ({ ...e, coplanar: true as const })) };
    const trunks = new Set(grid.edges.filter((e) => e.via === "bus").map((e) => e.to));
    bad.push(...checkLayout(strict, { channelTargets: trunks, zoneMembers: new Map(built.model.zones.map((z) => [z.id, z.members])) }).map((b) => `${c.name}: ${b}`));
    const rows = Object.entries(c.folds).map(([container, n]) => {
      const right = !!c.right?.includes(container);
      const e = widestRow(elk.positioned, container, built, right), g = widestRow(grid, container, built, right);
      asks++; if (e <= n) elkFolded++; if (g <= n) gridFolded++;
      if (g > n) bad.push(`${c.name}: ${container || "the view"} has a row of ${g}, asked for ${n}`);
      return `${e}/${g}/${n}`;
    });
    const warn = elk.diagnostics.filter((d) => /wrap/.test(d.message)).length;
    console.log(`${c.name.padEnd(70)} ${`${elk.positioned.width}×${elk.positioned.height}`.padEnd(12)} ${`${grid.width}×${grid.height}`.padEnd(12)} ${rows.join("  ")}${warn ? "   ELK: wrap has no effect" : ""}`);
  }
  console.log(`\nfolded as asked: ELK ${elkFolded}/${asks} · grid ${gridFolded}/${asks}`);
  console.log(bad.join("\n"));
  expect(bad).toEqual([]);
}, 300_000);
