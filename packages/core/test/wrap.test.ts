// `wrap N` (SPEC §6, Tier 0): a row wider than N folds into bands of N. A
// chain folds as a serpentine; a fan-out folds into bands under its source,
// and the bands past the first hang off one trunk (`via: "bus"`). Folding
// inside containers is `test/weft/wrap-containers.test.ts`.
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
    // every other edge stays in its band: one straight run to its neighbour
    const inBand = positioned.edges.filter((e) => e !== hop && e.from !== "c.s10");
    expect(inBand).toHaveLength(12);
    for (const e of inBand) {
      expect(e.points).toHaveLength(2);
      expect(e.points[0].y).toBe(e.points[1].y);
    }
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
  const trunk = (p: P) => p.edges.filter((e) => e.via === "bus");

  it("12 targets with wrap 6: the far band hangs off a trunk down band 1's middle gap", async () => {
    const { positioned, diagnostics } = await lay(fan(12, "wrap 6"));
    expect(diagnostics.filter((d) => d.severity === "warning")).toEqual([]);
    // the trunk shares one port on the source, as a channel shares one on its target
    expect(checkLayout(positioned)).toEqual([]);
    expect(node(positioned, "f.w6").rank).toBe(1);
    expect(node(positioned, "f.w7").rank).toBe(2);
    const bus = trunk(positioned);
    expect(bus.map((e) => e.to).sort()).toEqual(["f.w10", "f.w11", "f.w12", "f.w7", "f.w8", "f.w9"]);
    const gw = node(positioned, "f.gw");
    for (const e of bus) {
      // leaves the source's south face at one point, runs down one spine,
      // branches once, and drops into the target's north face
      expect(e.points[0]).toEqual(bus[0].points[0]);
      expect(e.points[0].y).toBe(gw.y + gw.h);
      expect(e.points[1].x).toBe(e.points[0].x);
      expect(e.points[1].y).toBe(bus[0].points[1].y);
      const t = node(positioned, e.to), end = e.points.at(-1)!;
      expect(end.y).toBe(t.y);
      expect(end.x).toBeGreaterThan(t.x);
      expect(end.x).toBeLessThan(t.x + t.w);
    }
    // the spine runs through band 1's middle gap, between W3 and W4, and the
    // wires to band 1 keep clear of it on the source's face
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

  it("three more bands hang off one spine, each branching at its own level", async () => {
    const { positioned } = await lay(fan(13, "wrap 4"));
    expect(checkLayout(positioned)).toEqual([]);
    const bus = trunk(positioned);
    expect(bus.length).toBe(9);
    expect(new Set(bus.map((e) => e.points[0].x)).size).toBe(1);
    // one branch level per band, each above the band it feeds
    const levels = new Map<number, number>();
    for (const e of bus) levels.set(node(positioned, e.to).y, e.points.at(-2)!.y);
    expect(levels.size).toBe(3);
    for (const [bandY, y] of levels) expect(y).toBeLessThan(bandY);
    expect(new Set(bus.map((e) => `${node(positioned, e.to).y}:${e.points.at(-2)!.y}`)).size).toBe(3);
  });

  it("an odd band opens a gap for the spine rather than running it through a box", async () => {
    // five across leaves no middle gap under the source: the band parts
    const { positioned } = await lay(fan(12, "wrap 5"));
    expect(checkLayout(positioned)).toEqual([]);
    const bus = trunk(positioned);
    expect(bus.length).toBe(7);
    const spine = bus[0].points[0].x;
    expect(new Set(bus.map((e) => e.points[0].x))).toEqual(new Set([spine]));
    const band1 = [1, 2, 3, 4, 5].map((i) => node(positioned, `f.w${i}`));
    expect(band1.every((n) => spine <= n.x || spine >= n.x + n.w)).toBe(true);
    expect(band1.some((n) => n.x + n.w <= spine) && band1.some((n) => n.x >= spine)).toBe(true);
  });
});

describe("wrap: never silent", () => {
  it("warns when no row is wide enough to fold", async () => {
    // a diamond's widest row is two: `wrap 2` has nothing to do
    const { diagnostics } = await lay(`system d "D" {\n a = box "A"\n b = box "B"\n c = box "C"\n e = box "E"\n a -> b\n a -> c\n b -> e\n c -> e\n}\nview v {\n scope d\n layout {\n wrap 2\n }\n}`);
    const w = diagnostics.filter((d) => d.severity === "warning");
    expect(w.length).toBe(1);
    expect(w[0].message).toContain("`wrap 2` has no effect — no row here is wider than 2");
    expect(w[0].fix).toBeTruthy();
  });

  it("warns when a fan or a chain already fits in one band", async () => {
    const f = await lay(fan(5, "wrap 6"));
    expect(f.diagnostics.map((d) => d.message)).toEqual([expect.stringContaining("`wrap 6` has no effect")]);
    const c = await lay(chain(4, "wrap 5"));
    expect(c.diagnostics.map((d) => d.message)).toEqual([expect.stringContaining("`wrap 5` has no effect")]);
  });

  it("folds any row that is too wide, not only a chain or a single fan", async () => {
    // two sources feeding six targets: neither a chain nor one fan-out
    const { positioned, diagnostics } = await lay(`system d "D" {\n a = box "A"\n b = box "B"\n${[1, 2, 3, 4, 5, 6].map((i) => ` t${i} = box "T${i}"`).join("\n")}\n${[1, 2, 3, 4, 5, 6].map((i) => ` ${i % 2 ? "a" : "b"} -> t${i}`).join("\n")}\n}\nview v {\n scope d\n layout {\n wrap 3\n }\n}`);
    expect(diagnostics).toEqual([]);
    expect(checkLayout(positioned)).toEqual([]);
    const rows = new Map<number, number>();
    for (const n of positioned.nodes) rows.set(n.y, (rows.get(n.y) ?? 0) + 1);
    expect(Math.max(...rows.values())).toBeLessThanOrEqual(3);
    expect(positioned.edges).toHaveLength(6);
  });
});

describe("wrap: never twice, and a container may carry its own", () => {
  it("a second wrap line in one block is an error, not a silent winner", () => {
    const r = buildModel(`a = box "A"\nb = box "B"\nc = box "C"\na -> b\nb -> c\nview v { include *\n layout {\n  wrap 2\n  wrap 3\n } }\n`);
    expect(r.diagnostics.map((d) => d.message)).toContainEqual(expect.stringContaining("`wrap` appears twice in this block"));
  });
  it("inside a container's layout block it is the container's own fold", () => {
    const r = buildModel(`system s "S" {\n a = box "A"\n b = box "B"\n a -> b\n layout { wrap 2 }\n}\n`);
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(r.model.containers.get("s")?.layout?.wrap?.n).toBe(2);
  });
  it("a container's wrap beside its own rows is an error, as in a view", () => {
    const r = buildModel(`system s "S" {\n a = box "A"\n b = box "B"\n a -> b\n layout {\n  wrap 2\n  rows [a] [b]\n }\n}\n`);
    expect(r.diagnostics.map((d) => d.message)).toContainEqual(expect.stringContaining("both assign bands in `s`"));
  });
  it("a container's wrap folds it wherever it is opened: scoped to, or expanded in another view", async () => {
    const { layoutView } = await import("../src/layout/layout.js");
    const src = `system s "S" {\n a = box "A"\n b = box "B"\n c = box "C"\n d = box "D"\n a -> b\n b -> c\n c -> d\n layout { wrap 2 }\n}\nview inside { scope s }\nview outside { include *\n expand s }\n`;
    const { model } = buildModel(src);
    for (const name of ["inside", "outside"]) {
      const { positioned, diagnostics } = await layoutView(model, model.views.find((v) => v.name === name)!);
      expect(diagnostics, name).toEqual([]);
      expect(checkLayout(positioned), name).toEqual([]);
      // four in a chain, two bands of two
      expect(new Set(positioned.nodes.map((n) => n.y)).size, name).toBe(2);
    }
  });
});
