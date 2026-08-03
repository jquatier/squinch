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

`pnpm install` also points `core.hooksPath` at [`.githooks/`](.githooks/). The
pre-commit hook only regenerates two committed-but-generated files when their
sources are staged (see below); `git commit --no-verify` or `SQUINCH_HOOKS=0`
skips it.

## The gates

```bash
pnpm -r test        # every package
pnpm -r typecheck   # CI runs this first
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

## Pull requests

Small and focused beats comprehensive. Explain what a reviewer should look at
rather than what the diff already shows — and if the change moves rendered
output, include a before/after image. There's no CLA and no template; branch
from `main` and open the PR.

By contributing you agree your work is licensed under
[Apache-2.0](LICENSE).
