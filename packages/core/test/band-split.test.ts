// Two defects gauntlet round 26 surfaced — the first round with prompts big
// enough to draw a shared bus between areas, and to write an edge from an
// area itself rather than from something inside it. Both left a coplanar wire
// ending in empty canvas, which the corpus invariant sweep caught
// (docs/notes/coplanar.md, "Round 26").
import { describe, it, expect } from "vitest";
import { buildModel } from "../src/model/build.js";
import { checkLayout } from "./invariants.js";

const lay = async (src: string) => {
  const { layoutView } = await import("../src/layout/layout.js");
  const built = buildModel(src);
  expect(built.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  return layoutView(built.model, built.model.views.find((x) => x.name === "v")!);
};

describe("a container endpoint is not a bare leaf", () => {
  // `a -> t` names the *container*; expanded, it is a frame several cards
  // tall beside a one-card neighbour. The straight run used the frame's
  // mid-height for both ends and stopped below `t`.
  const SRC = `c = box "C"
system a "A" {
  x = box "X"
  y = box "Y"
  x -> y
}
t = box "T"
c -> a.x
a -> t
view v {
  expand a
  layout { rows [c] [a t] }
}`;

  it("ends on the neighbour's face, jogging through the gutter", async () => {
    const { positioned, diagnostics } = await lay(SRC);
    expect(diagnostics).toEqual([]);
    expect(checkLayout(positioned)).toEqual([]);
    const wire = positioned.edges.find((e) => e.from === "a" && e.to === "t")!;
    const t = positioned.nodes.find((n) => n.path === "t")!;
    const end = wire.points[wire.points.length - 1];
    expect(wire.coplanar).toBe(true);
    expect(end.x).toBe(t.x);
    expect(end.y).toBeGreaterThanOrEqual(t.y);
    expect(end.y).toBeLessThanOrEqual(t.y + t.h);
  });

  it("leaves two bare leaves on the straight path, as before", async () => {
    const { positioned } = await lay(`a = box "A"
b = box "B"
a -> b
view v { include *
  layout { rows [a b] } }`);
    const wire = positioned.edges.find((e) => e.from === "a")!;
    expect(wire.points).toHaveLength(2);
    expect(wire.points[0].y).toBe(wire.points[1].y);
  });
});

describe("a declared band the layouter could not keep is an error", () => {
  // Every area talks to the bus and the bus talks back, and the bus is in no
  // band. Scaffold edges are lower bounds, so ELK is free to layer the areas
  // the bus feeds below it — and does, once there are enough of them.
  const AREAS = ["identity", "catalog", "commerce", "fulfilment", "engagement", "analytics"];
  const model = (rows: string) => `gw = box "Gateway"
bus = box "Bus"
${AREAS.map((a) => `system ${a} "${a}" {\n  api = box "API"\n  db = box "DB"\n  api -> db\n}`).join("\n")}
${AREAS.map((a) => `gw -> ${a}.api`).join("\n")}
identity.api ~> bus
commerce.api ~> bus
fulfilment.api ~> bus
bus ~> catalog.api
bus ~> fulfilment.api
bus ~> engagement.api
bus ~> analytics.api
commerce.api -> fulfilment.api "allocate"
view v {
  include *
  layout { rows ${rows} }
}`;

  it("names the wedge and writes a line that passes", async () => {
    const { diagnostics } = await lay(model(`[gw] [${AREAS.join(" ")}]`));
    const errs = diagnostics.filter((d) => d.severity === "error");
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toContain("in one band, but `bus` sits on the path between them");
    const line = /write `rows (.+?)`/.exec(errs[0].fix ?? "")?.[1];
    expect(line, errs[0].fix).toBeTruthy();

    // the promise the fix makes: paste it and the view is clean
    const fixed = await lay(model(line!));
    expect(fixed.diagnostics).toEqual([]);
    expect(checkLayout(fixed.positioned)).toEqual([]);
  });

  it("stays silent when the band holds", async () => {
    const { diagnostics } = await lay(`a = box "A"
k = box "K"
b = box "B"
a -> k
k -> b
a -> b
view v { include *
  layout { rows [a b] } }`);
    expect(diagnostics).toEqual([]);
  });
});

describe("a mutual pair with no hint is two ranks, not one (round 27)", () => {
  // The lifted unit graph of round 27's monorepo answer, pruned to the
  // smallest edge set that still tied the pair: a bus six areas publish to
  // and consume from, so `catalog -> bus` and `bus ~> catalog` are a
  // 2-cycle. Rank relaxation is a longest path and never settles on a
  // cycle; it ran out its pass budget with both on one rank, the router
  // took both edges (hiding them from ELK — the whole co-ranking
  // mechanism), and ELK, seeing no edge between the two, layered them
  // apart. Each wire ran straight at its own height and ended in canvas.
  // Edge *order* is part of the repro: the tie is an accident of the pass
  // count, and other orders inflate the ranks without tying them.
  const SRC = `identity = box "identity"
bus = box "bus"
catalog = box "catalog"
commerce = box "commerce"
fulfilment = box "fulfilment"
engagement = box "engagement"
analytics = box "analytics"
gw = box "gw"
identity -> bus
catalog -> bus
bus ~> catalog
commerce -> bus
fulfilment -> bus
bus ~> fulfilment
bus ~> engagement
bus ~> analytics
gw -> catalog
gw -> commerce
commerce -> fulfilment
view v { include * }`;

  it("hands both edges to ELK as ordinary cross-rank edges", async () => {
    const { positioned, diagnostics } = await lay(SRC);
    expect(diagnostics).toEqual([]);
    expect(checkLayout(positioned)).toEqual([]);
    const at = (p: string) => positioned.nodes.find((n) => n.path === p)!;
    expect(at("catalog").rank).not.toBe(at("bus").rank);
    expect(positioned.edges.filter((e) => e.coplanar)).toEqual([]);
    // the first-declared direction wins: catalog above the bus
    expect(at("catalog").rank).toBeLessThan(at("bus").rank);
    // and the cycle no longer inflates the ladder — ranks are contiguous
    const ranks = [...new Set(positioned.nodes.map((n) => n.rank))].sort((a, b) => a - b);
    expect(ranks).toEqual(ranks.map((_, i) => i));
  });

  it("still routes a pair the author pins to one row, both ways", async () => {
    // A declared rank is not a cycle accident: `rows [a b]` keeps both edges
    // coplanar and the router draws them side to side, as it always has.
    const { positioned, diagnostics } = await lay(`a = box "A"
b = box "B"
a -> b
b ~> a
view v { include *
  layout { rows [a b] } }`);
    expect(diagnostics).toEqual([]);
    expect(checkLayout(positioned)).toEqual([]);
    expect(positioned.edges.map((e) => e.coplanar)).toEqual([true, true]);
    const at = (p: string) => positioned.nodes.find((n) => n.path === p)!;
    expect(at("a").rank).toBe(at("b").rank);
  });
});
