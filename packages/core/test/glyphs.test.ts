// First-party glyphs: every sys/* and builtin id has real monoline artwork,
// tinted via currentColor — no more lettered placeholder plates.
import { describe, it, expect } from "vitest";
import { render } from "../src/index.js";
import { validateSVG } from "../src/render/validate.js";
import { iconAsset, BUILTIN_GLYPHS } from "../src/packs/registry.js";

describe("sys glyph artwork", () => {
  it("every declared glyph id has drawn art", () => {
    for (const [pack, ids] of Object.entries(BUILTIN_GLYPHS))
      for (const id of Object.keys(ids)) {
        const asset = iconAsset(pack, id);
        expect(asset, `${pack}/${id}`).toBeDefined();
        expect(asset!.body).toContain('stroke="currentColor"');
      }
  });

  it("card badges and plates render the artwork, tinted per theme", async () => {
    const src = `pack aws
person ops "Operators"
legacy = box "Legacy" external
system shop "Shop" {
  glyph: sys/api
  a = aws/lambda "A"
}
ops -> shop.a
legacy -> shop.a
view landscape { include * }
`;
    const r = await render(src, { view: "landscape", theme: "light" });
    expect(r.ok).toBe(true);
    expect(validateSVG(r.svg!).ok).toBe(true);
    for (const sym of ["sq-sys-api", "sq-builtin-person", "sq-builtin-box"])
      expect(r.svg).toContain(`href="#${sym}"`);
    // badge tinted muted, plates tinted plate-text
    expect(r.svg).toContain(`<g color="#6F6E69"><use href="#sq-sys-api"`);
    expect(r.svg).not.toContain(">API</text>");
  });
});
