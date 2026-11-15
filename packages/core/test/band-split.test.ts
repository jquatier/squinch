// Shapes gauntlet rounds 26 and 27 surfaced — the first rounds with prompts
// big enough to draw a shared bus between areas, and to write an edge from an
// area itself rather than from something inside it. Each once left a wire
// ending in empty canvas. What they promise is unchanged: a declared row is
// one row, and a wire between row-mates ends on both of them.
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
  // tall beside a one-card neighbour. A wire drawn at the frame's mid-height
  // would pass below `t`; it has to leave the frame's wall and land on `t`.
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

  it("leaves the frame's wall and ends on the neighbour's face", async () => {
    const { positioned, diagnostics } = await lay(SRC);
    expect(diagnostics).toEqual([]);
    expect(checkLayout(positioned)).toEqual([]);
    const wire = positioned.edges.find((e) => e.from === "a" && e.to === "t")!;
    const t = positioned.nodes.find((n) => n.path === "t")!;
    const a = positioned.frames.find((f) => f.path === "a")!;
    const end = wire.points[wire.points.length - 1];
    expect(wire.points[0].x).toBe(a.x + a.w);
    expect(end.x).toBe(t.x);
    expect(end.y).toBeGreaterThanOrEqual(t.y);
    expect(end.y).toBeLessThanOrEqual(t.y + t.h);
  });

  it("draws two bare leaves straight across", async () => {
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

describe("a declared band is kept whatever sits on the path between its members", () => {
  // Every area talks to the bus and the bus talks back, and the bus is in no
  // band — so it lies on a path between band-mates. That used to split the
  // band in two and was refused with a line to paste; now the band is one
  // row and the bus stands on a row of its own.
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

  it("six areas around a bus stay one row, in the order written", async () => {
    const { positioned, diagnostics } = await lay(model(`[gw] [${AREAS.join(" ")}]`));
    expect(diagnostics).toEqual([]);
    expect(checkLayout(positioned)).toEqual([]);
    const at = (p: string) => positioned.nodes.find((n) => n.path === p)!;
    const band = AREAS.map(at);
    expect(new Set(band.map((n) => n.y)).size).toBe(1);
    for (let i = 1; i < band.length; i++) expect(band[i].x).toBeGreaterThanOrEqual(band[i - 1].x + band[i - 1].w);
    // the gateway's row is above the band, and the bus is not in either
    expect(at("gw").y + at("gw").h).toBeLessThanOrEqual(band[0].y);
    expect(at("bus").y).not.toBe(band[0].y);
    expect(at("bus").y).not.toBe(at("gw").y);
    // every edge is drawn, the ones that run back up from the bus included
    expect(positioned.edges).toHaveLength(14);
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
  // 2-cycle. A cycle has no longest path, and the pair once came out tied
  // on one rank by accident, with each wire running straight at its own
  // height and ending in canvas. A cycle is broken by declaration order:
  // the first-declared edge points down and the other runs back up.
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

  it("puts the pair on two ranks, the first-declared edge pointing down", async () => {
    const { positioned, diagnostics } = await lay(SRC);
    expect(diagnostics).toEqual([]);
    expect(checkLayout(positioned)).toEqual([]);
    const at = (p: string) => positioned.nodes.find((n) => n.path === p)!;
    expect(at("catalog").rank).not.toBe(at("bus").rank);
    // the first-declared direction wins: catalog above the bus
    expect(at("catalog").rank).toBeLessThan(at("bus").rank);
    // and the cycle no longer inflates the ladder — ranks are contiguous
    const ranks = [...new Set(positioned.nodes.map((n) => n.rank))].sort((a, b) => a - b);
    expect(ranks).toEqual(ranks.map((_, i) => i));
  });

  it("still draws a pair the author pins to one row, both ways", async () => {
    // A declared row is not a cycle accident: `rows [a b]` keeps the two on
    // one row, and both wires run straight across the gutter between them.
    const { positioned, diagnostics } = await lay(`a = box "A"
b = box "B"
a -> b
b ~> a
view v { include *
  layout { rows [a b] } }`);
    expect(diagnostics).toEqual([]);
    expect(checkLayout(positioned)).toEqual([]);
    const at = (p: string) => positioned.nodes.find((n) => n.path === p)!;
    expect(at("a").rank).toBe(at("b").rank);
    const [there, back] = positioned.edges;
    for (const w of [there, back]) {
      expect(w.points).toHaveLength(2);
      expect(w.points[0].y).toBe(w.points[1].y);
    }
    // two wires, two lines: they do not lie on each other
    expect(there.points[0].y).not.toBe(back.points[0].y);
  });
});
