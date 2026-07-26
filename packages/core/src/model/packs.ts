// Model-facing pack surface. Real artwork lives in installed packs (see
// ../packs/registry.ts); builtin/sys are renderer-drawn glyphs.
import {
  hasIcon, hasPack, iconIds as registryIconIds, iconTitle, glyph, packNames,
  iconColor, packMonochrome,
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

export { packMonochrome };

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
