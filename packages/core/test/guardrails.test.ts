// Ratchets: properties of the *source* that are cheap to hold and expensive to
// rediscover. Each one here is a bug that already happened, or a
// currently-clean state worth pinning so it stays clean.
//
// Source-level assertions, the same shape as skill.test.ts's diagnostic sweep.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildModel } from "../src/index.js";

const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(pkg, "..", "..");

const tsFiles = (dir: string): string[] => {
  const out: string[] = [];
  (function walk(d: string) {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".ts") && !p.includes("grammar/parser")) out.push(p);
    }
  })(dir);
  return out;
};

describe("half-typed input never crashes the builder", () => {
  // The editor spends most of its life holding a partial parse: the language
  // server rebuilds on every keystroke, so any `getChild(...)!` on a node the
  // grammar makes optional is a crash waiting for a pause mid-word. Round 4
  // found the first three (`scope`, `title`, `theme`); a generated-input spike
  // found nine more, every one a plausible keystroke.
  const HALF_TYPED: [string, string][] = [
    ["attr key, value not yet written", `system s "S" {\n a = box "A" {\n  tags:\n }\n}`],
    ["attr key, no colon yet", `system s "S" {\n a = box "A" {\n  tags\n }\n}`],
    ["zone attr, value not yet written", `a = box "A"\nzone z "Z" vpc {\n contains a\n color:\n}`],
    ["`note` alone", `a = box "A"\nview v { include *\n note }`],
    ["note anchored, text not yet written", `a = box "A"\nview v { include *\n note right-of a }`],
    ["note relpos, target not yet written", `a = box "A"\nview v { include *\n note right-of }`],
    ["`density` with no value", `a = box "A"\nview v { layout { density } }`],
    ["`lines` with no value", `a = box "A"\nview v { layout { lines } }`],
    ["`place` with no relpos", `a = box "A"\nb = box "B"\nview v { layout { place a } }`],
    ["`place` relpos, no target", `a = box "A"\nb = box "B"\nview v { layout { place a right-of } }`],
    ["`person` with no name", `person`],
    ["scope with no path", `a = box "A"\nview v { scope }`],
    ["title with no string", `a = box "A"\nview v { title }`],
    ["theme with no name", `a = box "A"\nview v { theme }`],
  ];

  for (const [label, src] of HALF_TYPED)
    it(`diagnoses rather than throws: ${label}`, () => {
      expect(() => buildModel(src)).not.toThrow();
    });

  it("no `getChild(...)!` survives in src — the whole crash class, banned", () => {
    // The ternary-guarded form (`x.getChild(k) ? ctx.str(x.getChild(k)!) : …`)
    // is safe and allowed; a bare assertion is not.
    const offenders: string[] = [];
    for (const f of tsFiles(join(pkg, "src"))) {
      const lines = readFileSync(f, "utf8").split("\n");
      lines.forEach((l, i) => {
        if (!/getChild\([^)]*\)!/.test(l)) return;
        if (/\?\s*ctx\.|getChild\([^)]*\)\s*\?/.test(l)) return; // guarded ternary
        offenders.push(`${f.replace(root + "/", "")}:${i + 1}  ${l.trim()}`);
      });
    }
    expect(offenders, `unguarded non-null assertion on an optional grammar node:\n${offenders.join("\n")}`)
      .toEqual([]);
  });
});

describe("determinism is structural, not hoped for", () => {
  it("no Date.now or Math.random anywhere in core src", () => {
    // CLAUDE.md non-negotiable: same (source, packs, theme, version) →
    // byte-identical SVG. Sketch roughness is seeded from hash(source); nothing
    // else may reach for a clock or an RNG. Currently zero — this pins it.
    const offenders: string[] = [];
    for (const f of tsFiles(join(pkg, "src"))) {
      const lines = readFileSync(f, "utf8").split("\n");
      lines.forEach((l, i) => {
        const code = l.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
        if (/\bDate\.now\b|\bMath\.random\b|new Date\(\s*\)/.test(code))
          offenders.push(`${f.replace(root + "/", "")}:${i + 1}  ${l.trim()}`);
      });
    }
    expect(offenders, `nondeterminism in the render path:\n${offenders.join("\n")}`).toEqual([]);
  });
});

describe("pack registration stays consistent across its five sites", () => {
  // CLAUDE.md: registration is hardcoded in five one-liner places, and the
  // failures are all remote from the mistake: miss the vscode bundle and
  // `packExists` is false only in a packaged install; miss the gauntlet
  // planter and cold agents silently run without the pack — which is exactly
  // how the fifth site was discovered missing from this list.
  const namesIn = (rel: string, re: RegExp) => {
    const src = readFileSync(join(root, rel), "utf8");
    return new Set([...src.matchAll(re)].map((m) => m[1]));
  };

  it("all five sites register the same packs", () => {
    const sites: Record<string, Set<string>> = {
      "core/src/packs/node-fs.ts": namesIn(
        "packages/core/src/packs/node-fs.ts", /registerPackFromDisk\("@squinch\/pack-([\w-]+)"\)/g),
      "spa/scripts/sync-packs.ts": namesIn(
        "apps/spa/scripts/sync-packs.ts", /"@squinch\/pack-([\w-]+)"/g),
      "spa/src/squinch.ts": namesIn(
        "apps/spa/src/squinch.ts", /"([\w-]+)"/g),
      "vscode/scripts/bundle.mjs": namesIn(
        "packages/vscode/scripts/bundle.mjs", /"pack-([\w-]+)"/g),
      "gauntlet/run.ts": namesIn(
        "gauntlet/run.ts", /"pack-([\w-]+)"/g),
    };
    // the SPA's runtime list is bare names in one array; intersect against the
    // known pack set rather than every string literal in the file
    const known = sites["core/src/packs/node-fs.ts"];
    sites["spa/src/squinch.ts"] = new Set([...sites["spa/src/squinch.ts"]].filter((n) => known.has(n)));

    expect(known.size, "found no packs in node-fs.ts — the parse is wrong, not the code").toBeGreaterThan(3);
    for (const [site, names] of Object.entries(sites))
      expect([...names].sort(), `${site} disagrees with core/src/packs/node-fs.ts`)
        .toEqual([...known].sort());
  });

  it("no pack name is both a builtin glyph set and a registered pack", () => {
    // `iconIds` short-circuits on BUILTIN_GLYPHS, so a name in both makes the
    // disk icons vanish from search and completions while `hasIcon` still
    // accepts them — a silent, confusing half-state (CLAUDE.md).
    const registry = readFileSync(join(pkg, "src/packs/registry.ts"), "utf8");
    const block = /BUILTIN_GLYPHS[^=]*=\s*\{([\s\S]*?)\n\};/.exec(registry)?.[1] ?? "";
    const builtins = new Set([...block.matchAll(/^\s{2}(\w[\w-]*)\s*:/gm)].map((m) => m[1]));
    const disk = new Set(
      [...readFileSync(join(pkg, "src/packs/node-fs.ts"), "utf8")
        .matchAll(/registerPackFromDisk\("@squinch\/pack-([\w-]+)"\)/g)].map((m) => m[1]),
    );
    expect(builtins.size, "parsed no builtin glyph sets — the regex is stale").toBeGreaterThan(0);
    const both = [...builtins].filter((b) => disk.has(b));
    expect(both, `pack name in both BUILTIN_GLYPHS and the disk registry: ${both.join(", ")}`).toEqual([]);
  });
});

describe("the pre-commit hook stays wired and armed", () => {
  // The hook kills the "edited the source, forgot the generator" class of CI
  // failure at commit time. Deleting it, dropping the exec bit, or unwiring
  // the prepare script would all fail silently — commits just stop being
  // checked — so the suite asserts the wiring instead of hoping.
  const hookPath = join(root, ".githooks", "pre-commit");

  it("hook exists, is executable, and guards both generated files", () => {
    const mode = statSync(hookPath).mode;
    expect(mode & 0o111, ".githooks/pre-commit lost its executable bit — git will skip it without a word").toBeTruthy();
    const hook = readFileSync(hookPath, "utf8");
    for (const guarded of ["apps/spa/src/examples.ts", "runtime.generated.ts"])
      expect(hook, `hook no longer guards ${guarded}`).toContain(guarded);
  });

  it("root postinstall script wires core.hooksPath on install", () => {
    // postinstall, not prepare: pnpm 11 does not run the root `prepare`
    // lifecycle on install (verified against a fresh clone) — postinstall it does.
    const scripts = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts ?? {};
    expect(scripts.postinstall ?? "", "root postinstall must run `git config core.hooksPath .githooks` — without it a fresh clone has no hooks")
      .toContain("core.hooksPath .githooks");
  });
});
