// Glyph artwork resolves and is tinted via currentColor. `builtin` (person, box)
// is drawn in core because it is language sugar; `sys` is a real disk pack
// (Lucide, ISC) and goes through the same plate-and-tint path via
// `monochrome: true` rather than a hardcoded pack name.
import { describe, it, expect } from "vitest";
import { render } from "../src/index.js";
import { validateSVG } from "../src/render/validate.js";
import { iconAsset, BUILTIN_GLYPHS } from "../src/packs/registry.js";

describe("glyph artwork", () => {
  it("every builtin glyph id has drawn art", () => {
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
  glyph: sys/code
  a = aws/lambda "A"
}
ops -> shop.a
legacy -> shop.a
view landscape { include * }
`;
    const r = await render(src, { view: "landscape", theme: "light" });
    expect(r.ok).toBe(true);
    expect(validateSVG(r.svg!).ok).toBe(true);
    for (const sym of ["sq-sys-code", "sq-builtin-person", "sq-builtin-box"])
      expect(r.svg).toContain(`href="#${sym}"`);
    // badge tinted muted, plates tinted plate-text
    expect(r.svg).toContain(`<g color="#6F6E69"><use href="#sq-sys-code"`);
    // no lettered-placeholder fallback: sys is a real pack with real art now,
    // and `builtin` is the only pseudo-pack left with `code` strings at all
    expect(r.svg).not.toContain(">API</text>");
  });
});
