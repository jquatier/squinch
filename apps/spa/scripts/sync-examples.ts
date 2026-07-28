// Keeps the playground's built-in examples identical to the repo's own.
//
// Everything is discovered rather than listed. The previous version named the
// projects it wanted, and by the time there were four it was shipping two —
// a hand-maintained list of things that already exist on disk only ever drifts
// in one direction.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");

interface Example {
  name: string;
  group: string;
  source: string;
}

/** The label is the slug, tidied. Whatever a directory or case file is called
 *  is what shows up in the picker, so the name in the list is the name on disk
 *  when you go looking for it — and there is no override table to keep in step
 *  with either. */
const title = (slug: string) =>
  slug.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());

/** A project is a directory; its .squinch files share one namespace, and the
 *  playground edits one buffer, so they arrive concatenated in a stable order. */
function project(dir: string): string {
  const files = readdirSync(dir).filter((f) => f.endsWith(".squinch")).sort();
  return files.map((f) => readFileSync(join(dir, f), "utf8").trim()).join("\n\n") + "\n";
}

const examplesDir = join(root, "examples");
// Alphabetical. EXAMPLES[0] is what loads on a first visit, so the order here
// decides the landing diagram; leaving it to the filesystem keeps this file
// free of opinions about which one that should be.
const examples: Example[] = readdirSync(examplesDir)
  .filter((d) => statSync(join(examplesDir, d)).isDirectory())
  .sort()
  .map((slug) => ({
    name: title(slug),
    group: "Examples",
    source: project(join(examplesDir, slug)),
  }));

const starter = readFileSync(join(root, "packages/cli/src/index.ts"), "utf8")
  .match(/const STARTER = `([\s\S]*?)`;/)![1];
examples.push({ name: "Starter", group: "Examples", source: starter });

// The lookbook is the stress-case set: the awkward shapes worth poking at
// live, and the fastest way to see what a construct actually draws.
const casesDir = join(root, "lookbook", "cases");
for (const f of readdirSync(casesDir).filter((n) => n.endsWith(".squinch")).sort())
  examples.push({
    name: title(f.replace(/^\d+-/, "").replace(/\.squinch$/, "")),
    group: "Lookbook",
    source: readFileSync(join(casesDir, f), "utf8"),
  });

writeFileSync(
  join(here, "..", "src", "examples.ts"),
  `// GENERATED from examples/ and lookbook/cases/ by scripts/sync-examples.ts — do not edit.\n` +
    `export const EXAMPLES: { name: string; group: string; source: string }[] = ` +
    `${JSON.stringify(examples, null, 2)};\n`,
);
console.log(`wrote ${examples.length} examples`);
