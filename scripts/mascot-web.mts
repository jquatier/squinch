// Generates docs/assets/mascot-web.png — the copy of the mascot the site
// actually serves, signing the hero demo panel's corner — from
// docs/assets/mascot.png, the full drawing.
//
//   npx tsx scripts/mascot-web.mts
//
// Maintainer-only, like mark-stack.mts, and for the same reason: the master
// is the one file a human touches, and everything derived from it is a
// re-run rather than a memory. The master is 1246px and 1.4MB; the mascot
// never renders taller than 108px (site.css), so the web copy is trimmed to
// its alpha bounds, resampled to 240px tall (2x the largest render, enough
// for any display the landing meets) and reduced to a 256-colour palette,
// which lands at ~20KB with no edge halo — the transparent margin is cut
// before quantising so the palette is spent on the figure, not on nothing.
//
// The resampling is Pillow's, driven through python3, because nothing in
// the workspace decodes or resizes a PNG (resvg only rasterises SVG) and a
// native image dependency is a lot to install for one file that changes
// when the mascot is redrawn. Pillow's Lanczos and octree quantiser are
// deterministic, so re-running on the same master reproduces the bytes.
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "docs", "assets", "mascot.png");
const out = join(root, "docs", "assets", "mascot-web.png");
const HEIGHT = 240;

const py = `
import sys
try:
    from PIL import Image
except ImportError:
    sys.exit("mascot-web: needs Pillow — pip install pillow")
im = Image.open(sys.argv[1]).convert("RGBA")
im = im.crop(im.getchannel("A").getbbox())
h = int(sys.argv[3]); w = round(im.width * h / im.height)
web = im.resize((w, h), Image.LANCZOS)
q = web.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG)
q.save(sys.argv[2], optimize=True)
print(f"mascot-web: {w}x{h} → {sys.argv[2]}")
`;
execFileSync("python3", ["-c", py, src, out, String(HEIGHT)], { stdio: "inherit" });
