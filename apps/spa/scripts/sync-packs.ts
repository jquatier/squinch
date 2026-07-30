// Copies every installed pack into public/ so the browser can fetch manifests
// and icons as static assets.
//
// These used to be committed by hand — 442 duplicate SVGs tracked alongside the
// packs they were copied from, free to drift the moment a pack was regenerated
// and nobody remembered to re-copy. They are build output, so they are
// generated on dev/build and gitignored.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
// Everything in public/ is generated and gitignored, so on a fresh clone the
// directory does not exist at all — git tracks no empty directories.
const publicDir = join(here, "..", "public");
mkdirSync(publicDir, { recursive: true });

/** Every pack the playground offers. One line to add another. */
const PACKS = ["@squinch/pack-aws", "@squinch/pack-azure", "@squinch/pack-logos", "@squinch/pack-sys"];

for (const pkg of PACKS) {
  const root = dirname(require.resolve(`${pkg}/pack.json`));
  const manifest = JSON.parse(readFileSync(join(root, "pack.json"), "utf8"));
  const name: string = manifest.name;
  writeFileSync(join(publicDir, `pack-${name}.json`), JSON.stringify(manifest));
  const dest = join(publicDir, `${name}-icons`);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(join(root, "icons"), dest, { recursive: true });
  console.log(`${name}: ${Object.keys(manifest.icons).length} icons`);
}
