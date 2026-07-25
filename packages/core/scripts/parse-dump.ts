// Dev utility: parse a .squinch file and dump the tree (or errors).
import { readFileSync } from "node:fs";
// @ts-ignore generated, no types yet
import { parser } from "../src/grammar/parser.js";

const src = readFileSync(process.argv[2], "utf8");
const tree = parser.parse(src);
let errors = 0;
tree.iterate({
  enter(n: any) {
    if (n.type.isError) {
      errors++;
      const line = src.slice(0, n.from).split("\n").length;
      console.log(`ERROR at line ${line}: ...${JSON.stringify(src.slice(Math.max(0, n.from - 20), n.to + 20))}...`);
    }
  },
});
if (process.env.DUMP) console.log(tree.toString());
console.log(errors === 0 ? "PARSE OK" : `${errors} parse errors`);
