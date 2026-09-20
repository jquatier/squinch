// Browser entry: everything from the core pipeline, minus the Node pack source.
// Hosts register packs themselves:
//
//   import { registerPack, preloadIcons, render } from "@squinch/core/browser";
//   registerPack(manifest, (file) => fetch(`/icons/${file}`).then(r => r.text()));
//   await preloadIcons(iconsUsedBy(source));
//   const { svg } = await render(source, { view, theme });
export * from "./api.js";
export { registerPack, preloadIcons, packInfo, iconIds, hasIcon, glyph } from "./packs/registry.js";
export type { PackManifest, AssetLoader } from "./packs/registry.js";
// The camera's DOM half — browser entry only, and unstable: the playground's
// pan and zoom. The interactive export bundles the same function directly.
export { attachCamera } from "./view/camera-dom.js";
export type { CameraHandle, CameraOpts } from "./view/camera-dom.js";
