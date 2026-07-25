// Browser entry: everything from the core pipeline, minus the Node pack source.
// Hosts register packs themselves:
//
//   import { registerPack, preloadIcons, render } from "@squinch/core/browser";
//   registerPack(manifest, (file) => fetch(`/icons/${file}`).then(r => r.text()));
//   await preloadIcons(iconsUsedBy(source));
//   const { svg } = await render(source, { view, theme });
export * from "./api.js";
export { registerPack, preloadIcons, packInfo, iconIds, hasIcon } from "./packs/registry.js";
export type { PackManifest, AssetLoader } from "./packs/registry.js";
