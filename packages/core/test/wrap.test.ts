// `wrap N` (SPEC §6, Tier 0): a chain or a fan-out folds into bands
// of N. The fold is synthesized `rows`, so everything rows already has —
// scaffold lower bounds, the coplanar router within a band, the conflict
// checks — carries it; the fan's far bands ride a bus the router draws.
import { describe, it, expect } from "vitest";
import { buildModel } from "../src/model/build.js";
import { checkLayout } from "./invariants.js";

const chain = (n: number, hints: string) => {
  const lines = ['system c "C" {'];
  for (let i = 1; i <= n; i++) lines.push(`  s${i} = box "S${i}"`);
  for (let i = 1; i < n; i++) lines.push(`  s${i} -> s${i + 1}`);
  return `${lines.join("\n")}\n}\nview v {\n scope c\n layout {\n ${hints}\n }\n}`;
};
const fan = (n: number, hints: string) => {
  const lines = ['system f "F" {', '  gw = box "GW"'];
  for (let i = 1; i <= n; i++) lines.push(`  w${i} = box "W${i}"`);
  lines.push("  gw -> " + Array.from({ length: n }, (_, i) => `w${i + 1}`).join(", "));
  return `${lines.join("\n")}\n}\nview v {\n scope f\n layout {\n ${hints}\n }\n}`;
};
const lay = async (src: string) => {
  const { layoutView } = await import("../src/layout/layout.js");
  const built = buildModel(src);
  expect(built.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  return layoutView(built.model, built.model.views.find((x) => x.name === "v")!);
};
type P = Awaited<ReturnType<typeof lay>>["positioned"];
const node = (p: P, path: string) => p.nodes.find((n) => n.path === path)!;

describe("wrap: check-time rules", () => {
  const src = (hints: string) =>
    `system d "D" {\n a = box "A"\n b = box "B"\n c = box "C"\n a -> b\n b -> c\n}\nview v {\n scope d\n layout {\n ${hints}\n }\n}`;
  it("a band width below 2 is an error with the fix spelled out", () => {
    const errs = buildModel(src("wrap 1")).diagnostics.filter((d) => d.severity === "error");
    expect(errs.length).toBe(1);
    expect(errs[0].message).toContain("`wrap 1`");
    expect(errs[0].fix).toContain("wrap 5");
  });
  it("wrap beside rows is two rank assignments — a conflict, never a silent winner", () => {
    const errs = buildModel(src("wrap 2\n rows [d.a] [d.b d.c]")).diagnostics.filter((d) => d.severity === "error");
    expect(errs.map((e) => e.message)).toContainEqual(expect.stringContaining("`wrap 2` and `rows` both assign bands"));
  });
  it("parses onto the view", () => {
    const r = buildModel(src("wrap 2"));
    expect(r.ok).toBe(true);
    expect(r.model.views[0].layout.wrap?.n).toBe(2);
  });
});

describe("wrap: a chain folds as a serpentine", () => {
  it("a 15-chain with wrap 5 is three bands, hop straight, invariants clean", async () => {
    const { positioned, diagnostics } = await lay(chain(15, "wrap 5"));
    expect(diagnostics.filter((d) => d.severity === "warning")).toEqual([]);
    expect(checkLayout(positioned)).toEqual([]);
    const rankOf = (i: number) => node(positioned, `c.s${i}`).rank;
    expect([1, 5, 6, 10, 11, 15].map(rankOf)).toEqual([0, 0, 1, 1, 2, 2]);
    // band 1 reads left→right, band 2 right→left, band 3 left→right again
    const x = (i: number) => node(positioned, `c.s${i}`).x;
    expect(x(1) < x(5) && x(6) > x(10) && x(11) < x(15)).toBe(true);
    // the hop between bands is a one-column vertical, not a return wire
    const hop = positioned.edges.find((e) => e.from === "c.s5" && e.to === "c.s6")!;
    expect(hop.points.length).toBe(2);
    expect(hop.points[0].x).toBe(hop.points[1].x);
    // in-band edges are the coplanar router's straight runs
    expect(positioned.edges.filter((e) => e.coplanar).length).toBe(12);
    // and the fold is the point: the same chain unfolded is a tall strip
    const unfolded = (await lay(chain(15, ""))).positioned;
    expect(positioned.height).toBeLessThan(unfolded.height / 3);
    expect(positioned.width).toBeLessThan(unfolded.height);
  });

  it("a short reversed last band right-aligns under its column mates", async () => {
    const { positioned } = await lay(chain(17, "wrap 5"));
    expect(checkLayout(positioned)).toEqual([]);
    const hop = positioned.edges.find((e) => e.from === "c.s15" && e.to === "c.s16")!;
    expect(hop.points[0].x).toBe(hop.points[1].x);
    expect(node(positioned, "c.s17").x).toBeLessThan(node(positioned, "c.s16").x);
  });

  it("direction right transposes the fold: bands are columns", async () => {
    const { positioned } = await lay(chain(15, "direction right\n wrap 5"));
    expect(checkLayout(positioned)).toEqual([]);
    const y = (i: number) => node(positioned, `c.s${i}`).y;
    expect(y(1) < y(5) && y(6) > y(10) && y(11) < y(15)).toBe(true);
    expect(node(positioned, "c.s6").x).toBeGreaterThan(node(positioned, "c.s5").x);
    const unfolded = (await lay(chain(15, "direction right"))).positioned;
    expect(positioned.width).toBeLessThan(unfolded.width / 3);
  });
});

describe("wrap: a fan-out folds under its source", () => {
  it("12 targets with wrap 6: the far band rides a bus down band 1's middle gap", async () => {
    const { positioned, diagnostics } = await lay(fan(12, "wrap 6"));
    expect(diagnostics.filter((d) => d.severity === "warning")).toEqual([]);
    // the bus shares one port on the source, as a channel shares one on its target
    expect(checkLayout(positioned)).toEqual([]);
    expect(node(positioned, "f.w6").rank).toBe(1);
    expect(node(positioned, "f.w7").rank).toBe(2);
    const bus = positioned.edges.filter((e) => e.coplanar);
    expect(bus.map((e) => e.to).sort()).toEqual(["f.w10", "f.w11", "f.w12", "f.w7", "f.w8", "f.w9"]);
    const gw = node(positioned, "f.gw");
    for (const e of bus) {
      // leaves the source's south face at one spine, one trunk, drops into the target's north face
      expect(e.points[0].y).toBe(gw.y + gw.h);
      expect(e.points[0].x).toBe(bus[0].points[0].x);
      expect(e.points.length).toBe(4);
      const t = node(positioned, e.to);
      expect(e.points.at(-1)).toEqual({ x: t.x + Math.round(t.w / 2), y: t.y });
    }
    // the spine runs through band 1's middle gap, between W3 and W4, and
    // ELK's own stubs on the source's face keep the router's 12px bar from
    // it (DESIGN §4's 16 is not reachable on a 120-wide face with seven
    // stubs — ELK's six alone already sit 15 apart there)
    const [w3, w4] = [node(positioned, "f.w3"), node(positioned, "f.w4")];
    const spine = bus[0].points[0].x;
    expect(spine).toBeGreaterThan(w3.x + w3.w);
    expect(spine).toBeLessThan(w4.x);
    for (const p of positioned.ports.filter((q) => q.node === "f.gw" && q.side === "south" && !bus.some((b) => b.id === q.edge)))
      expect(Math.abs(p.x - spine)).toBeGreaterThanOrEqual(12);
    // the same fan unfolded is one wide band; the fold must halve it
    const unfolded = (await lay(fan(12, ""))).positioned;
    expect(positioned.width).toBeLessThan(unfolded.width * 0.6);
  });

  it("three trunks off one spine, the last band of one straight under it", async () => {
    const { positioned } = await lay(fan(13, "wrap 4"));
    expect(checkLayout(positioned)).toEqual([]);
    const bus = positioned.edges.filter((e) => e.coplanar);
    expect(bus.length).toBe(9);
    const last = bus.find((e) => e.to === "f.w13")!;
    expect(last.points.length).toBe(2);
    expect(new Set(bus.map((e) => e.points[0].x)).size).toBe(1);
  });

  it("an odd band cannot centre a spine on the source's face, so the bus takes the outside lane", async () => {
    const { positioned } = await lay(fan(12, "wrap 5"));
    expect(checkLayout(positioned)).toEqual([]);
    const bus = positioned.edges.filter((e) => e.coplanar);
    expect(bus.length).toBe(7);
    const right = Math.max(...positioned.nodes.map((n) => n.x + n.w));
    for (const e of bus) expect(e.points[1].x).toBeGreaterThan(right);
  });
});

describe("wrap: never silent", () => {
  it("warns, naming the shape rule, when the view is neither a chain nor a fan", async () => {
    const { diagnostics } = await lay(`system d "D" {\n a = box "A"\n b = box "B"\n c = box "C"\n e = box "E"\n a -> b\n a -> c\n b -> e\n c -> e\n}\nview v {\n scope d\n layout {\n wrap 2\n }\n}`);
    const w = diagnostics.filter((d) => d.severity === "warning");
    expect(w.length).toBe(1);
    expect(w[0].message).toContain("`wrap 2` has no effect");
    expect(w[0].fix).toContain("rows [");
  });

  it("warns when everything already fits in one band", async () => {
    const f = await lay(fan(5, "wrap 6"));
    expect(f.diagnostics.map((d) => d.message)).toContainEqual(expect.stringContaining("5 targets already fit in one band of 6"));
    const c = await lay(chain(4, "wrap 5"));
    expect(c.diagnostics.map((d) => d.message)).toContainEqual(expect.stringContaining("4 nodes already fit in one band of 5"));
  });
});

describe("wrap: never twice, never in a container", () => {
  it("a second wrap line in one block is an error, not a silent winner", () => {
    const r = buildModel(`a = box "A"\nb = box "B"\nc = box "C"\na -> b\nb -> c\nview v { include *\n layout {\n  wrap 2\n  wrap 3\n } }\n`);
    expect(r.diagnostics.map((d) => d.message)).toContainEqual(expect.stringContaining("`wrap` appears twice in this block"));
  });
  it("inside a container's layout block it is refused as a view's statement", () => {
    const r = buildModel(`system s "S" {\n a = box "A"\n b = box "B"\n a -> b\n layout { wrap 2 }\n}\n`);
    expect(r.diagnostics.map((d) => d.message)).toContainEqual(expect.stringContaining("`wrap` describes a view, not a container's interior"));
  });
});
