// Exported SVGs embed the subsetted Inter faces so text renders identically
// everywhere (GitHub <img>, no-Inter machines) — matching the metrics tables.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { render } from "../src/index.js";
import { validateSVG } from "../src/render/validate.js";
import { FONTS } from "../src/fonts.generated.js";

const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(pkg, "examples/orders.squinch"), "utf8");

describe("font embedding", () => {
  it("embeds both weights as woff2 @font-face by default", async () => {
    const r = await render(src, { theme: "light" });
    expect(r.ok).toBe(true);
    for (const w of ["400", "500"] as const) {
      expect(r.svg).toContain(`font-weight:${w}`);
      expect(r.svg).toContain(FONTS[w].slice(0, 40)); // the actual data, not just a rule
    }
    expect(r.svg).toContain(`font-family="SquinchInter, Inter, system-ui, sans-serif"`);
    expect(validateSVG(r.svg!).ok).toBe(true);
    // still no scripts in exported SVG — non-negotiable
    expect(r.svg).not.toContain("<script");
  });

  it("embedFonts: false omits the faces but keeps the family stack", async () => {
    const r = await render(src, { theme: "light", embedFonts: false });
    expect(r.ok).toBe(true);
    expect(r.svg).not.toContain("@font-face");
    expect(r.svg).toContain(`font-family="SquinchInter, Inter, system-ui, sans-serif"`);
    expect(validateSVG(r.svg!).ok).toBe(true);
  });

  it("the generated subsets are real woff2", () => {
    for (const w of ["400", "500"] as const) {
      const bytes = Buffer.from(FONTS[w], "base64");
      expect(bytes.subarray(0, 4).toString("latin1")).toBe("wOF2");
      expect(bytes.length).toBeGreaterThan(4000);
    }
  });
});
