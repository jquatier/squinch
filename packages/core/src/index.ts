// Node entry: registers packs found on disk, then re-exports the pipeline.
import "./packs/node-fs.js";
export * from "./api.js";
export { registerPack, preloadIcons, packInfo } from "./packs/registry.js";
export type { PackManifest, AssetLoader } from "./packs/registry.js";
