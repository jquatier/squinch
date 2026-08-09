// One SVG carrying both palettes, switched by prefers-color-scheme — so a
// diagram can be embedded somewhere the background isn't ours to pick.
//
// The load-bearing property is that the file is *exactly* the light render
// plus a stylesheet: nothing the emitters drew may be rewritten, because the
// icon artwork is verbatim third-party SVG that happens to share hex values
// with the theme. Both halves are checked by reconstruction rather than by
// spot-checking a few colours.
import { describe, it, expect } from "vitest";
import { render } from "../src/index.js";
import { validateSVG } from "../src/render/validate.js";
import { mergeAdaptive, AdaptivePairError } from "../src/render/adaptive.js";

const SRC = `pack aws
system s "Shop" {
  api  = aws/api-gateway "API"
  fn   = aws/lambda "Handler"
  db   = aws/dynamodb "Table"
  idx  = aws/opensearch "Index"
  api -> fn "REST"
  fn -> db
  db ~> idx "stream"
}`;

const light = async () => (await render(SRC, { theme: "light" })).svg!;
const dark = async () => (await render(SRC, { theme: "dark" })).svg!;
const adaptive = async () => (await render(SRC, { theme: "light", adaptive: true })).svg!;

/** Strip what merging added: the media query, and the classes it hung off. */
function stripAdditions(svg: string): string {
  return svg
    .replace(/<style>@media \(prefers-color-scheme: dark\)\{[^<]*\}<\/style>\n/, "")
    .replace(/ class="((?:sq-t\d+)(?: sq-t\d+)*)"/g, "")
    .replace(/ class="(sq-(?:flow(?:-[rsf])?|pk|pulse))(?: sq-t\d+)+"/g, ' class="$1"');
}

/** Apply the dark rules the way a browser in dark mode would: a class rule
 *  beats a presentation attribute, so each tagged element takes the override. */
function applyDarkRules(svg: string): string {
  const rules = new Map<string, [string, string]>();
  const style = /<style>@media \(prefers-color-scheme: dark\)\{(.*?)\}<\/style>/s.exec(svg);
  for (const m of (style?.[1] ?? "").matchAll(/\.(sq-t\d+)\{([\w-]+):([^};]+)\}/g))
    rules.set(m[1], [m[2], m[3]]);

  return svg.replace(/<[a-zA-Z][\w:.-]*[^>]*>/g, (tag) => {
    const cls = /\sclass="([^"]*)"/.exec(tag);
    if (!cls) return tag;
    let out = tag;
    for (const name of cls[1].split(" ")) {
      const rule = rules.get(name);
      if (!rule) continue;
      const [prop, value] = rule;
      out = out.replace(new RegExp(`\\s${prop}="[^"]*"`), ` ${prop}="${value}"`);
    }
    return out;
  });
}

describe("adaptive SVG", () => {
  it("is valid, script-free, and switches on prefers-color-scheme", async () => {
    const svg = await adaptive();
    expect(validateSVG(svg).ok).toBe(true);
    expect(svg).toContain("@media (prefers-color-scheme: dark)");
    expect(svg).not.toContain("<script");
    expect(svg).not.toMatch(/\son[a-z]+=/i);
  });

  it("leaves the light render byte-identical underneath", async () => {
    // If this drifts, the merge started rewriting the drawing rather than
    // annotating it — which is how third-party icon artwork gets recoloured.
    expect(stripAdditions(await adaptive())).toBe(await light());
  });

  it("reconstructs the dark render exactly when the dark rules apply", async () => {
    expect(stripAdditions(applyDarkRules(await adaptive()))).toBe(await dark());
  });

  it("keeps the flow animation class on animated edges", async () => {
    const svg = await adaptive();
    expect(svg).toMatch(/class="sq-flow(?: sq-t\d+)*"/);
    expect(svg).toContain("@keyframes sq-flow");
  });

  it("is deterministic", async () => {
    expect(await adaptive()).toBe(await adaptive());
  });

  it("refuses a theme with no dark counterpart, and says which have one", async () => {
    // `dark` is the counterpart, not a pairable base: an adaptive file is a
    // light render carrying a dark override, so asking dark to pair has no
    // answer. The fix names every theme that does.
    const r = await render(SRC, { theme: "dark", adaptive: true });
    expect(r.ok).toBe(false);
    const [d] = r.diagnostics;
    expect(d.message).toContain("no dark counterpart");
    expect(d.fix).toContain("light");
  });

  it("rejects a pair that disagrees about geometry rather than colour", async () => {
    const a = (await render(SRC, { theme: "light" })).svg!;
    const b = (await render(SRC, { theme: "dark" })).svg!.replace(
      /width="(\d+)"/,
      (_, w) => `width="${Number(w) + 1}"`,
    );
    expect(b).not.toBe((await render(SRC, { theme: "dark" })).svg!); // the mutation landed
    expect(() => mergeAdaptive(a, b)).toThrow(/geometry rather than colour/);
  });

  it("rejects a pair that did not draw the same diagram", async () => {
    // The hazard the skeleton compare exists for: two renders whose *shapes*
    // differ, not just their palettes. Cross-font pairing used to supply the
    // case (type metrics drive layout, so the dark half was a different
    // picture wearing the light one's geometry); with one font shipping, the
    // guard is proven by dropping an element instead. Either way `mergeAdaptive`
    // must refuse rather than silently emit a file that is half one diagram.
    const a = (await render(SRC, { theme: "light" })).svg!;
    const b = (await render(SRC, { theme: "dark" })).svg!.replace(/<text[^>]*>[^<]*<\/text>/, "");
    expect(() => mergeAdaptive(a, b)).toThrow(AdaptivePairError);
  });

  it("costs far less than shipping both files", async () => {
    const [l, d, a] = [await light(), await dark(), await adaptive()];
    expect(a.length).toBeLessThan(l.length + d.length);
    // the whole dark palette should be a rounding error on one render
    expect(a.length - l.length).toBeLessThan(l.length * 0.05);
  });
});

describe("adaptive + the animate vocabulary", () => {
  it("keeps sq-pulse through the merge, and the CSS is theme-identical", async () => {
    const src = `pack aws
system s "S" {
  a = aws/lambda "A"
  b = aws/lambda "B"
  a -> b "beat" { animate: pulse }
}`;
    const r = await render(src, { theme: "light", adaptive: true });
    expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
    expect(r.svg).toMatch(/class="sq-pulse(?: sq-t\d+)*"/);
    expect(r.svg).toContain("@keyframes sq-pulse");
    // one animation stylesheet, not one per palette — its text carries no
    // theme colour, so the merge's skeleton compare accepted it unchanged
    expect(r.svg!.match(/@keyframes sq-pulse/g)!.length).toBe(1);
  });
});
