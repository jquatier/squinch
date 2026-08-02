// The interactive HTML export.
//
// Nothing here proves the *interaction* works — that took a browser, and the
// only mechanism that genuinely cannot be checked without a layout engine is
// `<use href="#…">` resolving across `<svg>` element boundaries, which is what
// the whole hoisting strategy rests on. What these do assert is everything a
// forwarded file has to be true about regardless of who opens it: deterministic,
// self-contained, and script-free where it matters.
import { describe, it, expect } from "vitest";
import { exportHTML, validateSVG } from "../src/index.js";

const SRC = `pack aws

person shopper "Shopper"

system web "Storefront" {
  description: "React SPA"
  cdn = aws/cloudfront "CloudFront"
  s3  = aws/s3 "Bucket"
  cdn -> s3 "origin"
}

system api "API" {
  gw  = aws/api-gateway "Gateway"
  fn  = aws/lambda "Handler"
  db  = aws/dynamodb "Table" datastore
  gw -> fn
  fn -> db "read / write"
}

system ops "Ops" {          // no view of its own — the auto-view case
  dash = aws/cloudwatch "Dashboards"
}

legacy = box "Legacy" external

shopper -> web.cdn "browses"
web.cdn -> api.gw "REST"
api.fn -> legacy "sync"
ops.dash -> api.gw "scrapes"

flow trip "A round trip" {
  shopper -> web.cdn -> api.gw
  api.gw -> api.fn -> api.db
}

view landscape { include * }
view web { scope web }
view api { scope api }
view story { include *; show flow trip }
`;

const files = [{ name: "shop.squinch", src: SRC }];
const svgsIn = (html: string) => html.match(/<svg\b[\s\S]*?<\/svg>/g) ?? [];
const idsIn = (html: string) => [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);

describe("interactive HTML export", () => {
  it("bundles every declared view, once per palette", async () => {
    const r = await exportHTML(files);
    expect(r.ok).toBe(true);
    expect(r.manifest.views).toEqual(["landscape", "web", "api", "story"]);
    // the default pair: the project's theme and its `pairsWith` counterpart, so
    // the file follows the reader's OS without a click
    expect(r.manifest.themes).toEqual(["light", "dark"]);
    // Two hops, not four: `story` includes the systems as cards, so the
    // shopper→cdn→gw steps lift and aggregate into one. `flow.steps` counts
    // what renders *at this altitude*, which is the whole point of it.
    expect(r.manifest.flows).toEqual({ story: 2 });
    expect(r.manifest.renders).toBe(4 * 2 + 2 * 2);
  });

  it("bakes one frame per hop, and can be told not to", async () => {
    // `flow.steps` counts hops that render *at this altitude*, which is exactly
    // what a presenter can walk to
    const withSteps = await exportHTML(files);
    expect(withSteps.html).toContain('data-key="story|light|1"');
    expect(withSteps.html).toContain('data-key="story|light|2"');
    expect(withSteps.html).not.toContain('data-key="story|light|3"');
    expect(withSteps.html).toContain('"flows":{"story":2}');

    const without = await exportHTML(files, { flowSteps: false });
    expect(without.manifest.flows).toEqual({});
    expect(without.manifest.renders).toBe(8);
    expect(without.html!.length).toBeLessThan(withSteps.html!.length);
  });

  it("is byte-identical across builds", async () => {
    // determinism is a non-negotiable, and this artifact carries a generated JS
    // bundle — the one place it could leak in
    const a = await exportHTML(files);
    const b = await exportHTML(files);
    expect(a.html).toBe(b.html);
    expect(a.html!.endsWith("\n")).toBe(true);
    expect(a.html).not.toContain("\r");
  });

  it("fetches nothing — every reference is a fragment or a data URI", async () => {
    const { html } = await exportHTML(files);
    const refs = [...html!.matchAll(/(?:href|src)="([^"]*)"/g)].map((m) => m[1]);
    const external = refs.filter((u) => !u.startsWith("#") && !u.startsWith("data:"));
    expect(external, `external references: ${external.join(", ")}`).toEqual([]);
    expect(html).not.toContain("<script src");
    expect(html).not.toContain("<link");
    expect(html).not.toContain("@import");
    // the SVG namespace is the only absolute URL a self-contained file needs
    const urls = new Set([...html!.matchAll(/https?:\/\/[^"\s)]+/g)].map((m) => m[0]));
    expect([...urls]).toEqual(["http://www.w3.org/2000/svg"]);
  });

  it("keeps the script beside the SVGs, never inside one", async () => {
    // CLAUDE.md's rule is that an exported SVG contains no JS. This artifact is
    // the exception, and this is the mechanical form of it: exactly two script
    // elements (the JSON payload and the viewer), and once they are removed
    // nothing executable is left anywhere in the document.
    const { html } = await exportHTML(files);
    expect(html!.match(/<script/g)).toHaveLength(2);
    expect(html).toContain('<script type="application/json" id="sq-data">');
    const stripped = html!.replace(/<script[\s\S]*?<\/script>/g, "");
    expect(stripped).not.toContain("<script");
    expect(stripped).not.toMatch(/\son[a-z]+=/i);
    expect(stripped).not.toContain("javascript:");
    for (const svg of svgsIn(html!)) {
      expect(svg).not.toContain("<script");
      expect(svg).not.toMatch(/\son[a-z]+=/i);
    }
  });

  it("embeds SVGs a real XML parser still accepts", async () => {
    // the same gate every rendered SVG passes elsewhere — hoisting defs out of
    // a document is exactly the kind of surgery that can unbalance one
    const { html } = await exportHTML(files);
    const svgs = svgsIn(html!);
    expect(svgs.length).toBe(13); // 12 bodies + the shared sprite
    for (const svg of svgs) expect(validateSVG(svg).ok).toBe(true);
  });

  it("hoists the font once and the icons once", async () => {
    const { html } = await exportHTML(files);
    // two faces (400/500) of one family, for the whole document — not per view
    expect(html!.match(/@font-face/g)).toHaveLength(2);
    const symbols = [...html!.matchAll(/<symbol id="([^"]+)"/g)].map((m) => m[1]);
    expect(symbols.length).toBeGreaterThan(3);
    expect(new Set(symbols).size).toBe(symbols.length);
  });

  it("has no duplicate ids, and every reference resolves", async () => {
    // the direct test of the hoisting strategy: one definition serves every
    // view, so a `<use href="#sq-aws-lambda">` in view three must find the
    // symbol emitted once at the top
    const { html } = await exportHTML(files);
    const ids = idsIn(html!);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes, `duplicate ids: ${[...new Set(dupes)].join(", ")}`).toEqual([]);
    const refs = new Set([...html!.matchAll(/(?:href="#|url\(#)([^")]+)/g)].map((m) => m[1]));
    const unresolved = [...refs].filter((r) => !ids.includes(r));
    expect(unresolved, `dangling: ${unresolved.join(", ")}`).toEqual([]);
  });

  it("gives each palette its own hatch, because that def is themed", async () => {
    // `sq-hatch` bakes `t.border`. It is the only def whose content depends on
    // the theme, and without a per-palette id a dark view would draw the
    // light-theme texture — the failure `defsScope` exists to prevent.
    const { html } = await exportHTML(files);
    // the sprite is emitted in id order, which is an implementation detail —
    // what matters is that both exist and differ
    const hatches = [...html!.matchAll(/<pattern id="(sq-hatch[^"]*)"[^>]*>.*?stroke="([^"]+)"/g)];
    expect(hatches.map((m) => m[1]).sort()).toEqual(["sq-hatch-dark", "sq-hatch-light"]);
    expect(hatches[0][2]).not.toBe(hatches[1][2]);
  });

  it("renders its entry view with no script at all", async () => {
    // progressive enhancement is the point of inlining the entry body: a wiki
    // that strips <script>, or a reader with JS off, still gets a diagram
    const { html } = await exportHTML(files);
    const noScript = html!.replace(/<script[\s\S]*?<\/script>/g, "");
    const live = /<div id="sq-live">([\s\S]*?)<\/div>/.exec(noScript);
    expect(live).not.toBeNull();
    expect(live![1]).toContain("<svg");
    expect(live![1]).toContain('data-path="web"');
  });

  it("can open on a chosen view, and refuses one that does not exist", async () => {
    const ok = await exportHTML(files, { view: "api" });
    expect(ok.ok).toBe(true);
    expect(ok.html).toContain('"entry":"api"');

    const bad = await exportHTML(files, { view: "nope" });
    expect(bad.ok).toBe(false);
    expect(bad.diagnostics.some((d) => d.message.includes("unknown view `nope`"))).toBe(true);
  });

  it("takes one palette when asked, and halves the bodies", async () => {
    const one = await exportHTML(files, { themes: ["light"] });
    expect(one.manifest.renders).toBe(6);
    expect(one.html!.length).toBeLessThan((await exportHTML(files)).html!.length);
  });

  it("includes the auto views only on request", async () => {
    // every container gets one (`build.ts`), so `all` makes every card a zoom
    // target at the cost of file size — the same call `--sync` makes
    const declared = await exportHTML(files);
    const all = await exportHTML(files, { views: "all" });
    expect(all.manifest.views.length).toBeGreaterThan(declared.manifest.views.length);
  });

  it("says so when there is nothing to export", async () => {
    const r = await exportHTML([{ name: "x.squinch", src: `a = box "A"\n` }]);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.message.includes("declares no views"))).toBe(true);
  });
});
