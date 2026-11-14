#!/usr/bin/env node
import { setLayoutEngine } from "@squinch/core";
import { main } from "./index.js";
// SQUINCH_ENGINE=weft lays views out with the engine written to replace ELK,
// so the two can be compared on real projects before the swap. Unset: ELK.
if (process.env.SQUINCH_ENGINE === "weft") setLayoutEngine("weft");
main(process.argv.slice(2)).then((code) => process.exit(code));
