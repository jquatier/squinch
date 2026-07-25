// Input resolution: a path is either one .squinch file or a project directory
// (all .squinch files in it merge into one model namespace — SPEC §2).
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import type { ProjectFile } from "@squinch/core";

export interface Input {
  files: ProjectFile[];
  /** Base name used for output files: the file stem, or the directory name. */
  base: string;
  dir: string;
}

export function loadInput(path: string): Input {
  const abs = resolve(path);
  if (!existsSync(abs)) throw new Error(`no such file or directory: ${path}`);
  if (statSync(abs).isDirectory()) {
    const names = readdirSync(abs).filter((n) => n.endsWith(".squinch")).sort();
    if (names.length === 0) throw new Error(`no .squinch files in ${path}`);
    return {
      files: names.map((n) => ({ name: n, src: readFileSync(join(abs, n), "utf8") })),
      base: basename(abs),
      dir: abs,
    };
  }
  return {
    files: [{ name: basename(abs), src: readFileSync(abs, "utf8") }],
    base: basename(abs).replace(/\.squinch$/, ""),
    dir: resolve(abs, ".."),
  };
}
