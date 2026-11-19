// What a layout hint asks for, and what is drawn. The first group is hints
// that were once answered with a warning or an error and are now simply a
// layout; the second is the diagnostics that remain, each said once, with a
// fix, where the layout really cannot do what was asked.
import { describe, it, expect } from "vitest";
import { buildModel } from "../../src/model/build.js";
import { layoutView } from "../../src/layout/layout.js";
import { checkLayout } from "../invariants.js";

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

  it("a route side that is taken says so, and the edge keeps its natural side", async () => {
    // a's east wall carries the wire straight across to its row-mate c
    const r = await lay(`${fan}view v { include *
  layout { rows [a c] [b]
  route a -> b from east } }`);
    expect(r.illegal).toEqual([]);
    expect(r.diagnostics.map((d) => [d.severity, d.message])).toEqual([["warning", "`route a -> b` could not use the east side of `a` — the east side of `a` already carries a wire running straight across to a neighbour"]]);
    expect(r.diagnostics[0].fix).toContain("another row");
    expect(r.sides("a", "b")).toEqual(["south", "north"]);
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
    expect(r.diagnostics.map((d) => d.message)).toEqual(["`route a -> db` could not use the west side of `a` — the edge is drawn as part of a trunk, which shares one port"]);
    expect(r.diagnostics[0].fix).toContain("`channel`");
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

  it("a route side on a box whose edge leaves its container sideways says which way the edge leaves, or what is in the way", async () => {
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
    expect(far.diagnostics[0].fix).toContain("north or south");
    const blocked = await lay(src("east"));
    expect(blocked.illegal).toEqual([]);
    expect(blocked.diagnostics.map((d) => d.message)).toEqual(["`route s.x -> t` could not use the east side of `s.x` — another box stands between `s.x` and the east side of `s`, which the edge leaves by"]);
    expect(blocked.diagnostics[0].fix).toContain("at the east end of its row");
    // north and south are the ways over and under the row: given
    expect((await lay(src("north"))).diagnostics).toEqual([]);
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

  it("a side asked of a node carries through its container's wall, while nothing stands between", async () => {
    const r = await lay(shop("layout { rows [cache api] [svc] }", "route shop.api -> audit from east"));
    expect(r.illegal).toEqual([]);
    expect(r.diagnostics).toEqual([]);
    expect(r.sides("shop.api", "audit")[0]).toBe("east");
    expect(crosses(r, "shop", "shop.api", "audit")).toBe("east");
  });

  it("with a row-mate between it and the wall, the node keeps its side and the wire its ordinary way out", async () => {
    const r = await lay(shop("layout { rows [api cache] [svc] }", "route shop.api -> audit from east"));
    expect(r.illegal).toEqual([]);
    expect(r.diagnostics).toEqual([]);                 // the node was given the side it was asked for
    expect(r.sides("shop.api", "audit")[0]).toBe("east");
    expect(crosses(r, "shop", "shop.api", "audit")).toBe("south");
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
