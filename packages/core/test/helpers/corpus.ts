// Every `.squinch` file the repo owns, discovered rather than listed — a new
// example or lookbook case is covered the day it lands, without anyone
// remembering to add it here.
//
// Four sources, and they are deliberately different in character: `examples/`
// ships, `lookbook/cases/` stresses, `gauntlet/solutions/` is what cold agents
// actually wrote, and `packages/core/examples/` is the canonical pair the
// goldens are cut from. Between them they are the most varied real input the
// project has.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

const SOURCES = ["lookbook/cases", "examples", "gauntlet/solutions", "packages/core/examples"];

export interface CorpusFile {
  /** repo-relative, and the label used in every failure message */
  name: string;
  src: string;
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".squinch")) out.push(p);
  }
}

/** Sorted, so a failure list reads the same on every machine. */
export function corpus(): CorpusFile[] {
  const paths: string[] = [];
  for (const s of SOURCES) walk(join(root, s), paths);
  return paths
    .sort()
    .map((p) => ({ name: relative(root, p), src: readFileSync(p, "utf8") }));
}
