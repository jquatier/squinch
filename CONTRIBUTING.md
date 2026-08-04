# Contributing

Thanks for looking. Squinch is pre-alpha and the DSL will still break, so the
most useful contributions right now are bug reports with a `.squinch` file that
reproduces, and diagrams that come out ugly — the [lookbook](lookbook/) exists
because what looks bad there becomes the next fix.

## Setup

```bash
pnpm install && pnpm -r build
```

Node ≥ 22, pnpm 11 (the version is pinned in `packageManager`; `corepack enable`
picks it up). `--filter @squinch/core` alone is *not* enough to run the CLI —
`packages/cli/bin/` runs `packages/cli/dist`, which only the CLI's own build
writes.

`pnpm install` also installs the git hooks, via [husky](https://typicode.github.io/husky/)
— [`.husky/pre-commit`](.husky/pre-commit) only regenerates two
committed-but-generated files when their sources are staged (see below), and
does nothing at all on an unrelated commit. `git commit --no-verify` skips it
once; `HUSKY=0` disables husky entirely, including the install step, if you
would rather this repo not touch your git config.

One pnpm wrinkle worth knowing: lifecycle scripts are skipped when an install
is a no-op ("Already up to date"), so if you already had `node_modules` when
you pulled the change that added hooks, you get them on your next real
install.

### Windows

Works with the same two commands, and CI runs a Windows job. Two things to know:

- The repo pins LF through [`.gitattributes`](.gitattributes), and **your clone
  must have it.** A clone made before it landed still has CRLF in the working
  tree; `git add --renormalize . && git checkout .` fixes that, and
  `git ls-files --eol | grep w/crlf` should then print nothing (one Azure icon
  excepted — it ships with a CRLF terminator and is marked `-text`). A guardrail
  test fails if CRLF is ever committed.
- Hooks run through git-bash. The executable bit is meaningless on Windows, and
  it does not matter here anyway: husky's shim runs `.husky/pre-commit` with
  `sh -e`, so the file needs no mode of its own.

Maintainer tooling that is macOS/Linux only, deliberately: `gauntlet/run.ts`
(POSIX PATH shim, spawns `claude`), `packages/pack-*/scripts/fetch.ts` (needs
`unzip`), and `scripts/hero-gif.mts` (needs ffmpeg). Each says so in its header.

## The gates

```bash
pnpm -r test        # every package
pnpm -r typecheck   # CI runs this first
```

To reproduce a Windows checkout without Windows — the one recipe that catches
the whole line-ending class, and how the `.gitattributes` was validated:

```bash
git clone . /tmp/win-sim && cd /tmp/win-sim
git config core.autocrlf true
git rm --cached -r -q . && git reset --hard
git ls-files --eol | grep w/crlf     # should print nothing
```

CI additionally re-renders the examples and the lookbook and fails on any
difference. Those two are where first-time contributors usually get surprised,
so they're worth knowing about up front.

### Committed output is part of the source

Several files are generated *and* committed, and CI asserts they match what the
generator produces. If you change something upstream of one, regenerate it and
commit the result in the same change:

| Committed file | Regenerate with |
| --- | --- |
| `lookbook/out/*.svg`, `lookbook/README.md` | `npx tsx lookbook/build.ts` |
| `examples/**/*.svg`, `squinch.lock` | `node packages/cli/bin/squinch.js render examples/<project> --sync` |
| `apps/spa/src/examples.ts` | `pnpm --filter @squinch/spa sync-examples` |
| `packages/core/src/render/html/runtime.generated.ts` | `cd packages/core && npx tsx scripts/gen-html-runtime.ts` |
| `packages/core/src/grammar/parser.js` | `cd packages/core && npm run grammar` |
| `packages/core/src/metrics.generated.ts`, `fonts.generated.ts` | `npm run gen-metrics` / `npm run gen-fonts` in core |

The last two only change when the bundled font does.

### One version, everywhere

Every workspace package carries the same version, and a guardrail test fails if
one drifts. Never hand-edit a `version` field:

```bash
node scripts/version.mjs 0.1.0
```

The CLI reports it (`squinch --version`) and writes it into `squinch.lock`, and
the extension's VSIX carries it, so all three agree by construction.

### Golden SVGs

The core suite byte-compares rendered SVG against committed goldens. When a
visual change is *intentional*, rebless them and eyeball every diff:

```bash
UPDATE_GOLDEN=1 pnpm --filter @squinch/core test
```

A golden diff you didn't mean to cause is the test doing its job. Determinism is
a hard rule, not an aspiration: same (source, packs, theme, tool version) →
byte-identical SVG. No `Date.now`, no `Math.random`, no environment-dependent
text measurement — a guardrail test enforces the first two.

### Icons are never hand-edited

Every pack under `packages/pack-*/icons/` is third-party artwork redistributed
**verbatim**, and the AWS set is licensed no-derivatives. Regenerate a pack with
`npm run fetch` inside it; never edit, recolour, or optimize an icon. Theme
treatment happens at render time. See [NOTICE](NOTICE) for what binds you.

Adding a pack means registering it in five places — a guardrail test lists them
and fails if they disagree.

## Where things live

`packages/core` is the engine: `grammar/` (Lezer) → `model/` (semantic model +
diagnostics) → `layout/` (ELK + our coplanar router) → `render/` (themed SVG).
`packages/cli` is a thin wrapper over it. [CLAUDE.md](CLAUDE.md) is the fullest
map of the architecture and its non-negotiables — it's written for AI agents
working in the repo, but it's the best orientation for humans too.

Before redesigning something, check [`docs/notes/`](docs/notes/): those files
record decisions that were relitigated once too often, including the approaches
that were tried and rejected and *why*. `docs/SPEC.md` is the DSL contract and
`docs/DESIGN.md` is a requirements document for the renderer, not decoration.

## Cutting a release

```bash
pnpm release
```

One command, from a clean `main`: it prompts for the new version, drafts a
CHANGELOG section from the commits since the last tag, opens it in `$EDITOR`
to be trimmed into something a reader deserves (the draft is a starting point,
not the changelog), bumps every workspace manifest together, commits
`release: <version>`, tags `v<version>`, and pushes branch + tag in one go.
`--dry-run` shows everything and writes nothing; `--no-edit` accepts the draft.

From there [release.yml](.github/workflows/release.yml) builds the VSIX from
the tagged commit, re-runs the whole suite as its own gate, publishes the
GitHub Release with that CHANGELOG section as its notes plus a `SHA256SUMS`,
and then publishes to npm — `squinch`, `@squinch/core` and the five icon
packs, in dependency order. Everything else (`@squinch/skill`, the playground,
the gauntlet, the lookbook) stays `private: true` and never reaches the
registry; a guardrail asserts that split by name.

npm goes **last** on purpose: the GitHub Release is the fallback artifact, so a
registry problem reddens the run without costing anyone the VSIX. It needs an
`NPM_TOKEN` repository secret — until that exists, expect the publish step to
fail and the rest of the release to succeed.

If CI fails, no release exists — fix and release the next patch number.

Two failures that are the process working: a hand-made tag that doesn't match
the workspace version, and a missing CHANGELOG section for the tagged version.
Both stop the workflow before anything publishes.

## Pull requests

Small and focused beats comprehensive. Explain what a reviewer should look at
rather than what the diff already shows — and if the change moves rendered
output, include a before/after image. There's no CLA and no template; branch
from `main` and open the PR.

By contributing you agree your work is licensed under
[Apache-2.0](LICENSE).
