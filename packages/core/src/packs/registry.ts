// Pack registry — pure and browser-safe. Hosts supply assets:
//   Node  : registerPackFromDisk() in ./node-fs.ts (used by the CLI + tests)
//   Browser: registerPack() with a fetch-backed loader, then preloadIcons()
// Rendering itself stays synchronous, so assets must be resident before render.
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

/** Returns raw SVG text for a pack-relative file. May be async (browser). */
export type AssetLoader = (file: string) => string | Promise<string>;

interface Registered {
  manifest: PackManifest;
  load: AssetLoader;
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

const packs = new Map<string, Registered>();
const assets = new Map<string, SanitizedIcon>();

export function registerPack(manifest: PackManifest, load: AssetLoader): void {
  packs.set(manifest.name, { manifest, load });
}

function canonical(pack: Registered, id: string): string | undefined {
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

/** Stable symbol id — aliases collapse onto their canonical icon. */
export const symbolId = (packName: string, id: string): string => {
  const pack = packs.get(packName);
  const key = pack ? canonical(pack, id) ?? id : id;
  return `sq-${packName}-${key}`;
};

const cacheKey = (packName: string, key: string) => `${packName}/${key}`;

/** Synchronous lookup used by the renderer; undefined until loaded. */
export function iconAsset(packName: string, id: string): SanitizedIcon | undefined {
  const pack = packs.get(packName);
  if (!pack) return undefined;
  const key = canonical(pack, id);
  if (!key) return undefined;
  const hit = assets.get(cacheKey(packName, key));
  if (hit) return hit;
  // Node loaders are synchronous: resolve inline so callers need no preload.
  const raw = pack.load(pack.manifest.icons[key].file);
  if (typeof raw !== "string") return undefined; // async source → must preload
  const asset = sanitizeIcon(raw, `${packName}-${key}`);
  assets.set(cacheKey(packName, key), asset);
  return asset;
}

/** Resolve assets ahead of a synchronous render (browsers). */
export async function preloadIcons(refs: { pack: string; id: string }[]): Promise<void> {
  await Promise.all(
    refs.map(async ({ pack: packName, id }) => {
      const pack = packs.get(packName);
      if (!pack) return;
      const key = canonical(pack, id);
      if (!key || assets.has(cacheKey(packName, key))) return;
      const raw = await pack.load(pack.manifest.icons[key].file);
      assets.set(cacheKey(packName, key), sanitizeIcon(raw, `${packName}-${key}`));
    }),
  );
}

export function glyph(packName: string, id: string): { code: string; color: string } | undefined {
  return BUILTIN_GLYPHS[packName]?.[id];
}

export function packInfo(packName: string): PackManifest | undefined {
  return packs.get(packName)?.manifest;
}
