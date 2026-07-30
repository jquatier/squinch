// Node-only pack source: finds installed packs on disk and registers them with
// synchronous loaders. Imported for side effect by the Node entry point.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { registerPack, type PackManifest } from "./registry.js";

export function registerPackFromDisk(packageName: string): boolean {
  const here = dirname(fileURLToPath(import.meta.url));
  const short = packageName.replace("@squinch/", "");
  const candidates: string[] = [];
  try {
    candidates.push(dirname(createRequire(import.meta.url).resolve(`${packageName}/pack.json`)));
  } catch {
    /* not resolvable via node — fall back to workspace layout */
  }
  candidates.push(join(here, "..", "..", "..", short));
  candidates.push(join(here, "..", "..", "..", "..", short));
  // bundled hosts (the VS Code extension) ship the pack beside their output
  candidates.push(join(here, short));
  candidates.push(join(here, "..", short));

  for (const dir of candidates) {
    const manifestPath = join(dir, "pack.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PackManifest;
    registerPack(manifest, (file) => readFileSync(join(dir, "icons", file), "utf8"));
    return true;
  }
  return false;
}

registerPackFromDisk("@squinch/pack-aws");
registerPackFromDisk("@squinch/pack-azure");
registerPackFromDisk("@squinch/pack-logos");
registerPackFromDisk("@squinch/pack-sys");
