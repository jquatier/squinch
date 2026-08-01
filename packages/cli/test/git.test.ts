// git.ts had no tests: three functions, and `loadInputAtRef` is what
// `squinch diff --since` stands on. Its failure modes are all user-visible —
// a diagram added since the ref, a ref that does not exist, a directory with
// nothing tracked in it — and each one has to come back as `undefined` rather
// than throwing, because the caller reads that as "nothing to compare against".
//
// Driven against a real temporary repo: mocking git would test the mock.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isGitRepo, repoRoot, loadInputAtRef } from "../src/git.js";

let repo: string;
let plain: string;
const run = (args: string[], cwd: string) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
  });

beforeAll(() => {
  // realpath: macOS puts tmp behind a symlink, and `rev-parse --show-toplevel`
  // resolves it — so the raw mkdtemp path would never compare equal
  repo = realpathSync(mkdtempSync(join(tmpdir(), "squinch-git-")));
  plain = realpathSync(mkdtempSync(join(tmpdir(), "squinch-plain-")));

  run(["init", "-q", "-b", "main"], repo);
  mkdirSync(join(repo, "proj"));
  writeFileSync(join(repo, "solo.squinch"), `a = box "A"\n`);
  writeFileSync(join(repo, "proj", "one.squinch"), `a = box "One"\n`);
  writeFileSync(join(repo, "proj", "two.squinch"), `b = box "Two"\n`);
  writeFileSync(join(repo, "proj", "notes.md"), "not a diagram\n");
  run(["add", "-A"], repo);
  run(["commit", "-qm", "first"], repo);

  // a second commit that changes one file and adds another, so "at HEAD~1"
  // is meaningfully different from "on disk"
  writeFileSync(join(repo, "solo.squinch"), `a = box "A renamed"\n`);
  writeFileSync(join(repo, "proj", "three.squinch"), `c = box "Three"\n`);
  run(["add", "-A"], repo);
  run(["commit", "-qm", "second"], repo);
});
afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(plain, { recursive: true, force: true });
});

describe("isGitRepo", () => {
  it("is true inside a repo and false outside one", () => {
    expect(isGitRepo(repo)).toBe(true);
    expect(isGitRepo(plain)).toBe(false);
  });

  it("is true in a subdirectory, not just the root", () => {
    expect(isGitRepo(join(repo, "proj"))).toBe(true);
  });
});

describe("repoRoot", () => {
  it("resolves the root from a subdirectory", () => {
    expect(repoRoot(join(repo, "proj"))).toBe(repo);
  });
});

describe("loadInputAtRef", () => {
  it("reads a single file as it was at a ref", () => {
    const now = loadInputAtRef(join(repo, "solo.squinch"), "HEAD");
    expect(now).toHaveLength(1);
    expect(now![0].name).toBe("solo.squinch");
    expect(now![0].src).toContain("A renamed");

    const before = loadInputAtRef(join(repo, "solo.squinch"), "HEAD~1");
    expect(before![0].src).toContain('box "A"');
    expect(before![0].src).not.toContain("renamed");
  });

  it("reads a directory as every .squinch in it, sorted, ignoring other files", () => {
    const files = loadInputAtRef(join(repo, "proj"), "HEAD");
    expect(files!.map((f) => f.name)).toEqual(["one.squinch", "three.squinch", "two.squinch"]);
    // notes.md is in that directory and must not come through
    expect(files!.some((f) => f.name.endsWith(".md"))).toBe(false);
  });

  it("sees the directory as it was, not as it is", () => {
    // three.squinch only exists in the second commit
    const before = loadInputAtRef(join(repo, "proj"), "HEAD~1");
    expect(before!.map((f) => f.name)).toEqual(["one.squinch", "two.squinch"]);
  });

  it("returns undefined for a file that did not exist at the ref", () => {
    // the newly-added-diagram case: `diff --since` must read this as
    // "nothing to compare", not as an error
    expect(loadInputAtRef(join(repo, "proj", "three.squinch"), "HEAD~1")).toBeUndefined();
  });

  it("returns undefined for a ref that does not exist", () => {
    expect(loadInputAtRef(join(repo, "solo.squinch"), "no-such-ref")).toBeUndefined();
    expect(loadInputAtRef(join(repo, "proj"), "no-such-ref")).toBeUndefined();
  });

  it("returns undefined for a directory with no tracked diagrams", () => {
    mkdirSync(join(repo, "empty"), { recursive: true });
    expect(loadInputAtRef(join(repo, "empty"), "HEAD")).toBeUndefined();
  });
});
