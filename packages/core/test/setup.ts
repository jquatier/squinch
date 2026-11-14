// Register disk-backed packs, exactly as the Node entry point does.
import "../src/packs/node-fs.js";

// SQUINCH_ENGINE=weft runs the whole suite on the engine written to replace
// ELK (src/layout/weft) — the way the two are compared before the swap.
import { setLayoutEngine } from "../src/layout/layout.js";
if (process.env.SQUINCH_ENGINE === "weft") setLayoutEngine("weft");
