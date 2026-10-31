// A long leaf name widens the leaf up to 320, then takes a second line, and only
// then is cut, with a warning and the full text in a tooltip. Only a label earns
// the room past 240, and a column of mixed widths in a rightward flow keeps a
// straight left edge. A name that already fits renders as it always did.
import { describe, it, expect } from "vitest";
import { buildModel, render, validateSVG } from "../src/index.js";
import { measure, titleLines, WIDEST_TITLE_ROOM } from "../src/metrics.js";

const LONG = "materials_labdips_by_key (pre-agg)";
const SUB = "development_colorway_season_stream_v";
const VERY_LONG = "Public Partner-Facing Integration Gateway With Rate Limiting";
const FAR_TOO_LONG = "word ".repeat(40).trim();
const ROOM = WIDEST_TITLE_ROOM.leaf;

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

describe("titleLines", () => {
  const lines = (t: string, room = 164) => titleLines(t, room, 13, "500", "inter");

  it("leaves a name that fits alone", () => {
    expect(lines("Order Handler")).toEqual(["Order Handler"]);
  });

  it("breaks at spaces and identifier separators, and before a parenthesis", () => {
    expect(lines(LONG)).toEqual(["materials_labdips_by_key", "(pre-agg)"]);
    expect(lines("development_colorway_season_stream_v")[0]).toMatch(/_$/);
    expect(lines("silver-view-ap-buy-ready-rpt.py")[0]).toMatch(/-$/);
  });

  it("a name with nowhere to break stays on one line, cut", () => {
    const out = lines("x".repeat(80));
    expect(out).toHaveLength(1);
    expect(out[0].endsWith("…")).toBe(true);
  });

  it("cuts the second line when two are still not enough, keeping every line in the box", () => {
    const out = lines(FAR_TOO_LONG, ROOM);
    expect(out).toHaveLength(2);
    expect(out[1].endsWith("…")).toBe(true);
    for (const l of out) expect(measure(l, 13, "500", "inter")).toBeLessThanOrEqual(ROOM);
  });
});

describe("two lines", () => {
  const titles = (out: string, path: string) => {
    const i = out.indexOf(`<g data-path="${path}"`);
    const g = out.slice(i, out.indexOf("</g>", out.indexOf("<text", i)));
    return { g, text: [...g.matchAll(/font-size="13" font-weight="500"[^>]*>([^<]*)</g)].map((m) => m[1]) };
  };

  it("a name past the widest tier takes two lines, whole, in a 320 leaf", async () => {
    const out = await svg(leaf(VERY_LONG));
    expect(box(out, "s.a").w).toBe(320);
    expect(titles(out, "s.a").text).toEqual(["Public Partner-Facing Integration", "Gateway With Rate Limiting"]);
  });

  it("a name that fits a tier is not wrapped", async () => {
    expect(titles(await svg(leaf(LONG)), "s.a").text).toEqual([LONG]);
  });

  it("two lines and a subtitle stay inside the 64 tall box", async () => {
    const out = await svg(leaf(VERY_LONG, `{ subtitle: "Kong" }`));
    const { y } = box(out, "s.a");
    const { g } = titles(out, "s.a");
    const baselines = [...g.matchAll(/<text [^>]*y="([\d.]+)" font-size="1[13]"/g)].map((m) => Number(m[1]) - y);
    expect(baselines).toHaveLength(3);
    expect(baselines[0] - 13).toBeGreaterThanOrEqual(0);
    expect(baselines[2]).toBeLessThanOrEqual(64 - 4);
  });

  it("a person's name wraps too", async () => {
    const out = await svg(`person p "${VERY_LONG}"\nsystem s "S" {\n a = sys/server "A"\n}\np -> s.a\nview v { include *; expand s }\n`);
    expect(titles(out, "p").text).toHaveLength(2);
  });

  it("a link's hit area covers both lines", async () => {
    const out = await svg(leaf(VERY_LONG, `{ link: "https://example.com/a" }`));
    const hit = /<rect x="[\d.]+" y="[\d.]+" width="\d+" height="(\d+)" fill="none" pointer-events="all"/.exec(out)!;
    expect(Number(hit[1])).toBe(Math.ceil(13 * 1.4) + 16);
    expect(out).toMatch(/<a [^>]*><rect [^>]*\/><text [^>]*>[^<]*<\/text><text [^>]*>[^<]*<\/text><\/a>/);
  });
});

describe("the full text, when something is cut", () => {
  const tip = (out: string, path: string) => {
    const i = out.indexOf(`<g data-path="${path}"`);
    const j = out.indexOf("<g data-path=", i + 10);
    return /<title>([^<]*)<\/title>/.exec(out.slice(i, j < 0 ? undefined : j))?.[1];
  };
  const CARD = "Upstream sources for the whole engine";

  it("nothing cut, no tooltip: a wrapped name is whole", async () => {
    expect(await svg(leaf(LONG))).not.toContain("<title>");
    expect(await svg(leaf(VERY_LONG))).not.toContain("<title>");
  });

  it("a cut label carries its full text", async () => {
    expect(tip(await svg(leaf(FAR_TOO_LONG)), "s.a")).toBe(FAR_TOO_LONG);
  });

  it("a cut subtitle carries the label and the subtitle", async () => {
    expect(tip(await svg(leaf("Short", `{ subtitle: "${SUB}" }`)), "s.a")).toBe(`Short\n${SUB}`);
  });

  it("a cut card name carries its full text, after the surface", async () => {
    const out = (await render(`system s "${CARD}" {\n a = sys/server "A"\n}\nsystem t "T" {\n b = sys/server "B"\n}\ns.a -> t.b\nview v { include * }\n`, { theme: "light", view: "v" })).svg!;
    expect(validateSVG(out).ok).toBe(true);
    expect(tip(out, "s")?.split("\n")[0]).toBe(CARD);
    expect(out).toMatch(/<g data-path="s"[^>]*>\s*<rect /);
  });
});

describe("the warning matches the drawing", () => {
  const warned = (src: string) => buildModel(src).diagnostics.some((d) => d.message.includes("label is"));
  const card = (name: string) => `system s "${name}" {\n a = sys/server "A"\n}\nsystem t "T" {\n b = sys/server "B"\n}\ns.a -> t.b\nview v { include * }\n`;
  const cut = (out: string) => out.includes("<title>");

  it.each([
    ["fits a tier", leaf(LONG)],
    ["fits two lines", leaf(VERY_LONG)],
    ["too long for two", leaf(FAR_TOO_LONG)],
    ["nowhere to break", leaf("x".repeat(80))],
    ["a 38 character name", leaf("abcdefgh abcdefgh abcdefgh abcdefgh ab")],
    ["a card that fits", card("Short name")],
    ["a card cut at 27", card("Upstream sources (16 tables)")],
  ])("%s", async (_name, src) => {
    const view = src.includes("include *") ? "v" : "v";
    const r = await render(src, { theme: "light", view });
    expect(warned(src)).toBe(cut(r.svg!));
  });

  it("the check's room is what the renderer draws, for each kind", async () => {
    // one pixel either side of each number, through the real renderer
    const justFits = (room: number, size: number) => {
      let s = "";
      while (measure(`${s}i`, size, "500", "inter") <= room) s += "i";
      return s;
    };
    const fitsCard = justFits(WIDEST_TITLE_ROOM.card, 15);
    expect(cut((await render(card(fitsCard), { theme: "light", view: "v" })).svg!)).toBe(false);
    expect(cut((await render(card(`${fitsCard}ii`), { theme: "light", view: "v" })).svg!)).toBe(true);
    const fitsLeaf = justFits(WIDEST_TITLE_ROOM.leaf, 13);
    expect(cut(await svg(leaf(fitsLeaf)))).toBe(false);
    expect(cut(await svg(leaf(`${fitsLeaf}ii`)))).toBe(true);
    const person = (name: string) => `person p "${name}"\nsystem s "S" {\n a = sys/server "A"\n}\np -> s.a\nview v { include *; expand s }\n`;
    const fitsPerson = justFits(WIDEST_TITLE_ROOM.person, 13);
    expect(cut(await svg(person(fitsPerson)))).toBe(false);
    expect(cut(await svg(person(`${fitsPerson}ii`)))).toBe(true);
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
