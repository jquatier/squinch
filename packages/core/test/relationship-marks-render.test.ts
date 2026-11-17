// Relationship marks, drawn (SPEC §4, DESIGN §4): the six shapes, in place of
// the arrowhead, valid and identical in structure across both palettes.
import { describe, it, expect } from "vitest";
import { buildModel, render } from "../src/index.js";
import { layoutView } from "../src/layout/layout.js";
import { validateSVG } from "../src/render/validate.js";

const two = (marks: string, arrow = "->", extra = "") => `a = sys/table "a"
b = sys/table "b"
a ${arrow} b ${marks}
${extra}`;
const svgOf = async (src: string, opts: Record<string, unknown> = {}) => {
  const r = await render(src, { theme: "light", ...opts });
  expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  expect(r.ok).toBe(true);
  expect(validateSVG(r.svg!).ok).toBe(true);
  return r.svg!;
};
/** The mark paths: round-capped 1.5 strokes with no fill — nothing else in an
 *  edge's group is drawn that way on a solid sync wire. */
const MARK = /<path d="([^"]+)" fill="none" stroke="[^"]+" stroke-width="1\.5" stroke-linecap="round" stroke-linejoin="round"\/>/g;
const marksIn = (svg: string) => [...svg.matchAll(MARK)].map((m) => m[1]);
const HEAD = /<path d="M \d+ \d+ L \d+ \d+ L \d+ \d+ Z" fill="#/g;
const rings = (svg: string) => (svg.match(/<circle [^>]*r="2\.5" fill="none"/g) ?? []).length;
const strokes = (d: string) => (d.match(/M /g) ?? []).length;

/** Where the wire of `a -> b` meets `a` (first) and `b` (last), from the layout itself. */
const endsOf = async (src: string) => {
  // the default view: everything at the top level, flowing down
  const { model } = buildModel(`${src}\nview all {\n  include *\n}\n`);
  const { positioned } = await layoutView(model, model.views.find((v) => v.name === "all")!);
  const pts = positioned.edges[0].points;
  // `a` stands above `b`: the wire leaves a's south wall and enters b's north wall, straight down
  expect(pts[0].x).toBe(pts[pts.length - 1].x);
  expect(pts[0].y).toBeLessThan(pts[pts.length - 1].y);
  return { from: pts[0], to: pts[pts.length - 1] };
};
/** SPEC §4's table, restated: each mark from the table outward, as distances
 *  along the wire. A bar is 10 across; a foot's toes are 10 apart at the wall. */
const SHAPE: Record<string, { foot?: number; bars: number[]; ring?: number }> = {
  "one": { bars: [6] },
  "many": { foot: 10, bars: [] },
  "exactly-one": { bars: [4, 8] },
  "zero-or-one": { bars: [4], ring: 8.5 },
  "one-or-many": { foot: 7, bars: [10] },
  "zero-or-many": { foot: 7, bars: [], ring: 9.5 },
};
/** The path and ring a mark must be, at wall point `p`, for a wire running
 *  down out of it (`out` = 1) or up out of it (`out` = -1). */
const expected = (word: string, p: { x: number; y: number }, out: 1 | -1) => {
  const { foot, bars, ring } = SHAPE[word];
  const at = (k: number, o: number) => `${p.x + out * o} ${p.y + out * k}`;
  const parts: string[] = [];
  if (foot !== undefined) parts.push(`M ${at(0, 5)} L ${at(foot, 0)} L ${at(0, -5)}`); // toes at the wall, point away
  for (const k of bars) parts.push(`M ${at(k, 5)} L ${at(k, -5)}`);
  if (ring !== undefined) parts.push(`M ${at(0, 0)} L ${at(ring - 2.5, 0)}`); // the wire, from the wall to the ring
  return { d: parts.join(" "), ring: ring === undefined ? undefined : `cx="${p.x}" cy="${p.y + out * ring}" r="2.5"` };
};
const WORDS = Object.keys(SHAPE);

describe("relationship marks: the six shapes", () => {
  it.each(WORDS)("%s at the source's wall", async (word) => {
    const src = two(`{ from: ${word} to: one }`), svg = await svgOf(src), { from, to } = await endsOf(src);
    const want = expected(word, from, 1), marks = marksIn(svg);
    expect(marks).toHaveLength(2);
    expect(marks).toContain(want.d);
    expect(marks).toContain(expected("one", to, -1).d);
    if (want.ring) expect(svg).toContain(`<circle ${want.ring} fill="none"`);
    expect(rings(svg)).toBe(want.ring ? 1 : 0);
    expect(svg.match(HEAD)).toBeNull(); // marks replace the arrowhead
  });

  it.each(WORDS)("%s at the target's wall", async (word) => {
    const src = two(`{ from: one to: ${word} }`), svg = await svgOf(src), { from, to } = await endsOf(src);
    const want = expected(word, to, -1), marks = marksIn(svg);
    expect(marks).toContain(want.d);
    expect(marks).toContain(expected("one", from, 1).d);
    if (want.ring) expect(svg).toContain(`<circle ${want.ring} fill="none"`);
  });

  it("an open ring: the wire is drawn from the ring's end and skips to its far edge", async () => {
    const wire = (svg: string, skip: string) => new RegExp(`<path d="M (\\d+) (\\d+) [^"]*" fill="none" stroke="[^"]+" stroke-width="1\\.5" stroke-dasharray="${skip}"/>`).exec(svg);
    // at the source: the path starts at the source's wall and skips 12 (ring centre 9.5 + radius 2.5)
    let src = two("{ from: zero-or-many to: one }"), svg = await svgOf(src), ends = await endsOf(src);
    expect(wire(svg, "0 12 100000")?.slice(1).map(Number)).toEqual([ends.from.x, ends.from.y]);
    // at the target: the path is drawn from the target's wall and skips 11 (8.5 + 2.5)
    src = two("{ from: one to: zero-or-one }"); svg = await svgOf(src); ends = await endsOf(src);
    expect(wire(svg, "0 11 100000")?.slice(1).map(Number)).toEqual([ends.to.x, ends.to.y]);
    // both: the same path twice, once from each end, overlapping in the middle — no seam, no split corner
    src = two("{ from: zero-or-many to: zero-or-one }"); svg = await svgOf(src); ends = await endsOf(src);
    const len = ends.to.y - ends.from.y, half = Math.ceil(len / 2) + 4;
    expect(wire(svg, `0 12 ${half - 12} 100000`)?.slice(1).map(Number)).toEqual([ends.from.x, ends.from.y]);
    expect(wire(svg, `0 11 ${half - 11} 100000`)?.slice(1).map(Number)).toEqual([ends.to.x, ends.to.y]);
    expect(2 * half).toBeGreaterThan(len); // the two halves meet
    expect(await svgOf(two("{ from: many to: one }"))).not.toContain("stroke-dasharray");
  });

  it("the plain edge still has its head, and no marks", async () => {
    const svg = await svgOf(two(""));
    expect(marksIn(svg)).toEqual([]);
    expect(svg.match(HEAD)).toHaveLength(1);
  });

  it("works on `--`, which had no head to replace", async () => {
    const svg = await svgOf(two("{ from: many to: many }", "--"));
    expect(marksIn(svg)).toHaveLength(2);
  });
});

describe("relationship marks: themes and determinism", () => {
  const SRC = two(`"b_id" { from: zero-or-many to: zero-or-one }`);
  it("light and dark differ only in colour, so they pair", async () => {
    const light = await svgOf(SRC), dark = await svgOf(SRC, { theme: "dark" });
    // the adaptive merge walks the two renders element by element
    const tags = (s: string) => s.match(/<[a-zA-Z]+/g)!;
    expect(marksIn(light)).toEqual(marksIn(dark));
    expect(tags(light)).toEqual(tags(dark));
    const adaptive = await svgOf(SRC, { adaptive: true });
    expect(adaptive).toContain("prefers-color-scheme");
    // the merged picture keeps both rings and both skipped wire starts
    expect(adaptive.match(/<circle [^>]*r="2\.5"/g)).toHaveLength(2);
    expect(adaptive.match(/stroke-dasharray="0 1[12] \d+ 100000"/g)).toHaveLength(2);
  });

  it("the same source renders to the same bytes", async () => {
    expect(await svgOf(SRC)).toBe(await svgOf(SRC));
  });

  it("the picture carries no script and no markers", async () => {
    const svg = await svgOf(SRC);
    expect(svg).not.toContain("<script");
    expect(svg).not.toContain("<marker");
  });
});

describe("relationship marks: where they are not drawn", () => {
  it("`lines: straight` draws the head instead", async () => {
    const r = await render(two("{ from: many to: one }", "->", "view v {\n  layout {\n    lines straight\n  }\n}"), { theme: "light", view: "v" });
    expect(r.ok).toBe(true);
    expect(marksIn(r.svg!)).toEqual([]);
    expect(r.svg!.match(HEAD)).toHaveLength(1);
    expect(r.diagnostics.some((d) => d.message.includes("lines straight"))).toBe(true);
  });

  it("a channel's shared end carries one mark, not one per edge", async () => {
    const src = `a = sys/table "a"
b = sys/table "b"
c = sys/table "c"
a -> c { from: many to: exactly-one }
b -> c { from: many to: exactly-one }
view v {
  layout {
    channel a, b -> c
  }
}`;
    const svg = await svgOf(src, { view: "v" });
    // two feet (one per source) and one pair of bars at the shared end
    expect(marksIn(svg)).toHaveLength(3);
    expect(marksIn(svg).filter((d) => (d.match(/M /g) ?? []).length === 2)).toHaveLength(1);
  });

  it("the shared mark goes with the wire that stands out, not the first declared", async () => {
    const src = `a = sys/table "a"
b = sys/table "b"
c = sys/table "c"
a -> c { from: many to: exactly-one }
b -> c { from: many to: exactly-one color: red }
view v {
  highlight shop
  layout {
    channel a, b -> c
  }
}`.replace("  highlight shop\n", "");
    const svg = await svgOf(src, { view: "v" });
    // undimmed both: the first met keeps it; the bars are in the plain ink
    const bars = [...svg.matchAll(/<path d="(M [\d.]+ [\d.]+ L [\d.]+ [\d.]+ M [\d.]+ [\d.]+ L [\d.]+ [\d.]+)" fill="none" stroke="([^"]+)"/g)];
    expect(bars).toHaveLength(1);
    const tagged = await svgOf(src.replace("{ from: many to: exactly-one }\nb", "{ from: many to: exactly-one }\nb").replace("color: red }", "color: red tags: #pci }").replace("view v {", "view v {\n  highlight #pci"), { view: "v" });
    const hl = [...tagged.matchAll(/(<g opacity="[^"]+">)?<path d="M [\d.]+ [\d.]+ L [\d.]+ [\d.]+ M [\d.]+ [\d.]+ L [\d.]+ [\d.]+" fill="none" stroke="([^"]+)"/g)];
    expect(hl).toHaveLength(1);
    expect(hl[0][1]).toBeUndefined(); // not dimmed
    expect(hl[0][2]).not.toBe(bars[0][2]); // the highlighted, red wire's colour
  });
});
