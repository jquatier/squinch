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
    expect(r.diagnostics.map((d) => [d.severity, d.message])).toEqual([["warning", "`route a -> b` could not use the side it asks for here"]]);
    expect(r.diagnostics[0].fix).toBeTruthy();
    expect(r.sides("a", "b")).toEqual(["south", "north"]);
  });

  it("`wrap` with nothing to fold says so", async () => {
    const r = await lay(`${fan}view v { include *
  layout { wrap 3 } }`);
    expect(r.diagnostics.map((d) => [d.severity, d.message])).toEqual([["warning", "`wrap 3` has no effect — no row here is wider than 3"]]);
  });

  // KNOWN BREAK, recorded rather than hidden. Two nodes on one rank cannot
  // share an axis, and the promise is a warning that says so with the nodes
  // left where they were. What happens: the axis is honoured literally — the
  // nodes are drawn on top of each other, with no diagnostic. The same for
  // `cols [b c]`, under `direction right`, with three nodes, and with no
  // edges at all (`b = box "B"; c = box "C"; view v { layout { align b c } }`).
  // Delete the `.fails` when the warning is back and nothing overlaps.
  it.fails("`align` between two nodes of one rank warns, and nothing overlaps", async () => {
    const r = await lay(`${fan}view v { include *
  layout { align b c } }`);
    expect(r.illegal).toEqual([]);
    expect(r.diagnostics.map((d) => d.message)).toEqual([expect.stringContaining("all 2 sit on the same rank, so they cannot share an axis")]);
  });

  it.fails("`cols` putting two nodes of one rank in one column warns, and nothing overlaps", async () => {
    const r = await lay(`${fan}view v { include *
  layout { cols [b c] } }`);
    expect(r.illegal).toEqual([]);
    expect(r.diagnostics.map((d) => d.message)).toEqual([expect.stringContaining("all 2 sit on the same rank, so they cannot share an axis")]);
  });

  // KNOWN BREAK, the same one across containers. `align` naming members of
  // two containers that share a row is promised a warning ("could not be put
  // on `s.x`'s axis"). What happens: the two frames are drawn on top of each
  // other, every member overlapping its counterpart, with no diagnostic.
  it.fails("`align` across two containers on one row warns, and nothing overlaps", async () => {
    const r = await lay(`system s "S" { x = box "X"; y = box "Y"; x -> y }
system t "T" { p = box "P"; q = box "Q"; p -> q }
s.y -> t.p
view v { expand *
  layout { rows [s t]
  align s.x t.p } }`);
    expect(r.illegal).toEqual([]);
    expect(r.diagnostics.map((d) => d.message)).toEqual([expect.stringContaining("could not be put on `s.x`'s axis")]);
  });

  // a side is a leaf's wall: an expanded container has none to give, and says so
  it("a route side on an edge that ends at a container says it could not be used", async () => {
    const r = await lay(`system s "S" { x = box "X" }
b = box "B"
s -> b
view v { expand s
  layout { route s -> b from east } }`);
    expect(r.illegal).toEqual([]);
    expect(r.diagnostics.map((d) => d.message)).toEqual(["`route s -> b` could not use the side it asks for here"]);
  });
});
