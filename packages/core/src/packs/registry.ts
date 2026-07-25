// Pack registry: manifest + lazily-sanitized assets. A pack is a directory with
// a pack.json and an icons/ folder — the same shape third parties will ship.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { sanitizeIcon, type SanitizedIcon } from "./sanitize.js";

export interface PackManifest {
  name: string;
  title: string;
  release?: string;
  source?: string;
  license?: string;
  attribution?: string;
  icons: Record<string, { file: string; title: string; category?: string }>;
  aliases?: Record<string, string>;
}

export interface Pack {
  manifest: PackManifest;
  dir: string;
}

/** Built-in fallbacks: no assets, drawn by the renderer itself. */
export const BUILTIN_GLYPHS: Record<string, Record<string, { code: string; color: string }>> = {
  builtin: {
    box: { code: "▢", color: "#6F6E69" },
    person: { code: "☺", color: "#6F6E69" },
  },
  sys: {
    api: { code: "API", color: "#6F6E69" },
    webapp: { code: "WEB", color: "#6F6E69" },
    mobile: { code: "MOB", color: "#6F6E69" },
    service: { code: "SVC", color: "#6F6E69" },
    worker: { code: "WRK", color: "#6F6E69" },
    database: { code: "DB", color: "#6F6E69" },
    cache: { code: "$", color: "#6F6E69" },
    queue: { code: "Q", color: "#6F6E69" },
    "event-bus": { code: "BUS", color: "#6F6E69" },
    filestore: { code: "FS", color: "#6F6E69" },
    search: { code: "SRCH", color: "#6F6E69" },
    gateway: { code: "GW", color: "#6F6E69" },
    auth: { code: "AUTH", color: "#6F6E69" },
    monitor: { code: "MON", color: "#6F6E69" },
    scheduler: { code: "CRON", color: "#6F6E69" },
    org: { code: "ORG", color: "#6F6E69" },
    internet: { code: "NET", color: "#6F6E69" },
  },
};

const packs = new Map<string, Pack>();
const assetCache = new Map<string, SanitizedIcon>();

function tryLoad(packageName: string, packName: string): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates: string[] = [];
  try {
    const require = createRequire(import.meta.url);
    candidates.push(dirname(require.resolve(`${packageName}/pack.json`)));
  } catch {
    /* not installed via node resolution — fall back to workspace layout */
  }
  candidates.push(join(here, "..", "..", "..", packageName.replace("@squinch/", "")));
  candidates.push(join(here, "..", "..", "..", "..", packageName.replace("@squinch/", "")));

  for (const dir of candidates) {
    const manifestPath = join(dir, "pack.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PackManifest;
    packs.set(packName, { manifest, dir });
    return;
  }
}

tryLoad("@squinch/pack-aws", "aws");

/** Resolve an id through the pack's alias table. */
function canonical(pack: Pack, id: string): string | undefined {
  if (pack.manifest.icons[id]) return id;
  const alias = pack.manifest.aliases?.[id];
  return alias && pack.manifest.icons[alias] ? alias : undefined;
}

export function hasIcon(packName: string, id: string): boolean {
  if (BUILTIN_GLYPHS[packName]?.[id]) return true;
  const pack = packs.get(packName);
  return !!pack && !!canonical(pack, id);
}

export function hasPack(packName: string): boolean {
  return !!BUILTIN_GLYPHS[packName] || packs.has(packName);
}

export function packNames(): string[] {
  return [...new Set([...Object.keys(BUILTIN_GLYPHS), ...packs.keys()])].sort();
}

export function iconIds(packName: string): string[] {
  const builtin = BUILTIN_GLYPHS[packName];
  if (builtin) return Object.keys(builtin);
  const pack = packs.get(packName);
  if (!pack) return [];
  return [...Object.keys(pack.manifest.icons), ...Object.keys(pack.manifest.aliases ?? {})].sort();
}

export function iconTitle(packName: string, id: string): string | undefined {
  const pack = packs.get(packName);
  if (!pack) return undefined;
  const key = canonical(pack, id);
  return key ? pack.manifest.icons[key].title : undefined;
}

/** Sanitized, inlinable artwork — or undefined for builtin/glyph packs. */
export function iconAsset(packName: string, id: string): SanitizedIcon | undefined {
  const pack = packs.get(packName);
  if (!pack) return undefined;
  const key = canonical(pack, id);
  if (!key) return undefined;
  const cacheKey = `${packName}/${key}`;
  const cached = assetCache.get(cacheKey);
  if (cached) return cached;
  const svg = readFileSync(join(pack.dir, "icons", pack.manifest.icons[key].file), "utf8");
  const asset = sanitizeIcon(svg, `${packName}-${key}`);
  assetCache.set(cacheKey, asset);
  return asset;
}

/** Stable symbol id for an inlined icon. */
export const symbolId = (packName: string, id: string): string => {
  const pack = packs.get(packName);
  const key = pack ? canonical(pack, id) ?? id : id;
  return `sq-${packName}-${key}`;
};

export function glyph(packName: string, id: string): { code: string; color: string } | undefined {
  return BUILTIN_GLYPHS[packName]?.[id];
}

export function packInfo(packName: string): PackManifest | undefined {
  return packs.get(packName)?.manifest;
}
