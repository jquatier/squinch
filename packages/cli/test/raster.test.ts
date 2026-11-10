// A PNG draws mono text in the mono face. resvg resolves a font-family stack
// its own way: with `'IBM Plex Mono'` quoted after the unknown `SquinchMono`,
// it fell through to its default, Inter — so every mono run in every PNG (zone
// details, titleblock commits, field types and chips) was drawn in a face the
// metrics were not measured from, and chips sized for mono showed a gap on the
// right. The SVG was right all along; only the raster path was wrong.
import { describe, it, expect } from "vitest";
import { render } from "@squinch/core";
import { rasterize } from "../src/raster.js";

/** The rightmost column holding ink, in px — how wide the text came out. */
const inkWidth = (svg: string) => {
  const img = rasterize(svg);
  let right = -1;
  for (let y = 0; y < img.height; y++)
    for (let x = img.width - 1; x > right; x--)
      if (img.pixels[(y * img.width + x) * 4 + 3] > 128) { right = x; break; }
  return right + 1;
};
const line = (family: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="40" viewBox="0 0 400 40">` +
  `<text x="0" y="28" font-size="20" font-family="${family}">iiiiiiii</text></svg>`;

describe("PNG export draws mono text in the mono face", () => {
  it("resolves the stack core actually emits", async () => {
    // take the stack from a real render, so the test follows whatever core writes
    const r = await render(
      `a = sys/table "A" { fields { id uuid pk } }\nview v { include *\n preview a }`,
      { view: "v", theme: "light" },
    );
    expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
    const stack = /font-family="([^"]*SquinchMono[^"]*)"/.exec(r.svg!)?.[1];
    expect(stack).toBeDefined();
    // eight i's: narrow in Inter, a full monospace advance each in Plex Mono
    const mono = inkWidth(line(stack!));
    const inter = inkWidth(line("SquinchInter, Inter, system-ui, sans-serif"));
    expect(mono).toBeGreaterThan(inter * 2);
  });
});
