// Three things the language says and the ELK engine answers with a warning
// or an error. In the grid engine each is simply a layout — the reason is the
// same for all three: a rank is a constraint the engine owns, not a
// suggestion handed to someone else.
import { describe, it, expect } from "vitest";
import { buildModel } from "../../src/model/build.js";
import { layoutView } from "../../src/layout/layout.js";
import { checkLayout } from "../../test/invariants.js";
import { layoutViewBraid } from "./layout.js";

/** `trunkTargets`: boxes where a trunk arrives on one shared port by design. */
const both = async (src: string, trunkTargets: string[] = []) => {
  const built = buildModel(src);
  expect(built.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  const view = built.model.views.find((v) => v.name === "v")!;
  const grid = layoutViewBraid(built.model, view).positioned;
  expect(checkLayout(grid, { channelTargets: new Set(trunkTargets) })).toEqual([]);
  return { elk: await layoutView(built.model, view), grid, y: (p: string) => grid.nodes.find((n) => n.path === p)!.y };
};

describe("hints the grid engine honours and ELK cannot", () => {
  it("keeps a band whole around an unlisted bus", async () => {
    const { elk, y } = await both(`a = box "A"
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
    expect(elk.diagnostics.some((d) => d.severity === "error")).toBe(true); // "a band the layouter could not keep"
    expect(new Set(["a", "b", "c", "d"].map(y)).size).toBe(1);
    expect(y("bus")).toBeGreaterThan(y("a"));
  });

  it("routes an edge between two row-mates inside an expanded container", async () => {
    const { elk, grid, y } = await both(`system s "S" {
  a = box "A"
  b = box "B"
  c = box "C"
  a -> b
  b -> c
}
view v { expand s
  layout { rows [s.a s.b] [s.c] } }`);
    expect(elk.diagnostics.some((d) => /cannot be routed there/.test(d.message))).toBe(true);
    expect(y("s.a")).toBe(y("s.b"));
    const wire = grid.edges.find((e) => e.from === "s.a" && e.to === "s.b")!;
    expect(wire.points).toHaveLength(2);
  });

  it("draws an edge that runs upward between two declared rows", async () => {
    const { elk, grid } = await both(`a = box "A"
b = box "B"
c = box "C"
a -> b
b -> c
c -> a "feedback"
view v { include *
  layout { rows [a] [b] [c] } }`);
    expect(elk.diagnostics.some((d) => d.severity === "error" && /runs upward/.test(d.message))).toBe(true);
    const rect = (p: string) => grid.nodes.find((n) => n.path === p)!;
    const wire = grid.edges.find((e) => e.from === "c" && e.to === "a")!;
    const first = wire.points[0], last = wire.points[wire.points.length - 1];
    expect(first.y).toBe(rect("c").y);                 // leaves the top of the lower box
    expect(last.y).toBe(rect("a").y + rect("a").h);    // enters the bottom of the upper one
    expect(wire.labelRect).toBeDefined();
  });

  it("folds any over-wide row with `wrap`, not only a chain or a fan-out", async () => {
    const workers = Array.from({ length: 8 }, (_, i) => `w${i}`);
    const { elk, grid, y } = await both(`a = box "A"
b = box "B"
${workers.map((w) => `${w} = box "${w}"`).join("\n")}
sink = box "Sink"
${workers.map((w, i) => `${i % 2 ? "a" : "b"} -> ${w}\n${w} -> sink`).join("\n")}
view v { include *
  layout { wrap 4 } }`, ["sink"]);
    expect(elk.diagnostics.some((d) => /wrap 4. has no effect/.test(d.message))).toBe(true);
    expect(new Set(workers.map(y)).size).toBe(2);                    // eight workers, two rows of four
    expect(Math.max(...grid.nodes.map((n) => n.x + n.w)) - Math.min(...grid.nodes.map((n) => n.x))).toBeLessThan(1200); // eight in a row would be 1296
  });

  it("applies rank hints between the members of one zone", async () => {
    const { elk, y } = await both(`a = box "A"
b = box "B"
c = box "C"
a -> b
a -> c
zone z "Z" custom { contains a, b, c }
view v { include *
  layout { rows [a b] [c] } }`);
    expect(elk.diagnostics.some((d) => /have no effect/.test(d.message))).toBe(true);
    expect(y("a")).toBe(y("b"));
    expect(y("c")).toBeGreaterThan(y("a"));
  });
});
