// Reading a project as it was at a git ref, so `diff` can answer "what
// changed since main?" without the caller stashing anything.
import { execFileSync } from "node:child_process";
import { relative, resolve, basename } from "node:path";
import { statSync, existsSync } from "node:fs";
import type { ProjectFile } from "@squinch/core";
import { toPosix } from "./paths.js";

const git = (args: string[], cwd: string): string =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

export function isGitRepo(cwd: string): boolean {
  try {
    git(["rev-parse", "--git-dir"], cwd);
    return true;
  } catch {
    return false;
  }
}

/** Repo-relative POSIX path — what git wants, on every platform. */
function repoPath(abs: string, root: string): string {
  return toPosix(relative(root, abs));
}

/** POSIX, like everything else this module returns: `git rev-parse` already
 *  answers with forward slashes on Windows, and a caller comparing it against a
 *  `path.join`ed string would otherwise be comparing two spellings of one
 *  directory. */
export function repoRoot(cwd: string): string {
  return toPosix(git(["rev-parse", "--show-toplevel"], cwd).trim());
}

/**
 * The project at `ref`, matching how loadInput reads it from disk: one file,
 * or every .squinch in a directory. Returns undefined when the path did not
 * exist at that ref (a newly added diagram).
 */
export function loadInputAtRef(path: string, ref: string): ProjectFile[] | undefined {
  const abs = resolve(path);
  const root = repoRoot(existsSync(abs) && statSync(abs).isDirectory() ? abs : resolve(abs, ".."));
  const rel = repoPath(abs, root);
  const isDir = existsSync(abs) ? statSync(abs).isDirectory() : !rel.endsWith(".squinch");

  if (!isDir) {
    try {
      return [{ name: basename(rel), src: git(["show", `${ref}:${rel}`], root) }];
    } catch {
      return undefined;
    }
  }

  let listing: string;
  try {
    listing = git(["ls-tree", "-r", "--name-only", ref, "--", rel], root);
  } catch {
    return undefined;
  }
  const names = listing.split("\n").filter((n) => n.endsWith(".squinch")).sort();
  if (!names.length) return undefined;
  return names.map((n) => ({
    name: n.slice(n.lastIndexOf("/") + 1),
    src: git(["show", `${ref}:${n}`], root),
  }));
}
