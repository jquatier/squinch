// Keeps the playground's built-in examples identical to examples/ in the repo.
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const pick = [
  { name: "Microservices (zoom)", file: "examples/microservices/shop.squinch" },
  { name: "Order service", file: "examples/orders/orders.squinch" },
];
const starter = readFileSync(join(root, "packages/cli/src/index.ts"), "utf8")
  .match(/const STARTER = `([\s\S]*?)`;/)![1];

const examples = [
  ...pick.map((p) => ({ name: p.name, source: readFileSync(join(root, p.file), "utf8") })),
  { name: "Starter", source: starter },
];
writeFileSync(
  join(here, "..", "src", "examples.ts"),
  `// GENERATED from examples/ by scripts/sync-examples.ts — do not edit.\n` +
    `export const EXAMPLES: { name: string; source: string }[] = ${JSON.stringify(examples, null, 2)};\n`,
);
console.log(`wrote ${examples.length} examples`);
