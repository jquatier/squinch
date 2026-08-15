// Copies the brand assets the site serves into the SPA's public dir, so the
// app carries no second copy of anything — same reasoning as sync-packs.ts and
// sync-lookbook.ts: docs/assets is already the source of truth, so this only
// ever reads it.
//
// The mark lands as favicon.svg and is then used for *both* jobs: the tab icon
// and the visible logo on every page. There is one file because there is one
// drawing — four byte-identical copies of it used to live in the tree, which is
// four chances for the brand to drift. docs/assets/mark.svg is the canonical
// one; docs/assets/mark-stack.svg is the layered mark, generated from it by
// scripts/mark-stack.mts and used where the logo can be shown large.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const assetsDir = join(root, "docs", "assets");
const publicDir = join(here, "..", "public");

mkdirSync(publicDir, { recursive: true });

/** [source in docs/assets, name under public/] */
const FILES: [string, string][] = [
  ["mark.svg", "favicon.svg"],
  ["mark-stack.svg", "mark-stack.svg"], // the layered mark, for the landing hero
  ["prompt-light.gif", "prompt-light.gif"],
  ["prompt-dark.gif", "prompt-dark.gif"],
  ["zoom-light.gif", "zoom-light.gif"],
  ["zoom-dark.gif", "zoom-dark.gif"],
];
for (const [from, to] of FILES) copyFileSync(join(assetsDir, from), join(publicDir, to));

console.log(`sync-media: ${FILES.length} brand assets → apps/spa/public/`);
