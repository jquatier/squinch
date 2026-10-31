// A long leaf name widens the leaf, up to 320. Only a label earns the room past
// 240, and a column of mixed widths in a rightward flow keeps a straight left
// edge. A name that already fits renders as it always did.
import { describe, it, expect } from "vitest";
import { render, validateSVG } from "../src/index.js";

const LONG = "materials_labdips_by_key (pre-agg)";
const SUB = "development_colorway_season_stream_v";

const leaf = (label: string, attrs = "") =>
  `system s "S" {\n a = sys/server "${label}" ${attrs}\n b = sys/database "DB"\n a -> b\n}\nview v { scope s }\n`;
const svg = async (src: string) => {
  const r = await render(src, { theme: "light", view: "v" });
  expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  expect(r.ok).toBe(true);
  expect(validateSVG(r.svg!).ok).toBe(true);
  return r.svg!;
};
/** A node's surface: the first rect in its group. */
const box = (out: string, path: string) => {
  const m = new RegExp(`<g data-path="${path}"[^>]*>\\s*<rect x="([\\d.]+)" y="([\\d.]+)" width="(\\d+)"`).exec(out)!;
  return { x: Number(m[1]), y: Number(m[2]), w: Number(m[3]) };
};

describe("leaf tiers", () => {
  it("a name that fits a smaller tier stays there", async () => {
    expect(box(await svg(leaf("Order Handler")), "s.a").w).toBe(200);
  });

  it("a long label earns 280, then 320, and shows in full", async () => {
    const at280 = await svg(leaf("AUTO CDC FROM SNAPSHOT"));
    expect(box(at280, "s.a").w).toBe(280);
    expect(at280).toContain(">AUTO CDC FROM SNAPSHOT<");
    const at320 = await svg(leaf(LONG));
    expect(box(at320, "s.a").w).toBe(320);
    expect(at320).toContain(`>${LONG}<`);
  });

  it("the widest tier is 320, however long the label", async () => {
    expect(box(await svg(leaf("word ".repeat(30).trim())), "s.a").w).toBe(320);
  });

  it("a long subtitle alone stops at 240; a long label gives it the room", async () => {
    expect(box(await svg(leaf("Short", `{ subtitle: "${SUB}" }`)), "s.a").w).toBe(240);
    const wide = await svg(leaf(LONG, `{ subtitle: "${SUB}" }`));
    expect(box(wide, "s.a").w).toBe(320);
    expect(wide).toContain(`>${SUB}<`);
  });
});

describe("column alignment", () => {
  const body = `  a = sys/server "In"\n  b = sys/server "${LONG}"\n  c = sys/server "Short"\n  d = sys/database "Out"\n  a -> b\n  a -> c\n  b -> d\n  c -> d\n`;

  it("a rightward view keeps one left edge across widths", async () => {
    const out = await svg(`system s "S" {\n${body}}\nview v { scope s; layout { direction right } }\n`);
    const [b, c] = [box(out, "s.b"), box(out, "s.c")];
    expect(b.w).toBeGreaterThan(c.w);
    expect(b.x).toBe(c.x);
  });

  it("so does a frame directed right inside a downward view", async () => {
    const out = await svg(`system s "S" {\n${body}  layout { direction right }\n}\nsystem o "O" {\n  x = sys/server "X"\n}\ns.d -> o.x\nview v { include *; expand s }\n`);
    const [b, c] = [box(out, "s.b"), box(out, "s.c")];
    expect(b.w).toBeGreaterThan(c.w);
    expect(b.x).toBe(c.x);
  });

  it("a downward view still centres, so its rows keep their shape", async () => {
    const out = await svg(`system s "S" {\n  a = sys/server "${LONG}"\n  b = sys/server "Short"\n  a -> b\n}\nview v { scope s }\n`);
    const [a, b] = [box(out, "s.a"), box(out, "s.b")];
    expect(a.w).toBeGreaterThan(b.w);
    expect(a.x).not.toBe(b.x);
    expect(a.x + a.w / 2).toBe(b.x + b.w / 2);
  });
});
