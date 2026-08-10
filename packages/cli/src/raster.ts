// SVG → PNG, for the places an SVG won't go: slide decks, Confluence, chat.
//
// The subtlety is fonts. Our SVGs embed the subsetted face as a base64 woff2
// via @font-face, which browsers honour — but resvg does not support
// @font-face at all (linebender/resvg#541, open and blocked on WOFF2 support),
// so left alone it would silently rasterize with whatever it found on the
// machine. That is precisely the environment dependence the project forbids, and
// it fails quietly: you get a PNG, it just isn't the diagram you designed.
//
// So we hand resvg the same faces the metrics were measured from, as sfnt, and
// switch system fonts off entirely. Nothing about the output can then depend on
// what happens to be installed.
import { createRequire } from "node:module";
import { Resvg } from "@resvg/resvg-js";

const require = createRequire(import.meta.url);

/** The sfnt twins of the embedded woff2 faces, emitted by core's gen-fonts.
 *  All of them, always: a face the SVG asks for and this list omits does not
 *  fail, it silently rasterizes in the nearest weight resvg does have. The
 *  restyle added Inter 600 (a view's title) and IBM Plex Mono (a zone's
 *  `detail:` segment) without extending this list, so every PNG of a titled
 *  diagram drew its heading a weight light. Keep this in step with
 *  `BASE_FACES` and the mono usage in core's render/svg.ts. */
const FACES = ["inter-400", "inter-500", "inter-600", "mono-400"];

let fontFiles: string[] | undefined;
function faces(): string[] {
  return (fontFiles ??= FACES.map((f) => require.resolve(`@squinch/core/fonts/${f}.ttf`)));
}

export interface RasterOpts {
  /** Output width in px. Height follows from the diagram's aspect ratio.
   *  Omitted, the SVG's own pixel dimensions are used (1×). */
  width?: number;
  /** Flatten onto this colour instead of leaving the canvas transparent. */
  background?: string;
}

export function svgToPng(svg: string, opts: RasterOpts = {}): Buffer {
  const resvg = new Resvg(svg, {
    font: {
      loadSystemFonts: false, // non-negotiable: no environment in the output
      fontFiles: faces(),
      defaultFontFamily: "Inter",
    },
    ...(opts.width ? { fitTo: { mode: "width" as const, value: opts.width } } : {}),
    ...(opts.background ? { background: opts.background } : {}),
  });
  return resvg.render().asPng();
}
