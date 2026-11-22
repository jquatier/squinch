// Prose — a view's `about` and a note's text: block strings, the closed set of
// formatting (prose.ts), and the rule that prose is drawn whole. The load-
// bearing promises: nothing an author wrote is cut without the check saying
// so, formatting outside the set is reported rather than drawn as a surprise,
// a link only ever reaches an href as http(s), and a render with no `about`
// and plain notes is the render it always was (golden.test.ts holds that).
import { describe, it, expect } from "vitest";
import { buildModel, diffModels, render } from "../src/index.js";
import { parseProse, setProse, runWidth, type ProseFont } from "../src/prose.js";
import { unquote } from "../src/model/source.js";
import { noteBox, NOTE_LINES } from "../src/layout/sizes.js";
import { validateSVG } from "../src/render/validate.js";

const font: ProseFont = { size: 12, pitch: 19, gap: 7, indent: 14, fam: "inter" };

describe("block strings", () => {
  it("strip the quotes, the line breaks just inside them, and the indentation every line shares", () => {
    expect(unquote('"""\n    first\n      second\n\n    third\n  """')).toBe("first\n  second\n\nthird");
    expect(unquote('"""on one line"""')).toBe("on one line");
    expect(unquote('"plain"')).toBe("plain");
  });
  it("may hold one or two quotes, never three", () => {
    const r = buildModel(`a = box "A" { description: """say "hi" and ""bye"" """ }\nview v { include * }\n`);
    expect(r.diagnostics).toEqual([]);
    expect(r.model.nodes.get("a")!.description).toBe('say "hi" and ""bye""');
  });
  it("read as one line wherever one line is drawn", () => {
    const r = buildModel(`a = box """Order\n  service""" { description: """Takes\n  orders.\n\n  Never drops one.""" }\nview v { include * }\n`);
    expect(r.model.nodes.get("a")!.label).toBe("Order service");
    expect(r.model.nodes.get("a")!.description).toBe("Takes orders. Never drops one.");
  });
});

describe("parseProse", () => {
  it("reads paragraphs, bullets and a bullet's continuation", () => {
    const p = parseProse("One\ntwo.\n\n- a\n  still a\n- b");
    expect(p.blocks.map((b) => [b.bullet, b.runs.map((r) => r.text).join("")])).toEqual([
      [false, "One two."], [true, "a still a"], [true, "b"],
    ]);
  });
  it("reads bold, code and an http(s) link, left to right", () => {
    const [b] = parseProse("x **bold** `code` [site](https://x.dev/a?b=1) y").blocks;
    expect(b.runs).toEqual([
      { text: "x ", style: "plain" }, { text: "bold", style: "bold" }, { text: " ", style: "plain" },
      { text: "code", style: "code" }, { text: " ", style: "plain" },
      { text: "site", style: "link", href: "https://x.dev/a?b=1" }, { text: " y", style: "plain" },
    ]);
  });
  it("draws a marker with no partner as text", () => {
    expect(parseProse("a ** b ` c [d]").blocks[0].runs).toEqual([{ text: "a ** b ` c [d]", style: "plain" }]);
  });
  it("reports a heading and emphasis, which have no face, and a link that is not http(s)", () => {
    const p = parseProse("# Title\nthe *one* and _two_ [doc](./a.md) but order_id and 2*3*4 are text");
    expect(p.unsupported).toEqual(["a heading (`#`)", "emphasis (`*…*`)", "emphasis (`_…_`)"]);
    expect(p.badLinks).toEqual(["./a.md"]);
    expect(parseProse("snake_case_name and a*b*c").unsupported).toEqual([]);
  });
});

describe("setProse", () => {
  it("never cuts: every word is drawn, however long the text", () => {
    const text = Array.from({ length: 120 }, (_, i) => `word${i}`).join(" ");
    const set = setProse(parseProse(text), 200, font);
    expect(set.lines.flatMap((l) => l.segs.map((s) => s.text)).join(" ")).toBe(text);
    expect(set.lines.every((l) => l.segs.every((s) => s.x + s.w <= 200))).toBe(true);
  });
  it("places each run where the one before it ends, measured in its own face", () => {
    const [line] = setProse(parseProse("a **bold** word."), 400, font).lines;
    const [a, bold, rest] = line.segs;
    expect(bold.x).toBeCloseTo(a.x + runWidth("a", "plain", font) + runWidth(" ", "plain", font), 6);
    expect(rest.x).toBeCloseTo(bold.x + runWidth("bold", "bold", font) + runWidth(" ", "bold", font), 6);
  });
  it("stands a word wider than the column on a line of its own", () => {
    const set = setProse(parseProse("a supercalifragilisticexpialidocious b"), 60, font);
    expect(set.lines.map((l) => l.segs.map((s) => s.text).join(" "))).toEqual(["a", "supercalifragilisticexpialidocious", "b"]);
  });
});

describe("about", () => {
  const view = (body: string) => `a = box "A"\nb = box "B"\na -> b\nview v {\n  include *\n  title "T"\n${body}\n}\n`;
  it("keeps its lines on the view", () => {
    const r = buildModel(view(`  about """\n    First.\n\n    - one\n  """`));
    expect(r.diagnostics).toEqual([]);
    expect(r.model.views[0].about).toBe("First.\n\n- one");
  });
  it("is one per view: a second is an error that says to join them", () => {
    const r = buildModel(view(`  about "one"\n  about "two"`));
    expect(r.diagnostics.map((d) => [d.severity, d.message])).toEqual([["error", "view `v` already has an `about`"]]);
  });
  it("warns on formatting it would draw as typed, naming what it takes instead", () => {
    const r = buildModel(view(`  about "## Why *this* exists — [doc](docs/why.md)"`));
    expect(r.diagnostics.map((d) => d.message)).toEqual([
      "`about` uses a heading (`#`) and emphasis (`*…*`), which squinch draws as typed",
      "the link to `docs/why.md` in `about` is drawn as text",
    ]);
    expect(r.diagnostics[0].fix).toContain("**bold**");
  });
  it("is set in the header, the drawing below it, a link as a link", async () => {
    const plain = await render(view(""), { view: "v", theme: "light" });
    const r = await render(view(`  about """\n    Context **here**, \`code\` and [a link](https://example.com/a?b=1&c=2).\n  """`), { view: "v", theme: "light" });
    expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
    expect(validateSVG(r.svg!).ok).toBe(true);
    expect(r.svg).toContain(`<a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">`);
    expect(r.svg).toMatch(/font-weight="600"[^>]*>here</);
    const shift = (svg: string) => +/<g transform="translate\(\d+, (\d+)\)">/.exec(svg)![1];
    expect(shift(r.svg!)).toBeGreaterThan(shift(plain.svg!) + 19);
  });
  it("is deterministic", async () => {
    const src = view(`  about """\n    A paragraph with **bold**.\n\n    - and a bullet\n  """`);
    const [a, b] = [await render(src, { view: "v" }), await render(src, { view: "v" })];
    expect(a.svg).toBe(b.svg);
  });
  it("is a presentation change to `diff`, not a model one", () => {
    const d = diffModels(buildModel(view(`  about "one"`)).model, buildModel(view(`  about "two"`)).model);
    expect(d.changes.map((c) => [c.id, c.weight])).toEqual([["v", "cosmetic"]]);
  });
});

describe("notes", () => {
  const view = (note: string) => `a = box "A"\nb = box "B"\na -> b\nview v {\n  include *\n  note right-of a ${note}\n}\n`;
  it("are drawn whole — a note no longer stops at three lines", () => {
    const text = "One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty.";
    const box = noteBox(text, { metrics: "inter", scale: 1 });
    expect(box.prose.lines.length).toBeGreaterThan(3);
    expect(box.prose.lines.flatMap((l) => l.segs.map((s) => s.text)).join(" ")).toBe(text);
  });
  it("carry formatting", async () => {
    const r = await render(view(`"""\n    **Encrypted** at rest.\n\n    - reads by \`order_id\`\n  """`), { view: "v", theme: "light" });
    expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
    const note = r.svg!.slice(r.svg!.indexOf(`data-note="right-of:a"`));
    expect(note).toMatch(/font-weight="600"[^>]*>Encrypted</);
    expect(note).toContain(">order_id<");
    expect(note).not.toContain("**");
  });
  it(`warn past ${NOTE_LINES} lines, pointing at \`about\``, () => {
    const long = Array.from({ length: 40 }, () => "word").join(" ");
    const r = buildModel(view(`"${long}"`));
    expect(r.diagnostics.map((d) => d.message)).toEqual([expect.stringMatching(/^this note runs to \d+ lines$/)]);
    expect(r.diagnostics[0].fix).toContain("`about`");
    expect(buildModel(view(`"a short note"`)).diagnostics).toEqual([]);
  });
});
