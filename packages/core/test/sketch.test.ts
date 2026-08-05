// Sketch themes: deterministically rough. Same source → byte-identical wobble
// (the lockfile model must hold); any source edit re-rolls the jitter; the
// hand-lettered Caveat faces are embedded and measured, never approximated.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { render } from "../src/index.js";
import { validateSVG } from "../src/render/validate.js";

const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(pkg, "examples/orders.squinch"), "utf8");

describe("sketch themes", () => {
  it("renders valid SVG in both sketch variants, Caveat embedded", async () => {
    for (const theme of ["sketch", "sketch-dark"]) {
      const r = await render(src, { theme });
      expect(r.ok, theme).toBe(true);
      expect(validateSVG(r.svg!).ok, theme).toBe(true);
      expect(r.svg).toContain("font-family:SquinchCaveat");
      expect(r.svg).toContain(`font-family="SquinchCaveat, Caveat, cursive"`);
      expect(r.svg).not.toContain("SquinchInter"); // one family per render
      expect(r.svg).not.toContain("<script");
    }
  });

  it("same source → byte-identical roughness (seeded, never random)", async () => {
    const a = await render(src, { theme: "sketch" });
    const b = await render(src, { theme: "sketch" });
    expect(b.svg).toBe(a.svg);
  });

  it("a source edit re-rolls the jitter", async () => {
    const a = await render(src, { theme: "sketch" });
    const b = await render(src.replace("Orders Table", "Order Table"), { theme: "sketch" });
    // strip text content; compare only path geometry — the wobble itself moved
    const geometry = (s: string) => (s.match(/ d="M[^"]+"/g) ?? []).join("\n");
    expect(geometry(b.svg!)).not.toBe(geometry(a.svg!));
  });

  it("sketch type is scaled up and measured with Caveat metrics", async () => {
    const r = await render(src, { theme: "sketch" });
    expect(r.svg).toContain(`font-size="17"`); // 13 × 1.3 rounded
    expect(r.svg).not.toContain(`font-size="13"`);
  });
});

describe("sketch + edge styles", () => {
  it("keeps the class and dash pattern through the rough.js rewrite", async () => {
    // The sketch renderer rewrites the path's `d`; the class and dasharray are
    // attached outside that rewrite, so a styled animated edge must survive.
    const withAttrs = `pack aws
system s "S" {
  a = aws/lambda "A"
  b = aws/lambda "B"
  a ~> b "beat" { animate: packets }
  a -> b "poll" { style: dotted }
}`;
    const r = await render(withAttrs, { theme: "sketch" });
    expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
    expect(r.svg).toContain(`class="sq-pk"`);
    expect(r.svg).toContain(`stroke-dasharray="3 15"`);
    expect(r.svg).toContain(`stroke-dasharray="2 3"`);
    expect(validateSVG(r.svg!).ok).toBe(true);
  });
});
