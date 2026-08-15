// The brand mark is drawn once, in docs/assets/mark.svg, and everything else
// that shows it is derived from that file. Most of those derivations are
// structural and cannot drift: the site's favicon is copied at build time by
// apps/spa/scripts/sync-media.ts, and the layered mark reads its paths *and*
// its gradient stops out of mark.svg when scripts/mark-stack.mts regenerates
// docs/assets/mark-stack.svg.
//
// packages/vscode/icon.png is the exception. A VSIX needs a raster icon, so it
// is a committed PNG with no build step and nothing to re-run — which makes it
// the one copy that can silently fall behind a recolour. It nearly did: the
// mark's ramp was very nearly changed to the cooler indigo of the retired
// logo-dark.png, which would have left the extension wearing the old colours
// with no test to say so.
//
// So assert it here rather than remember it. This lives in the CLI's suite
// because the CLI owns the rasteriser (src/raster.ts) that can render the SVG
// to compare against; readme.test.ts sets the precedent for repo-wide content
// guards riding along in this package.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Resvg } from "@resvg/resvg-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Raw RGBA for an SVG rendered at `size` square. */
const pixelsOf = (svg: string, size: number) => {
  const img = new Resvg(svg, { fitTo: { mode: "width", value: size } }).render();
  return { w: img.width, h: img.height, px: img.pixels };
};

/** Raw RGBA for a PNG on disk — decoded by handing it back to the renderer as
 *  an embedded image, so this needs no decoder beyond the one already here. */
const pixelsOfPng = (file: string, size: number) => {
  const b64 = readFileSync(file).toString("base64");
  return pixelsOf(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
      `<image href="data:image/png;base64,${b64}" width="${size}" height="${size}"/></svg>`,
    size,
  );
};

describe("brand", () => {
  it("the VS Code extension's icon is docs/assets/mark.svg at 256px", () => {
    const SIZE = 256;
    const mark = pixelsOf(readFileSync(join(root, "docs/assets/mark.svg"), "utf8"), SIZE);
    const icon = pixelsOfPng(join(root, "packages/vscode/icon.png"), SIZE);

    expect([icon.w, icon.h], "icon.png is not 256x256").toEqual([mark.w, mark.h]);

    let worst = 0;
    let at = -1;
    for (let i = 0; i < mark.px.length; i++) {
      const d = Math.abs(mark.px[i] - icon.px[i]);
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    // Both sides go through the same rasteriser, so equality is exact — a
    // non-zero difference means the PNG was generated from different artwork,
    // not that the two renderers disagree.
    expect(
      worst,
      `icon.png differs from mark.svg (worst channel delta ${worst} at byte ${at}, ` +
        `pixel ${Math.floor(at / 4)}). Regenerate it from docs/assets/mark.svg at 256px.`,
    ).toBe(0);
  });
});
