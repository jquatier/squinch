// Ratchets: properties of the *source* that are cheap to hold and expensive to
// rediscover. Each one here is a bug that already happened, or a
// currently-clean state worth pinning so it stays clean.
//
// Source-level assertions, the same shape as skill.test.ts's diagnostic sweep.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildModel } from "../src/index.js";

const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(pkg, "..", "..");

/** git, from the repo root, trimmed. These ratchets assert properties of the
 *  checkout itself, so they legitimately need the tool that made it. */
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

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
    // positional tags and comma separators — new head/list positions, so new
    // places to pause mid-keystroke
    ["positional tag, hash alone", `system s "S" {\n a = box "A" #\n}`],
    ["positional tag then open brace", `system s "S" {\n a = box "A" #p {\n}`],
    ["container head tag, hash alone", `system s "S" # {\n a = box "A"\n}`],
    ["attr comma, next key not typed", `system s "S" {\n a = box "A" { description: "d",\n }\n}`],
    ["rank group, comma then nothing", `a = box "A"\nview v { layout { rows [a, } }`],
    ["align, comma then nothing", `a = box "A"\nb = box "B"\nview v { layout { align a, } }`],
    ["highlight, comma then nothing", `a = box "A"\nview v { highlight #x, }`],
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
  it("no localeCompare anywhere in core src", () => {
    // It consults ICU, so the answer depends on the machine's locale data.
    // `diff.ts` held the only two calls in the repo; sorting by codepoint is
    // stable everywhere and was the intent all along.
    const offenders: string[] = [];
    for (const f of tsFiles(join(pkg, "src"))) {
      const lines = readFileSync(f, "utf8").split("\n");
      lines.forEach((l, i) => {
        const t = l.trim();
        if (t.startsWith("*") || t.startsWith("/*") || t.startsWith("//")) return; // prose may name it
        if (/\blocaleCompare\b/.test(l.replace(/\/\/.*$/, "")))
          offenders.push(`${f.replace(root + "/", "")}:${i + 1}  ${l.trim()}`);
      });
    }
    expect(offenders, `locale-dependent ordering:\n${offenders.join("\n")}`).toEqual([]);
  });

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
  // failure at commit time. Deleting it, or unwiring husky, would fail silently
  // — commits just stop being checked — so the suite asserts the wiring.
  const hookPath = join(root, ".husky", "pre-commit");

  it("the hook is tracked and still guards both generated files", () => {
    // No mode assertion: husky's own shim in .husky/_ is what git executes, and
    // it runs this file with `sh -e`, so the executable bit is irrelevant here
    // (which is just as well — it means nothing on Windows).
    expect(git("ls-files", ".husky/pre-commit"), "`.husky/pre-commit` is not tracked").not.toBe("");
    const hook = readFileSync(hookPath, "utf8");
    for (const guarded of ["apps/spa/src/examples.ts", "runtime.generated.ts"])
      expect(hook, `hook no longer guards ${guarded}`).toContain(guarded);
  });

  it("husky is a dependency and the prepare script runs it", () => {
    // `prepare` is husky's documented hook and it does fire under pnpm — the
    // earlier note here claiming otherwise was a misdiagnosis. What actually
    // happens is that pnpm skips *all* lifecycle scripts when an install is a
    // no-op ("Already up to date"), which hits postinstall exactly the same
    // way. Contributors therefore get hooks on their next real install, not
    // necessarily on the pull that added them.
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    expect(pkg.scripts?.prepare ?? "", "root `prepare` must run husky — without it a fresh clone has no hooks")
      .toContain("husky");
    expect(pkg.devDependencies?.husky, "husky must be a root devDependency").toBeTruthy();
  });

  it("husky's generated shim directory is never committed", () => {
    // husky writes .husky/_ on install and drops a `*` .gitignore inside it.
    // Committing that directory would ship machine-generated shims and let a
    // stale copy outlive the husky version that wrote it.
    expect(git("ls-files", ".husky/_"), ".husky/_ is generated — it must not be tracked").toBe("");
  });
});

describe("the workspace ships one version", () => {
  // The engine, the CLI and the extension are one product cut three ways — the
  // extension is largely the same code behind a different view — so "which
  // squinch is this?" must have one answer whether you are looking at a VSIX,
  // an npm package or the version recorded in a squinch.lock. Independent
  // numbers would drift on the first bump and stop meaning anything.
  //
  // The root package.json is the truth; `node scripts/version.mjs <x.y.z>`
  // moves them together. This fails on a hand-edited manifest.
  it("every workspace member matches the root", () => {
    const version = (rel: string) =>
      JSON.parse(readFileSync(join(root, rel), "utf8")).version as string | undefined;
    const expected = version("package.json");
    expect(expected, "root package.json has no version").toBeTruthy();

    const members = [
      ...readdirSync(join(root, "packages")).map((p) => join("packages", p)),
      ...readdirSync(join(root, "apps")).map((p) => join("apps", p)),
      "gauntlet",
    ]
      .map((d) => join(d, "package.json"))
      .filter((p) => existsSync(join(root, p)));

    expect(members.length, "found no workspace members — the walk is broken").toBeGreaterThan(8);
    const adrift = members.filter((m) => version(m) !== expected).map((m) => `${m} (${version(m)})`);
    expect(adrift, `version drift from the root's ${expected} — run \`node scripts/version.mjs ${expected}\``)
      .toEqual([]);
  });

  it("only the intended packages are publishable, and they are publish-ready", () => {
    // `pnpm -r publish` publishes everything that is not `private: true`. That
    // makes `private` the only thing standing between the registry and the
    // playground, the gauntlet corpus and the lookbook — so the split is
    // asserted by name rather than left to whoever edits a manifest next.
    const PUBLIC = [
      "squinch", "@squinch/core",
      "@squinch/pack-aws", "@squinch/pack-azure", "@squinch/pack-k8s",
      "@squinch/pack-logos", "@squinch/pack-sys",
    ];
    const members = [
      ...readdirSync(join(root, "packages")).map((p) => join("packages", p)),
      ...readdirSync(join(root, "apps")).map((p) => join("apps", p)),
      "gauntlet",
    ]
      .map((d) => join(d, "package.json"))
      .filter((p) => existsSync(join(root, p)))
      .map((p) => JSON.parse(readFileSync(join(root, p), "utf8")));

    const publishable = members.filter((m) => m.private !== true).map((m) => m.name).sort();
    expect(publishable, "the set of packages that would go to npm changed").toEqual([...PUBLIC].sort());

    for (const m of members.filter((m) => m.private !== true)) {
      // npm renders "license: none" and no repo link without these, and `files`
      // is what keeps src/ and tests out of the tarball.
      for (const field of ["description", "license", "repository", "files"])
        expect(m[field], `${m.name} is publishable but has no ${field}`).toBeTruthy();
      // Scoped packages default to restricted — publishing one without this
      // fails outright on a free account.
      if (m.name.startsWith("@"))
        expect(m.publishConfig?.access, `${m.name} needs publishConfig.access = public`).toBe("public");
    }

    // The licence *text* has to be inside the tarball, not just named in a
    // field. Apache-2.0 §4(a) requires recipients get a copy, and the OFL and
    // CC-BY licences on the bundled fonts and artwork require their notices to
    // travel with the files. Every published package here carries third-party
    // material — fonts in core, vendor icons in the packs — so this is the
    // check, not a formality.
    const dirOf = (name: string) =>
      name === "squinch" ? "packages/cli" : `packages/${name.replace("@squinch/", "")}`;
    for (const m of members.filter((x) => x.private !== true)) {
      const shipped: string[] = m.files;
      const carries = shipped.some((f) => f === "LICENSE" || f === "NOTICE");
      expect(carries, `${m.name} publishes no LICENSE or NOTICE — the terms would not travel`).toBe(true);
      for (const f of shipped.filter((x) => x === "LICENSE" || x === "NOTICE"))
        expect(existsSync(join(root, dirOf(m.name), f)), `${m.name} lists ${f} in files but the file is missing`).toBe(true);
      // A package whose payload is third-party artwork must not claim the
      // repo's licence: the packs are CC-BY-ND, Microsoft's terms, CC-BY-4.0.
      if (m.name.includes("pack-"))
        expect(m.license, `${m.name} ships vendor artwork — its npm licence must point at the NOTICE`)
          .toBe("SEE LICENSE IN NOTICE");
    }
  });

  it("the release workflow guards the tag against that version", () => {
    // release.yml is what turns a tag into a published VSIX, and its first
    // real step compares the tag to the workspace version. A refactor that
    // drops the trigger or the guard would fail silently — tags would just
    // stop releasing, or worse, release with a lying version.
    const wf = readFileSync(join(root, ".github/workflows/release.yml"), "utf8");
    expect(wf, "release.yml must trigger on v* tags").toMatch(/tags:\s*\["v\*"\]/);
    expect(wf, "release.yml must derive the version from scripts/version.mjs and compare it to the tag")
      .toContain('v="v$(node scripts/version.mjs)"');
    expect(wf, "release notes must come from the CHANGELOG section, not free text")
      .toContain("scripts/release-notes.mjs");
    // npm publish must stay *after* the release step: a registry failure should
    // cost the packages, never the VSIX people can otherwise fall back to.
    expect(wf.indexOf("pnpm -r publish"), "release.yml no longer publishes to npm").toBeGreaterThan(0);
    expect(wf.indexOf("pnpm -r publish")).toBeGreaterThan(wf.indexOf("gh release create"));
  });
});

describe("workspace scripts run on every platform", () => {
  // npm and pnpm run scripts through cmd.exe on Windows, where `mkdir -p` and
  // `cp` do not exist. Core's build ended in exactly those two, and core is
  // first in dependency order — so `pnpm -r build` died before anything else
  // was attempted, and no test could have caught it because no test ran.
  // Node bins from node_modules/.bin: npm/pnpm generate a .cmd shim for each on
  // Windows, so they resolve under cmd.exe like any executable.
  const RUNNERS = new Set([
    "node", "npm", "npx", "pnpm", "tsc", "tsx", "vitest", "vite", "playwright",
    "lezer-generator", "esbuild", "git", "husky",
  ]);

  it("every script starts each command with a portable runner", () => {
    const manifests = [
      "package.json",
      ...readdirSync(join(root, "packages")).map((p) => join("packages", p, "package.json")),
      ...readdirSync(join(root, "apps")).map((p) => join("apps", p, "package.json")),
      join("gauntlet", "package.json"),
    ].filter((p) => existsSync(join(root, p)));

    const bad: string[] = [];
    let checked = 0;
    for (const rel of manifests) {
      const scripts: Record<string, string> =
        JSON.parse(readFileSync(join(root, rel), "utf8")).scripts ?? {};
      for (const [name, body] of Object.entries(scripts))
        for (const segment of body.split(/&&|;|\|\|/)) {
          const cmd = segment.trim().split(/\s+/)[0];
          if (!cmd) continue;
          checked++;
          // `exit 0` is a shell builtin that cmd.exe also understands — the
          // portable spelling of the `|| true` that npm scripts reach for.
          if (cmd === "exit" || RUNNERS.has(cmd)) continue;
          bad.push(`${rel} ${name}: ${cmd}`);
        }
    }
    expect(checked, "parsed no script commands — the walk is broken, not the scripts").toBeGreaterThan(20);
    expect(bad, "POSIX-only command in a workspace script — it will fail under cmd.exe on Windows").toEqual([]);
  });
});

describe(".gitattributes keeps the working tree LF on every platform", () => {
  // Measured before this file existed: a clone with Git for Windows' default
  // core.autocrlf=true turned 918 tracked files CRLF, and eight golden tests
  // failed immediately — an LF render byte-compared against a CRLF file. LF is
  // an input invariant, not only an output one, and `.gitattributes` is what
  // holds it. These ratchets fail if it goes missing or stops covering
  // something.
  //
  // `git ls-files --eol` answers index *and* working-tree endings for 1,660
  // files in one subprocess, without reading 13 MB of SVG.
  const entries = git("ls-files", "--eol")
    .split("\n")
    .map((l) => /^i\/(\S+)\s+w\/(\S+)\s+attr\/(.*?)\s*\t(.*)$/.exec(l))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ index: m[1], worktree: m[2], attr: m[3], file: m[4] }));

  it("declares the global LF rule", () => {
    // `eol=lf` is the load-bearing half: bare `text=auto` normalizes on commit
    // but still smudges to CRLF on checkout, and the working tree is what
    // readFileSync sees.
    expect(readFileSync(join(root, ".gitattributes"), "utf8")).toMatch(/^\* text=auto eol=lf$/m);
  });

  it("no tracked file is CRLF in the index or the working tree", () => {
    // A parse failure yields zero entries, which would pass an "every" check
    // vacuously — so assert the corpus is real first.
    expect(entries.length, "parsed no entries out of `git ls-files --eol` — the regex is stale").toBeGreaterThan(1000);
    const crlf = entries.filter((e) => e.index === "crlf" || e.worktree === "crlf");
    // The one exception is a vendor icon that arrives from Microsoft with a
    // CRLF terminator and ships verbatim; `-text` keeps git from rewriting it.
    const unexpected = crlf.filter((e) => !e.attr.includes("-text"));
    expect(unexpected.map((e) => e.file), "CRLF committed — re-clone or `git add --renormalize .`").toEqual([]);
  });

  it("binaries are declared, not merely detected", () => {
    // text=auto's NUL heuristic gets all eleven right today, but nobody decided
    // that. This is what fails when someone adds docs/assets/hero.jpg.
    const binaries = entries.filter((e) => /\.(ttf|woff2|png|gif|jpg|ico|vsix)$/.test(e.file));
    expect(binaries.length, "found no binary assets — the glob is stale").toBeGreaterThan(5);
    const guessed = binaries.filter((e) => !e.attr.includes("-text"));
    expect(guessed.map((e) => e.file), "binary by heuristic rather than by rule — add the extension to .gitattributes").toEqual([]);
  });
});
