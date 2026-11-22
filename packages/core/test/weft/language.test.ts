// What a layout hint asks for, and what is drawn. The first group is hints
// that were once answered with a warning or an error and are now simply a
// layout; the second is the diagnostics that remain, each said once, with a
// fix, where the layout really cannot do what was asked.
import { describe, it, expect } from "vitest";
import { buildModel } from "../../src/model/build.js";
import { layoutView } from "../../src/layout/layout.js";
import { checkLayout } from "../invariants.js";
import { measureLayout } from "./metrics.js";

/** `trunkTargets`: boxes where a trunk arrives on one shared port by design. */
const lay = async (src: string, trunkTargets: string[] = []) => {
  const built = buildModel(src);
  expect(built.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  const view = built.model.views.find((v) => v.name === "v")!;
  const { positioned: p, diagnostics } = await layoutView(built.model, view);
  const at = (path: string) => p.nodes.find((n) => n.path === path)!;
  return {
    p, diagnostics, at,
    illegal: checkLayout(p, { channelTargets: new Set(trunkTargets), zoneMembers: new Map(built.model.zones.map((z) => [z.id, z.members])) }),
    y: (path: string) => at(path).y,
    mid: (path: string) => at(path).x + Math.round(at(path).w / 2),
    wire: (from: string, to: string) => p.edges.find((e) => e.from === from && e.to === to)!,
    sides: (from: string, to: string) => {
      const e = p.edges.find((x) => x.from === from && x.to === to)!;
      return [p.ports.find((pt) => pt.edge === e.id && pt.node === from)!.side, p.ports.find((pt) => pt.edge === e.id && pt.node === to)!.side];
    },
  };
};

describe("hints that are simply honoured", () => {
  it("keeps a band whole around an unlisted bus", async () => {
    const r = await lay(`a = box "A"
b = box "B"
c = box "C"
d = box "D"
bus = box "Bus"
a ~> bus
b ~> bus
bus ~> c
bus ~> d
view v { include *
  layout { rows [a b c d] } }`);
    expect(r.diagnostics).toEqual([]);
    expect(r.illegal).toEqual([]);
    expect(new Set(["a", "b", "c", "d"].map(r.y)).size).toBe(1);
    expect(r.y("bus")).toBeGreaterThan(r.y("a"));
  });

  it("draws an edge between two row-mates inside an expanded container", async () => {
    const r = await lay(`system s "S" {
  a = box "A"
  b = box "B"
  c = box "C"
  a -> b
  b -> c
}
view v { expand s
  layout { rows [s.a s.b] [s.c] } }`);
    expect(r.diagnostics).toEqual([]);
    expect(r.illegal).toEqual([]);
    expect(r.y("s.a")).toBe(r.y("s.b"));
    expect(r.wire("s.a", "s.b").points).toHaveLength(2);
  });

  it("draws an edge that runs upward between two declared rows", async () => {
    const r = await lay(`a = box "A"
b = box "B"
c = box "C"
a -> b
b -> c
c -> a "feedback"
view v { include *
  layout { rows [a] [b] [c] } }`);
    expect(r.diagnostics).toEqual([]);
    expect(r.illegal).toEqual([]);
    const wire = r.wire("c", "a");
    const first = wire.points[0], last = wire.points[wire.points.length - 1];
    expect(first.y).toBe(r.at("c").y);                   // leaves the top of the lower box
    expect(last.y).toBe(r.at("a").y + r.at("a").h);      // enters the bottom of the upper one
    expect(wire.labelRect).toBeDefined();
  });

  it("folds any over-wide row with `wrap`, not only a chain or a fan-out", async () => {
    const workers = Array.from({ length: 8 }, (_, i) => `w${i}`);
    const r = await lay(`a = box "A"
b = box "B"
${workers.map((w) => `${w} = box "${w}"`).join("\n")}
sink = box "Sink"
${workers.map((w, i) => `${i % 2 ? "a" : "b"} -> ${w}\n${w} -> sink`).join("\n")}
view v { include *
  layout { wrap 4 } }`, ["sink"]);
    expect(r.diagnostics).toEqual([]);
    expect(r.illegal).toEqual([]);
    expect(new Set(workers.map(r.y)).size).toBe(2);                    // eight workers, two rows of four
    expect(Math.max(...r.p.nodes.map((n) => n.x + n.w)) - Math.min(...r.p.nodes.map((n) => n.x))).toBeLessThan(1200); // eight in a row would be 1296
  });

  it("applies rank hints between the members of one zone", async () => {
    const r = await lay(`a = box "A"
b = box "B"
c = box "C"
a -> b
a -> c
zone z "Z" custom { contains a, b, c }
view v { include *
  layout { rows [a b] [c] } }`);
    expect(r.diagnostics).toEqual([]);
    expect(r.illegal).toEqual([]);
    expect(r.y("a")).toBe(r.y("b"));
    expect(r.y("c")).toBeGreaterThan(r.y("a"));
  });

  it("places a zone named by its id", async () => {
    const r = await lay(`a = box "A"
b = box "B"
c = box "C"
c -> a
zone z "Z" custom { contains a, b }
view v { include *
  layout { rows [z c] } }`);
    expect(r.diagnostics).toEqual([]);
    expect(r.illegal).toEqual([]);
    const z = r.p.zones[0];
    expect(z.x + z.w).toBeLessThanOrEqual(r.at("c").x);
    expect(r.at("c").y).toBeLessThan(z.y + z.h);
  });

  it("`route … from <side> to <side>` picks the walls of an edge that spans ranks", async () => {
    const src = (route: string) => `a = box "A"
b = box "B"
a -> b
view v { include *
  layout { rows [a] [b]
  ${route} } }`;
    expect((await lay(src(""))).sides("a", "b")).toEqual(["south", "north"]);
    const east = await lay(src("route a -> b from east"));
    expect(east.diagnostics).toEqual([]);
    expect(east.illegal).toEqual([]);
    expect(east.sides("a", "b")).toEqual(["east", "north"]);
    const both = await lay(src("route a -> b from east to west"));
    expect(both.diagnostics).toEqual([]);
    expect(both.illegal).toEqual([]);
    expect(both.sides("a", "b")).toEqual(["east", "west"]);
  });
});

describe("what the layout cannot do, it says", () => {
  const fan = `a = box "A"
b = box "B"
c = box "C"
a -> b
a -> c
`;

  it("route sides on an edge between two row-mates are ignored, with a warning", async () => {
    const r = await lay(`${fan}b -> c
view v { include *
  layout { rows [a] [b c]
  route b -> c from south to south } }`);
    expect(r.illegal).toEqual([]);
    expect(r.diagnostics.map((d) => [d.severity, d.message])).toEqual([["warning", "`route b -> c` sides are ignored — it is a same-rank edge"]]);
    expect(r.diagnostics[0].fix).toBeTruthy();
    expect(r.wire("b", "c").points).toHaveLength(2); // still drawn, straight across
  });

  // a side wall takes any number of wires: a side that already carries one to a neighbour is given all the same
  it("a route side shares the wall with a wire straight across to a neighbour", async () => {
    const r = await lay(`${fan}view v { include *
  layout { rows [a c] [b]
  route a -> b from east } }`);
    expect(r.illegal).toEqual([]);
    expect(r.diagnostics).toEqual([]);
    expect(r.sides("a", "b")).toEqual(["east", "north"]);
  });

  // …and out of the top, round a side that carries one: the wire it crosses there is the price, and nothing is refused
  it("a route out of the north side goes round a side that carries a wire, when both do", async () => {
    const r = await lay(`l = box "L"
a = box "A"
r = box "R"
c = box "C"
l -> a
a -> r
a -> c
view v { include *
  layout { rows [l a r] [c]
  route a -> c from north } }`);
    expect(r.illegal).toEqual([]);
    expect(r.diagnostics).toEqual([]);
    expect(r.sides("a", "c")[0]).toBe("north");
  });

  // one edge may have a line for each end
  it("two route lines for one edge each ask their own end, and two for one end are an error", async () => {
    const src = (routes: string) => `l = box "L"
a = box "A"
r = box "R"
c = box "C"
l -> a
a -> r
a -> c
view v { include *
  layout { rows [l a r] [c]
  ${routes} } }`;
    const each = await lay(src("route a -> c from east\n  route a -> c to west"));
    expect(each.illegal).toEqual([]);
    expect(each.diagnostics).toEqual([]);
    expect(each.sides("a", "c")).toEqual(["east", "west"]);
    const built = buildModel(src("route a -> c from east\n  route a -> c from west"));
    const { diagnostics } = await layoutView(built.model, built.model.views.find((v) => v.name === "v")!);
    expect(diagnostics.filter((d) => d.severity === "error").map((d) => d.message)).toEqual(["`route a -> c` asks `a` for its west side, and another `route` line asks it for its east"]);
  });

  // each cause has its own sentence, naming the box and the side, and its own fix
  it("a route side on an edge of a `channel` says the edge is part of a trunk", async () => {
    const r = await lay(`a = box "A"
b = box "B"
db = box "DB"
a -> db
b -> db
view v { include *
  layout { rows [a b] [db]
  channel a, b -> db
  route a -> db from west } }`, ["db"]);
    expect(r.illegal).toEqual([]);
    expect(r.diagnostics.map((d) => d.message)).toEqual(["`route a -> db` could not use the west side of `a` — the edge is drawn in a `channel` trunk, whose wires share one port"]);
    expect(r.diagnostics[0].fix).toContain("out of the `channel`");
  });

  it("a route side on a box beside the container the other end is in says they share a row", async () => {
    const r = await lay(`u = box "U"
system s "S" { x = box "X"; y = box "Y"; x -> y }
u -> s.x
view v { expand s
  layout { rows [u s]
  route u -> s.x from south } }`);
    expect(r.illegal).toEqual([]);
    expect(r.diagnostics.map((d) => d.message)).toEqual(["`route u -> s.x` could not use the south side of `u` — `u` is in the same row as `s`, which holds the other end, so the edge runs straight across"]);
    expect(r.diagnostics[0].fix).toContain("another row");
  });

  // the same for an edge that ends at an open container beside the one its other end is in (it was dropped in silence),
  // and beside a zone, which is named by its own id
  it("a route side on a container, or beside a zone, that shares a row with what holds the other end says so", async () => {
    const frames = await lay(`system s "S" { a = box "A"; b = box "B"; a -> b }
system o "O" { x = box "X"; y = box "Y"; x -> y }
s -> o.x
view v { expand s, o
  layout { rows [s o]
  route s -> o.x from south } }`);
    expect(frames.illegal).toEqual([]);
    expect(frames.diagnostics.map((d) => d.message)).toEqual(["`route s -> o.x` could not use the south side of `s` — `s` is in the same row as `o`, which holds the other end, so the edge runs straight across"]);
    const zone = await lay(`u = box "U"
x = box "X"
y = box "Y"
x -> y
u -> x
zone vpc "VPC" { contains x, y }
view v { include *
  layout { rows [u vpc]
  route u -> x from south } }`);
    expect(zone.illegal).toEqual([]);
    expect(zone.diagnostics.map((d) => d.message)).toEqual(["`route u -> x` could not use the south side of `u` — `u` is in the same row as `vpc`, which holds the other end, so the edge runs straight across"]);
  });

  it("a route side facing away from where the edge leaves its container says which way that is; with a row-mate in the way it is given", async () => {
    const src = (side: string) => `system s "S" { x = box "X"; y = box "Y"
  layout { rows [x y] } }
t = box "T"
s.x -> t
view v { expand s
  layout { rows [s t]
  route s.x -> t from ${side} } }`;
    const far = await lay(src("west"));
    expect(far.illegal).toEqual([]);
    expect(far.diagnostics.map((d) => d.message)).toEqual(["`route s.x -> t` could not use the west side of `s.x` — the edge leaves `s` by its east side, the other way"]);
    expect(far.diagnostics[0].fix).toBe("drop the `from`, or ask for east, north or south");
    // east, with Y standing between X and the wall: out of X's east side, round Y, out of the frame's east wall
    const past = await lay(src("east"));
    expect(past.illegal).toEqual([]);
    expect(past.diagnostics).toEqual([]);
    expect(past.sides("s.x", "t")[0]).toBe("east");
    // north and south are the ways over and under the row: given
    expect((await lay(src("north"))).diagnostics).toEqual([]);
  });

  // in a view that flows rightward a row stands upright: the ways over and under it are west and east, and the fix says so
  it("the fix for a side refused in a rightward view names the sides that are given there", async () => {
    const src = (side: string) => `system s "S" { x = box "X"; y = box "Y"
  layout { rows [x y] } }
t = box "T"
s.x -> t
view v { expand s
  layout { direction right
  rows [s t]
  route s.x -> t from ${side} } }`;
    const far = await lay(src("north"));
    expect(far.diagnostics.map((d) => d.message)).toEqual(["`route s.x -> t` could not use the north side of `s.x` — the edge leaves `s` by its south side, the other way"]);
    expect(far.diagnostics[0].fix).toBe("drop the `from`, or ask for south, west or east");
    expect((await lay(src("east"))).diagnostics).toEqual([]);
    expect((await lay(src("west"))).diagnostics).toEqual([]);
  });

  // a side belongs to the keyword before it (it used to be read by position: `to west` alone turned the *from* end)
  it("`to <side>` alone is the side the edge enters by", async () => {
    const r = await lay(`${fan}view v { include *
  layout { route a -> b to west } }`);
    expect(r.illegal).toEqual([]);
    expect(r.diagnostics).toEqual([]);
    expect(r.sides("a", "b")).toEqual(["south", "west"]);
  });

  // A route names an edge as the view draws it. Collapsed, the edge is drawn
  // from the container's card; opened, from the node inside. A line written
  // for the other altitude names nothing — and says which spelling this view needs.
  it("a route that names no edge drawn in the view says how the view draws it", async () => {
    const src = (view: string) => `system s "S" { x = box "X" }
b = box "B"
s.x -> b
view v { ${view} }`;
    const shut = await lay(src("include *\n  layout { route s.x -> b from east }"));
    expect(shut.diagnostics.map((d) => [d.severity, d.message])).toEqual([["warning", "`route s.x -> b` names no edge drawn in this view"]]);
    expect(shut.diagnostics[0].fix).toBe("`s` is collapsed here, so the edge is drawn as `s -> b` — write `route s -> b from east`");
    const open = await lay(src("expand s\n  layout { route s -> b from east }"));
    expect(open.diagnostics.map((d) => d.message)).toEqual(["`route s -> b` names no edge drawn in this view"]);
    expect(open.diagnostics[0].fix).toBe("`s` is open here, so the edge is drawn as `s.x -> b` — write `route s.x -> b from east`");
    // …and each spelling is silent where it is the right one
    expect((await lay(src("include *\n  layout { route s -> b from east }"))).diagnostics).toEqual([]);
    expect((await lay(src("expand s\n  layout { route s.x -> b from east }"))).diagnostics).toEqual([]);
  });

  it("…and why, read off the view: an end left out of an open container is not called collapsed", async () => {
    const r = await lay(`system s "S" { x = box "X"; y = box "Y" }
b = box "B"
s.y -> b
view v { expand s
  exclude s.y
  layout { route s.y -> b from east } }`);
    expect(r.diagnostics.map((d) => d.fix)).toEqual(["`s.y` is not drawn in this view, so its edge runs from `s`, so the edge is drawn as `s -> b` — write `route s -> b from east`"]);
  });

  it("…with the label the line named, the edge's own arrow, and its own direction", async () => {
    const twins = `system s "S" { x = box "X"; y = box "Y" }
b = box "B"
s.x -> b "read"
s.y -> b "write"
`;
    // the label says which of two edges: the fix writes that one
    const labelled = await lay(`${twins}view v { expand s
  layout { route s -> b "write" from east } }`);
    expect(labelled.diagnostics.map((d) => d.fix)).toEqual(["`s` is open here, so the edge is drawn as `s.y -> b` — write `route s.y -> b from east`"]);
    // collapsed, the two are one edge with a count: there is no label to name
    const merged = await lay(`${twins}view v { include *
  layout { route s -> b "write" from east } }`);
    expect(merged.diagnostics.map((d) => d.fix)).toEqual(["the one edge between them here stands for 2 edges merged into one — drop the label from this line"]);
    // written against the edge's direction, and for an edge with no arrowhead
    const back = await lay(`a = box "A"
b = box "B"
c = box "C"
a -> b
b -- c
view v { include *
  layout { rows [a] [b] [c]
  route b -> a from north to south
  route c -- b from north } }`);
    expect(back.diagnostics.map((d) => d.fix)).toEqual([
      "the edge between them runs from `a` to `b`, and a route names an edge in its own direction — write `route a -> b from south to north`",
      "the edge between them runs from `b` to `c`, and a route names an edge in its own direction — write `route b -- c to north`",
    ]);
    // a line that asks for no side does nothing anywhere
    const idle = await lay(`${twins}view v { include *
  layout { route s.x -> b } }`);
    expect(idle.diagnostics.map((d) => d.fix)).toEqual(["the line asks for no side, so it does nothing anywhere — drop it"]);
  });

  // `from` and `to` in either order (SPEC §8); one of each
  it("`to` may come before `from`, and a second `from` is an error", async () => {
    const r = await lay(`${fan}view v { include *
  layout { route a -> b to west from east } }`);
    expect(r.diagnostics).toEqual([]);
    expect(r.sides("a", "b")).toEqual(["east", "west"]);
    const twice = buildModel(`${fan}view v { include *
  layout { route a -> b from east from west } }`);
    expect(twice.diagnostics.filter((d) => d.severity === "error").map((d) => d.message)).toEqual(["`route` gives two `from` sides"]);
  });

  it("`wrap` with nothing to fold says so", async () => {
    const r = await lay(`${fan}view v { include *
  layout { wrap 3 } }`);
    expect(r.diagnostics.map((d) => [d.severity, d.message])).toEqual([["warning", "`wrap 3` has no effect — no row here is wider than 3"]]);
  });

  // Two nodes on one rank cannot share an axis: the hint is left out for the
  // second, both stay side by side, and a warning says so. (Honoured
  // literally, the axis draws one node on top of the other.) The same for
  // `cols [b c]`, under `direction right`, with three nodes, and with no
  // edges at all.
  it("`align` between two nodes of one rank warns, and nothing overlaps", async () => {
    const r = await lay(`${fan}view v { include *
  layout { align b c } }`);
    expect(r.illegal).toEqual([]);
    expect(r.diagnostics.map((d) => d.message)).toEqual([expect.stringContaining("all 2 sit on the same rank, so they cannot share an axis")]);
  });

  it("`cols` putting two nodes of one rank in one column warns, and nothing overlaps", async () => {
    const r = await lay(`${fan}view v { include *
  layout { cols [b c] } }`);
    expect(r.illegal).toEqual([]);
    expect(r.diagnostics.map((d) => d.message)).toEqual([expect.stringContaining("all 2 sit on the same rank, so they cannot share an axis")]);
  });

  // …and across two containers that share a row: the frames stay apart.
  it("`align` across two containers on one row warns, and nothing overlaps", async () => {
    const r = await lay(`system s "S" { x = box "X"; y = box "Y"; x -> y }
system t "T" { p = box "P"; q = box "Q"; p -> q }
s.y -> t.p
view v { expand *
  layout { rows [s t]
  align s.x t.p } }`);
    expect(r.illegal).toEqual([]);
    expect(r.diagnostics.map((d) => d.message)).toEqual([expect.stringContaining("could not be put on `s.x`'s axis")]);
  });

  // ── a side carries on through the walls of the containers around the box ──
  /** The side of frame `path` the wire crosses on its way out of (or into) it. */
  const crosses = (r: Awaited<ReturnType<typeof lay>>, path: string, from: string, to: string) => {
    const f = r.p.frames.find((x) => x.path === path)!, pts = r.wire(from, to).points;
    const inside = (q: { x: number; y: number }) => q.x > f.x && q.x < f.x + f.w && q.y > f.y && q.y < f.y + f.h;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [a, b] = inside(pts[i]) ? [pts[i], pts[i + 1]] : [pts[i + 1], pts[i]];
      if (inside(a) && !inside(b)) return b.x >= f.x + f.w ? "east" : b.x <= f.x ? "west" : b.y <= f.y ? "north" : "south";
    }
    return undefined;
  };
  const shop = (inside: string, route: string) => `system shop "Shop" { api = box "API"; svc = box "Orders"; cache = box "Cache"
  api -> svc
  ${inside} }
db = box "DB"
audit = box "Audit"
shop.svc -> db
shop.api -> audit
view v { expand shop
  layout { rows [shop] [db audit]
  ${route} } }`;

  it("a side asked of a node carries through its container's wall", async () => {
    const r = await lay(shop("layout { rows [cache api] [svc] }", "route shop.api -> audit from east"));
    expect(r.illegal).toEqual([]);
    expect(r.diagnostics).toEqual([]);
    expect(r.sides("shop.api", "audit")[0]).toBe("east");
    expect(crosses(r, "shop", "shop.api", "audit")).toBe("east");
  });

  it("with a row-mate between it and the wall, the wire leaves the node by that side all the same, goes round, and out of the frame's wall", async () => {
    const r = await lay(shop("layout { rows [api cache] [svc] }", "route shop.api -> audit from east"));
    expect(r.illegal).toEqual([]);
    expect(r.diagnostics).toEqual([]);
    expect(r.sides("shop.api", "audit")[0]).toBe("east");
    expect(crosses(r, "shop", "shop.api", "audit")).toBe("east");
  });

  it("two edges asked out of one side of a node both leave by it — one through the frame's wall, one to a node inside", async () => {
    const r = await lay(`system shop "Shop" { api = box "API"; db = box "DB"; api -> db }
audit = box "Audit"
shop.api -> audit
view v { expand shop
  layout { route shop.api -> audit from west
  route shop.api -> shop.db from west } }`);
    expect(r.illegal).toEqual([]);
    expect(r.diagnostics).toEqual([]);
    expect(r.sides("shop.api", "audit")[0]).toBe("west");
    expect(r.sides("shop.api", "shop.db")[0]).toBe("west");
    expect(crosses(r, "shop", "shop.api", "audit")).toBe("west");
  });

  // several edges out of one side of a node do not cross one another (`sides.ts`; `sideLanes` and the
  // nesting of a north or south wall's hooks in lay.ts)
  it("several edges asked out of one north side of a node nest, and cross nothing", async () => {
    for (const routes of [["b", "c"], ["b", "c", "d"]]) {
      const r = await lay(`a = box "A"
b = box "B"
c = box "C"
d = box "D"
a -> b
a -> c
a -> d
b -> c
view v { layout {
${routes.map((t) => `  route a -> ${t} from north`).join("\n")} } }`);
      expect(r.illegal).toEqual([]);
      expect(r.diagnostics).toEqual([]);
      for (const t of routes) expect(r.sides("a", t)[0]).toBe("north");
      expect(measureLayout(r.p).crossings, `${routes}`).toBe(0);
    }
  });

  it("several edges carried past a row-mate and out of the frame's side leave it in the order their targets stand", async () => {
    for (const order of ["d0 d1", "d1 d0", "d2 d0 d1"]) {
      const targets = order.split(" ");
      const r = await lay(`system s "S" {
  hub  = box "Hub"
  mate = box "Mate"
  layout { rows [hub mate] }
}
${targets.map((t) => `${t} = box "${t}"`).join("\n")}
${[...targets].sort().map((t) => `s.hub -> ${t}`).join("\n")}
view v { expand s
  layout { rows [s] [${order}]
${[...targets].sort().map((t) => `  route s.hub -> ${t} from east`).join("\n")} } }`);
      expect(r.illegal).toEqual([]);
      expect(r.diagnostics).toEqual([]);
      for (const t of targets) expect([r.sides("s.hub", t)[0], crosses(r, "s", "s.hub", t)]).toEqual(["east", "east"]);
      expect(measureLayout(r.p).crossings, order).toBe(0);
    }
  });

  it("a side asked of an edge that ends at an expanded container is that frame's wall", async () => {
    const r = await lay(`system s "S" { x = box "X" }
b = box "B"
s -> b
view v { expand s
  layout { route s -> b from east } }`);
    expect(r.illegal).toEqual([]);
    expect(r.diagnostics).toEqual([]);
    const f = r.p.frames.find((x) => x.path === "s")!, start = r.wire("s", "b").points[0];
    expect(start.x).toBe(f.x + f.w);
  });

  it("a side carries through a zone's wall too", async () => {
    const r = await lay(`api = box "API"
svc = box "Orders"
audit = box "Audit"
api -> svc
api -> audit
zone vpc "VPC" { contains api, svc }
view v { include *
  layout { route api -> audit from east } }`);
    expect(r.illegal).toEqual([]);
    expect(r.diagnostics).toEqual([]);
    const z = r.p.zones.find((x) => x.id === "vpc")!, pts = r.wire("api", "audit").points;
    expect(r.sides("api", "audit")[0]).toBe("east");
    // the wire leaves the zone through its east wall: some horizontal stretch crosses it
    expect(pts.some((q, i) => i > 0 && q.y === pts[i - 1].y && Math.min(q.x, pts[i - 1].x) < z.x + z.w && Math.max(q.x, pts[i - 1].x) > z.x + z.w)).toBe(true);
  });
});
