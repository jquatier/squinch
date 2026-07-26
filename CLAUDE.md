# CLAUDE.md

Squinch — architecture diagrams as code. LLM-first authoring, human layout control,
deterministic rendering. Pre-alpha; Phase 2 (see docs/PLAN.md §3).

## Constitution (read before designing anything)

- `docs/SPEC.md` — DSL v0: grammar, views, visibility resolution, edge lifting,
  the three layout tiers.
- `docs/DESIGN.md` — diagram design language + app chrome. These are renderer
  **requirements**, not decoration.
- `docs/PLAN.md` — build phases. Phase-0 spike exit criteria are pass/fail gates.
- `docs/notes/` — engineering notes on decisions that got relitigated once too
  often (e.g. `edge-labels.md`: the placement policy, every rejected approach
  and why, and how to diagnose the next odd label). Read before redesigning
  anything it covers.

## Non-negotiables

- **Determinism**: same (source, packs, theme, tool version) → byte-identical SVG.
  No `Date.now`/`Math.random` in the render path; sketch-theme roughness is seeded
  from `hash(source)`; emitted SVG always uses LF; exported SVG never contains JS
  (animations are CSS keyframes at constant px/s).
- **Text metrics never come from the environment** — bundled font + precomputed
  metrics tables only (`src/metrics.generated.ts`). No canvas/DOM measurement.
  Rendered SVGs embed the subsetted Inter faces as `@font-face` data-URIs
  (`src/fonts.generated.ts`, family `SquinchInter`) so viewers draw the exact
  font the metrics were measured from; regenerate both with `npm run
  gen-metrics` / `npm run gen-fonts` in core. `gen-fonts` emits the same subset
  twice — woff2 for the SVG, and `packages/core/fonts/*.ttf` for rasterizers
  that can't read `@font-face`. **resvg is one of them**, so PNG export hands it
  those files with `loadSystemFonts: false`; drop that and PNGs silently pick up
  whatever font the machine has.
- **Core is isomorphic**: shared code imports no `node:` builtins. Node registers
  disk packs via `src/index.ts`; browsers call `registerPack` + `preloadIcons`
  (`src/browser.ts`). Tests boot packs through `test/setup.ts`.
- **The DSL has no pixel coordinates, ever.** Layout control is relative only.
- **Structure/layout separation**: deleting every `layout` block must still render
  well; conflicting hints are check-time errors, never silently dropped.
- **Errors serve the agent loop**: location + problem + likely fix (did-you-mean).
  `check --format json` and the human format carry identical information.
- **Every rendered SVG is validated** with a real XML parser
  (`src/render/validate.ts`, fast-xml-parser) in tests and tools — never assume
  emitted markup is well-formed; browsers are lenient, strict parsers are not.
  Label pills are collision-resolved; the golden suite asserts no two overlap.
- **Pack SVGs are sanitized at load** (`src/packs/sanitize.ts`: allowlist elements
  and attributes, strip scripts/handlers/foreignObject/external refs, namespace
  internal ids). AWS icons in `packages/pack-aws/icons/` ship **verbatim** under
  CC-BY-ND: never edit, recolour, or "optimize" them — regenerate with
  `npm run fetch`. Theme treatment is render-time only (placement, clipping,
  plates). Renderer note: `clip-path` on a `<use>` stops it instantiating in some
  renderers — always clip a wrapping `<g>`.
- Performance budgets in docs/PLAN.md §2 are CI-enforced acceptance criteria.

## Layout of the workspace

`apps/spa` — the playground (Vite/React/Tailwind; imports `@squinch/core/browser`
and fetches pack icons from `public/`). `packages/core` — the engine (see below).
`packages/pack-aws` — 316 AWS icons
(303 services + 13 group/boundary marks), verbatim + dual-licensed (see its NOTICE).
`packages/pack-logos` — 124 curated Simple Icons marks (CC0) for the non-AWS
half of a stack; `monochrome: true` in its manifest makes the renderer plate and
tint them. Both packs regenerate with `npm run fetch`; never hand-edit icons. `packages/cli` — the `squinch` binary,
thin wrapper over core: arg parsing, project loading (file *or* directory), and the
lockfile model (`--sync`/`--check`). `packages/vscode` — the editor extension:
`src/features.ts` is every piece of editor intelligence as pure functions (unit
tested), `src/server.ts` a thin LSP shell over it, `src/extension.ts` the client
plus preview webview; `test/server.test.ts` drives the *bundled* server over real
stdio LSP. `examples/` — one directory per project, with
committed SVGs that CI verifies.

## Current phase

Phases 0–3 are complete. The engine (grammar → model → visibility/lifting →
layout → themed SVG), the CLI (check/render/diff/icons/init/watch + lockfile
model + Actions), the SPA playground, the VS Code extension + language server,
two icon packs, and five themes all ship. Phase 3's bar — an agent producing
clean diagrams from prose using only the skill + CLI — is certified at **16/16
by independent cold agents** (`gauntlet/README.md` records what each run found).

v1.1's DSL is done: zones, flows, tags, channels, cols, align, legend/titleblock.
Deliberately *not* built, with reasons recorded: `route … around`/`via`
(`docs/notes/routing-hints.md` — ELK already avoids nodes) and `grid` (rows and
cols compose to the same thing). Work since then is in the playground, not the
language: altitude changes animate as an anchored dive through the card you
clicked (`docs/notes/zoom-transitions.md`, DESIGN §11), and presentation mode
turns the declared views into a full-bleed deck.

Key architecture from Phase 0, still binding: same-rank edges bypass ELK and use
our coplanar router; declared ranks are enforced via invisible scaffold edges; an
expanded container is one "entity" for ranking, and ELK layers freely inside it.
The Phase-0 hand-built harness that proved this is retired; only its canonical
output survives, as a second-implementation oracle
(`packages/core/test/golden/phase0-canonical.svg`, checked in `golden.test.ts`).

## Commands

- `pnpm -r test` — every package. Core suite covers model diagnostics, golden SVG
  byte-compare, XML validity, determinism, Phase-0 layout parity. `UPDATE_GOLDEN=1`
  to rebless goldens after an *intentional* visual change (never touches
  `phase0-canonical.svg` — that one is a frozen external reference, not ours to
  rebless).
- `pnpm -r typecheck` — tsc across packages (CI runs this first).
- `pnpm --filter @squinch/core build` — required before using the CLI binary.
- `node packages/cli/bin/squinch.js <cmd>` — the CLI (check/render/icons/init/watch).
  `render -o x.png` rasterizes via resvg (`src/raster.ts`); rebuild the CLI
  (`pnpm --filter squinch build`) before testing the binary — `bin/` runs `dist/`.
- `node packages/cli/bin/squinch.js render examples/orders --check` — dogfood gate;
  after any intentional renderer change, re-run `--sync` on both example projects
  and commit the SVGs, or CI fails.
- `cd packages/core && npm run grammar` — regenerate Lezer parser from
  `src/grammar/squinch.grammar`.
- `pnpm --filter @squinch/spa dev` — playground on :5180 (`.claude/launch.json`).
- VS Code extension: <kbd>F5</kbd> ("Run Squinch extension") bundles core + the
  extension and opens `examples/` in a dev host; or
  `pnpm --filter squinch-vscode build`.

## Layout of @squinch/core

`src/grammar` (Lezer DSL grammar → generated parser) → `src/model` (tree → semantic
model + SPEC §9 diagnostics, did-you-mean) → `src/layout` (hints → ELK + scaffold
edges + coplanar router) → `src/render` (Positioned + theme → SVG, icons inlined as
deduplicated `<symbol>`/`<use>`) → `src/themes` (DESIGN.md token sets);
`src/packs` holds the pack registry + sanitizer. Grammar note: comments are `//` only — `#` is
reserved for tags.
