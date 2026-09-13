// The version stamp: `data-squinch="<toolVersion>"` on the root <svg>.
//
// Output is deterministic *per tool version*, and the SVG is the artifact
// that travels — so the version rides in the SVG (docs/notes/version-stamp.md).
// Core emits it only when a host hands it the version: it is isomorphic and
// has no manifest to read, and the goldens, the lookbook and every other
// direct caller must stay byte-identical. The load-bearing property here is
// the third test: the stamp is the *only* difference, which is what lets
// `render --check` strip it from both sides and compare the picture alone.
import { describe, it, expect } from "vitest";
import { render } from "../src/index.js";
import { validateSVG } from "../src/render/validate.js";
import { mergeAdaptive, AdaptivePairError } from "../src/render/adaptive.js";

const SRC = `pack aws
system s "Shop" {
  api  = aws/api-gateway "API"
  fn   = aws/lambda "Handler"
  db   = aws/dynamodb "Table"
  api -> fn "REST"
  fn -> db
}`;

const STAMP = /\sdata-squinch="([^"]*)"/g;
const unstamp = (svg: string) => svg.replace(STAMP, "");

describe("the version stamp", () => {
  it("is absent unless asked for", async () => {
    const r = await render(SRC, { theme: "light" });
    expect(r.ok).toBe(true);
    expect(r.svg).not.toContain("data-squinch");
  });

  it("sits last on the root tag, exactly once, and the SVG still parses", async () => {
    const r = await render(SRC, { theme: "light", toolVersion: "1.2.3" });
    expect(r.ok).toBe(true);
    const svg = r.svg!;
    expect(svg).toMatch(/^<svg[^>]*\sdata-squinch="1\.2\.3">/);
    expect([...svg.matchAll(STAMP)]).toHaveLength(1);
    expect(validateSVG(svg).ok).toBe(true);
    // width/height stay adjacent — three scripts read them as a pair off this tag
    expect(svg).toMatch(/<svg[^>]*\swidth="\d+" height="\d+"/);
  });

  it("is the only difference", async () => {
    // the strongest form of "the goldens are unaffected", and the property
    // `render --check` leans on when it compares renders across versions
    const plain = (await render(SRC, { theme: "light" })).svg!;
    const stamped = (await render(SRC, { theme: "light", toolVersion: "1.2.3" })).svg!;
    expect(stamped).not.toBe(plain);
    expect(unstamp(stamped)).toBe(plain);
  });

  it("escapes the value rather than trusting it", async () => {
    const r = await render(SRC, { theme: "light", toolVersion: 'a"<b>' });
    expect(r.ok).toBe(true);
    expect(r.svg).toContain('data-squinch="a&quot;&lt;b&gt;"');
    expect(validateSVG(r.svg!).ok).toBe(true);
    // the root tag still ends where the merge's indexOf(">") expects it to
    const rootEnd = r.svg!.indexOf(">");
    expect(r.svg!.slice(0, rootEnd)).toContain("data-squinch=");
  });

  it("survives the adaptive merge, once", async () => {
    const r = await render(SRC, { theme: "light", adaptive: true, toolVersion: "1.2.3" });
    expect(r.ok).toBe(true);
    const svg = r.svg!;
    expect(svg).toContain("prefers-color-scheme: dark");
    expect([...svg.matchAll(STAMP)]).toHaveLength(1);
    expect(svg).toMatch(/^<svg[^>]*\sdata-squinch="1\.2\.3">/);
    expect(validateSVG(svg).ok).toBe(true);
  });

  it("refuses to merge two halves that disagree about who drew them", async () => {
    // the merge walks attributes positionally and only ever writes colour
    // rules; a version mismatch is geometry to it, and it must say so rather
    // than silently keep one
    const light = (await render(SRC, { theme: "light", toolVersion: "1.2.3" })).svg!;
    const dark = (await render(SRC, { theme: "dark", toolVersion: "1.2.4" })).svg!;
    expect(() => mergeAdaptive(light, dark)).toThrow(AdaptivePairError);
  });
});
