// Pack registry — pure and browser-safe. Hosts supply assets:
//   Node  : registerPackFromDisk() in ./node-fs.ts (used by the CLI + tests)
//   Browser: registerPack() with a fetch-backed loader, then preloadIcons()
// Rendering itself stays synchronous, so assets must be resident before render.
import { SYS_GLYPH_ART, SYS_GLYPH_VIEWBOX } from "./sysGlyphs.js";
import { sanitizeIcon, type SanitizedIcon } from "./sanitize.js";

export interface PackManifest {
  name: string;
  title: string;
  release?: string;
  source?: string;
  license?: string;
  attribution?: string;
  icons: Record<string, { file: string; title: string; category?: string; color?: string }>;
  aliases?: Record<string, string>;
  /** single-colour marks (e.g. Simple Icons): the renderer plates and tints
   *  them rather than drawing the artwork on a neutral background. */
  monochrome?: boolean;
}

/** Returns raw SVG text for a pack-relative file. May be async (browser). */
export type AssetLoader = (file: string) => string | Promise<string>;

interface Registered {
  manifest: PackManifest;
  load: AssetLoader;
}

/** Built-in fallbacks: no assets, drawn by the renderer itself.
 *
 *  `sys` used to live here too. It is a real disk pack now (@squinch/pack-sys,
 *  Lucide), and a name present in BOTH this map and the pack registry is a trap:
 *  `iconIds` short-circuits on this map, so every disk icon would vanish from
 *  search, completions and `squinch icons` while `hasIcon` still accepted it. */
export const BUILTIN_GLYPHS: Record<string, Record<string, { code: string; color: string }>> = {
  builtin: {
    box: { code: "▢", color: "#6F6E69" },
    person: { code: "☺", color: "#6F6E69" },
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
  // first-party glyph artwork ships in-core (browser-safe, no preload needed)
  const art = SYS_GLYPH_ART[packName]?.[id];
  if (art) return { viewBox: SYS_GLYPH_VIEWBOX, body: art };
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

/** True when a pack's artwork is single-colour and wants the plate treatment. */
export function packMonochrome(packName: string): boolean {
  return packs.get(packName)?.manifest.monochrome === true;
}

/** A pack's declared brand colour for an icon, if it has one. */
export function iconColor(packName: string, id: string): string | undefined {
  const pack = packs.get(packName);
  if (!pack) return undefined;
  const key = canonical(pack, id);
  return key ? pack.manifest.icons[key]?.color : undefined;
}

export function packInfo(packName: string): PackManifest | undefined {
  return packs.get(packName)?.manifest;
}
