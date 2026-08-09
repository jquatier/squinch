// Model-facing pack surface. Real artwork lives in installed packs (see
// ../packs/registry.ts); builtin/sys are renderer-drawn glyphs.
import {
  hasIcon, hasPack, iconIds as registryIconIds, iconTitle, glyph, packNames,
  iconColor, packMonochrome, packFullBleed,
} from "../packs/registry.js";

export interface IconMeta {
  /** Fallback plate text when a pack has no artwork (builtin/sys glyphs). */
  code: string;
  color: string;
}

export function iconMeta(pack: string, id: string): IconMeta | undefined {
  const g = glyph(pack, id);
  if (g) return g;
  if (!hasIcon(pack, id)) return undefined;
  return { code: "", color: iconColor(pack, id) ?? "#6F6E69" };
}

// `iconColor` is undefined for packs that publish no colours, which is the
// honest test for "is this a brand mark?" — `iconMeta` folds a neutral grey in
// as a fallback, and a renderer that read that could not tell a trademark from
// our own generic vocabulary.
export { packMonochrome, packFullBleed, iconColor };

export function iconExists(pack: string, id: string): boolean {
  return hasIcon(pack, id);
}

export function packExists(pack: string): boolean {
  return hasPack(pack);
}

export function iconIds(pack: string): string[] {
  return registryIconIds(pack);
}

export function allPackNames(): string[] {
  return packNames();
}

export { iconTitle };
