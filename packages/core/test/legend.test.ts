// The legend band (SPEC §5, docs/notes/legend.md) — the entries the author
// wrote that this view draws, in the author's words, under the drawing — and
// the titleblock. What parses and what checks is legend-block.test.ts; which
// entries a view matches is legend-match.test.ts.
import { describe, it, expect } from "vitest";
import { render, buildModel, renderProject, formatDiagnostics, layoutView, themes } from "../src/index.js";
import { validateSVG } from "../src/render/validate.js";
import { mergeAdaptive } from "../src/render/adaptive.js";
import { hueOf } from "../src/themes/index.js";
import { corpus } from "./helpers/corpus.js";

const BASE = `pack aws
system s "S" {
  a = aws/lambda "API"
  q = aws/sqs "Queue" datastore
  w = aws/lambda "Worker"
  a ~> q "enqueue"
  a -> w "health"
}`;
const size = (svg: string) => svg.match(/<svg[^>]*width="(\d+)" height="(\d+)"/)!.slice(1).map(Number);
const labels = (svg: string) =>
  [...svg.matchAll(/<text x="\d+" y="\d+" font-size="11" fill="[^"]+">([^<]*)<\/text>/g)]
    .map((m) => m[1].replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&"));
/** From the band's hairline — a full-width line in the border colour — to the end. */
const bandOf = (svg: string) => svg.slice(svg.search(/<line x1="0" y1="(\d+)" x2="\d+" y2="\1" stroke="#[0-9A-F]{6}" stroke-width="1"\/>/));

describe("the legend band", () => {
  it("draws the written entries the view has marks for, in written order, in the author's words", async () => {
    const r = await render(`${BASE}\nview s {\n legend {\n  ~> "Queued work"\n  <-> "Never drawn here"\n  -> "Health check"\n }\n}`, { theme: "light" });
    expect(r.ok).toBe(true);
    expect(r.diagnostics).toEqual([]);
    expect(labels(r.svg!).slice(-2)).toEqual(["Queued work", "Health check"]);
    expect(r.svg).not.toContain("Never drawn here");
    // no wordmark, no title — the band is the entries and a hairline
    expect(r.svg).not.toContain(">squinch</text>");
    expect(validateSVG(r.svg!).ok).toBe(true);
  });

  it("adds a band under the drawing, and draws none when nothing matches", async () => {
    const plain = (await render(`${BASE}\nview s { }`, { theme: "light" })).svg!;
    const keyed = (await render(`${BASE}\nview s { legend { -> "Call" } }`, { theme: "light" })).svg!;
    const unmatched = (await render(`${BASE}\nview s { legend { -- "Related" } }`, { theme: "light" })).svg!;
    expect(size(keyed)[0]).toBe(size(plain)[0]);
    expect(size(keyed)[1]).toBe(size(plain)[1] + 34);
    expect(unmatched).toBe(plain);
  });

  it("wraps into rows at the canvas width, and only an entry wider than the canvas widens it", async () => {
    const plain = (await render(`${BASE}\nview s { }`, { theme: "light" })).svg!;
    const [w, h] = size(plain);
    const many = `legend {\n  -> "Health check every few seconds"\n  ~> "Work queued for the worker to drain"\n}`;
    const wrapped = (await render(`${BASE}\nview s { ${many} }`, { theme: "light" })).svg!;
    expect(size(wrapped)).toEqual([w, h + 34 + 24]);
    const long = "A label far wider than this small drawing could ever hold on one line";
    const wide = (await render(`${BASE}\nview s { legend { -> "${long}" } }`, { theme: "light" })).svg!;
    expect(size(wide)[0]).toBeGreaterThan(w);
    expect(wide).toContain(`>${long}</text>`);
  });

  it("samples each mark the way the diagram draws it, in the theme's own colours", async () => {
    const src = `pack aws
system s "S" {
  a = aws/lambda "A"
  b = aws/lambda "B" { color: red }
  c = aws/lambda "C"
  d = aws/lambda "D"
  a -> b { color: red }
  b ~> c { style: dotted }
  c <-> d
  a -- d
}
x = aws/lambda "X" external
s.a -> x
view s {
  scope s
  color #t teal
  legend { -> "Call"  ~> "Event"  <-> "Both"  -- "Related"  external "Theirs"  context "Elsewhere" }
}`;
    const r = await render(src, { theme: "light" });
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const band = bandOf(r.svg!);
    const t = themes.light;
    // `->` in the theme's edge colour, not the red its one edge wears
    expect(band).toContain(`stroke="${t.edge}" stroke-width="1.5"/><path d="M`);
    // `~>` dotted, because every async edge here is; an open chevron
    expect(band).toContain(`stroke="${t.asyncEdge}" stroke-width="1.5" stroke-dasharray="2 3"/><path d="M`);
    // `<->` two filled heads after its line, `--` a bare line
    expect(band).toMatch(new RegExp(`stroke="${t.edge}" stroke-width="1.5"/><path d="M[^"]+" fill="${t.edge}"/><path d="M[^"]+" fill="${t.edge}"/>`));
    expect(band).toMatch(new RegExp(`stroke="${t.edge}" stroke-width="1.5"/><text`));
    expect(band).toContain(`url(#sq-hatch`);
    expect(band).toContain(`stroke-dasharray="4 3"`);
    expect(labels(band)).toEqual(["Call", "Event", "Both", "Related", "Theirs", "Elsewhere"]);
  });

  it("keys a tag with a chip in the lens's hue", async () => {
    const src = `${BASE.replace('a = aws/lambda "API"', 'a = aws/lambda "API" #money')}\nview s {\n color #money teal\n legend { #money "Money path" }\n}`;
    const svg = (await render(src, { theme: "light" })).svg!;
    expect(svg).toContain(`width="12" height="12" rx="3" fill="${hueOf(themes.light, "teal")}"/>`);
    expect(svg).toContain(">Money path</text>");
  });

  it("survives the adaptive merge with every swatch kind", async () => {
    const src = `pack aws
system s "S" { tags: #m
  a = aws/lambda "A"
  b = aws/lambda "B"
  c = aws/lambda "C"
  a ~> b
  b <-> c
}
system t "T" { p = aws/lambda "P"\n q = aws/lambda "Q" }
x = aws/lambda "X" external
s.a -> t.p
s.b -- t.q
s.c -> x
view v {
  expand s
  color #m green
  legend { #m "M"  -> "Call"  ~> "Event"  <-> "Both"  -- "Rel"  aggregated "Merged"  external "Theirs" }
}`;
    const light = await renderProject([{ name: "a.squinch", src }], { view: "v", theme: "light" });
    expect(light.ok, formatDiagnostics(light.diagnostics)).toBe(true);
    const dark = await renderProject([{ name: "a.squinch", src }], { view: "v", theme: "dark" });
    const merged = mergeAdaptive(light.svg!, dark.svg!);
    expect(validateSVG(merged).ok).toBe(true);
    expect(merged).toContain(hueOf(themes.light, "green"));
    expect(merged).toContain(hueOf(themes.dark, "green"));
  });
});

describe("`legend auto`, retired", () => {
  it("still renders — with no legend — and the warning names the keys to write", async () => {
    const r = await render(`${BASE}\nview s {\n legend auto\n}`, { theme: "light" });
    expect(r.ok).toBe(true);
    expect(r.svg).toBe((await render(`${BASE}\nview s { }`, { theme: "light" })).svg);
    expect(r.diagnostics.map((d) => [d.severity, d.message, d.fix, d.loc.line])).toEqual([[
      "warning",
      "a legend shows only the entries you write, so `legend auto` draws nothing — this view draws `->` and `~>`",
      "write a `legend { }` block with a line for each, saying what it means here, or delete the line",
      10,
    ]]);
  });

  it("a bare `legend` says the same, and a view with nothing to key says to delete it", async () => {
    const bare = await render(`${BASE}\nview s {\n legend\n}`, { theme: "light" });
    expect(bare.diagnostics.map((d) => d.message)).toEqual([
      "a legend shows only the entries you write, so `legend auto` draws nothing — this view draws `->` and `~>`",
    ]);
    const lone = await render(`a = box "A"\nview v {\n legend auto\n}`, { theme: "light" });
    expect(lone.diagnostics.map((d) => [d.message, d.fix])).toEqual([[
      "a legend shows only the entries you write, so `legend auto` draws nothing — and this view draws nothing a legend keys",
      "delete the line",
    ]]);
  });

  it("writing a line for each key the warning names checks clean", async () => {
    const r = await render(`${BASE}\nview s {\n legend auto\n}`, { theme: "light" });
    const keys = [...r.diagnostics[0].message.split("this view draws ")[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    const block = `legend {\n${keys.map((k) => `  ${k} "What ${k} means here"`).join("\n")}\n }`;
    const fixed = await render(`${BASE}\nview s {\n ${block}\n}`, { theme: "light" });
    expect(fixed.diagnostics).toEqual([]);
    expect(labels(fixed.svg!).slice(-keys.length)).toEqual(keys.map((k) => `What ${k} means here`));
  });
});

describe("the corpus", () => {
  it("every legend the repo ships checks clean — no `legend auto` left, nothing unmatched", async () => {
    const withLegend = corpus().filter((f) => /^\s*legend\b/m.test(f.src));
    expect(withLegend.length).toBeGreaterThan(10);
    const said: string[] = [];
    for (const f of withLegend) {
      const built = buildModel(f.src);
      for (const v of built.model.views.filter((x) => x.legend)) {
        const r = await renderProject([{ name: f.name, src: f.src }], { view: v.name, theme: "light" });
        for (const d of r.diagnostics.filter((x) => x.message.includes("legend")))
          said.push(`${f.name} ${v.name}: ${d.message}`);
        // a legend every one of whose entries the view lacks is a mistake
        // nothing else catches: it checks clean and draws no band
        if (v.legend && "entries" in v.legend) {
          const { positioned } = await layoutView(built.model, v);
          if (!(positioned.legend && "entries" in positioned.legend && positioned.legend.entries.length))
            said.push(`${f.name} ${v.name}: draws none of its entries`);
        }
      }
    }
    expect(said).toEqual([]);
  });
});

describe("titleblock", () => {
  it("parses titleblock attrs", () => {
    const r = buildModel(`${BASE}\nview s {\n titleblock {\n  version: "2026-07"\n  owner: team-payments\n }\n}`);
    expect(r.ok).toBe(true);
    expect(r.model.views.find((x) => x.name === "s")!.titleblock).toEqual({ version: "2026-07", owner: "team-payments" });
  });

  it("draws the title, with or without a titleblock beside it", async () => {
    // `title` used to render only *inside* the bottom-right titleblock, so a
    // view that named itself and nothing else drew nothing at all — a
    // documented gotcha rather than a feature. The header owns the title now,
    // and a titleblock only adds the meta chip under it.
    const src = `${BASE}\nview s {\n title "Payments — settlement path"\n titleblock {\n  version: "2026-07"\n  status: "draft"\n }\n}`;
    const withTb = await render(src, { theme: "light" });
    const without = await render(`${BASE}\nview s { title "Payments — settlement path" }`, { theme: "light" });
    expect(withTb.ok).toBe(true);
    expect(withTb.svg).toContain("Payments — settlement path");
    expect(without.svg).toContain("Payments — settlement path");
    const h = (s: string) => +s.match(/height="(\d+)"/)![1];
    expect(h(withTb.svg!)).toBeGreaterThan(h(without.svg!));
    expect(validateSVG(withTb.svg!).ok).toBe(true);
  });

  it("keeps an arbitrary key with its value, and lets a reserved one speak alone", async () => {
    // `2026-07` reads as a version unaided; `draft` alone says nothing, so the
    // key rides with it. Dropping either would drop the fact.
    const src = `${BASE}\nview s {\n title "T"\n titleblock {\n  version: "2026-07"\n  status: "draft"\n }\n}`;
    const r = await render(src, { theme: "light" });
    expect(r.svg).toContain(">2026-07</text>");
    expect(r.svg).toContain(">status</text>");
    expect(r.svg).toContain(">draft</text>");
    expect(r.svg).not.toContain(">version</text>"); // the value is self-describing
    expect(validateSVG(r.svg!).ok).toBe(true);
  });
});
