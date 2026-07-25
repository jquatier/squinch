# CLAUDE.md

Squinch — architecture diagrams as code. LLM-first authoring, human layout control,
deterministic rendering. Pre-alpha; Phase 2 (see docs/PLAN.md §3).

## Constitution (read before designing anything)

- `docs/SPEC.md` — DSL v0: grammar, views, visibility resolution, edge lifting,
  the three layout tiers.
- `docs/DESIGN.md` — diagram design language + app chrome. These are renderer
  **requirements**, not decoration.
- `docs/PLAN.md` — build phases. Phase-0 spike exit criteria are pass/fail gates.

## Non-negotiables

- **Determinism**: same (source, packs, theme, tool version) → byte-identical SVG.
  No `Date.now`/`Math.random` in the render path; sketch-theme roughness is seeded
  from `hash(source)`; emitted SVG always uses LF; exported SVG never contains JS
  (animations are CSS keyframes at constant px/s).
- **Text metrics never come from the environment** — bundled font + precomputed
  metrics tables only (`src/metrics.generated.ts`). No canvas/DOM measurement.
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
`packages/pack-aws` — 303 AWS service
icons, verbatim + dual-licensed (see its NOTICE). `packages/cli` — the `squinch` binary,
thin wrapper over core: arg parsing, project loading (file *or* directory), and the
lockfile model (`--sync`/`--check`). `examples/` — one directory per project, with
committed SVGs that CI verifies. `spike/` — the Phase-0 harness, kept as regression.

## Current phase

Phase 0 passed (5/5 exit criteria; findings in docs/PLAN.md §3). **Phase 1 engine is
complete**: grammar → model → visibility/lifting → layout → themed SVG, multi-file
projects, cards/frames/zoom, highlight/notes. **Phase 2 in progress**: the CLI ships
(check/render/icons/init/watch + lockfile model + GitHub Action) and the SPA
playground runs (CodeMirror + live preview + click-to-zoom). Next: agent skill +
the Phase-3 gauntlet.

Key architecture from the spike, still binding: same-rank edges bypass ELK and use
our coplanar router; declared ranks are enforced via invisible scaffold edges; an
expanded container is one "entity" for ranking, and ELK layers freely inside it.

## Commands

- `pnpm -r test` — every package. Core suite covers model diagnostics, golden SVG
  byte-compare, XML validity, determinism, spike parity. `UPDATE_GOLDEN=1` to
  rebless goldens after an *intentional* visual change.
- `pnpm -r typecheck` — tsc across packages (CI runs this first).
- `pnpm --filter @squinch/core build` — required before using the CLI binary.
- `node packages/cli/bin/squinch.js <cmd>` — the CLI (check/render/icons/init/watch).
- `node packages/cli/bin/squinch.js render examples/orders --check` — dogfood gate;
  after any intentional renderer change, re-run `--sync` on both example projects
  and commit the SVGs, or CI fails.
- `cd packages/core && npm run grammar` — regenerate Lezer parser from
  `src/grammar/squinch.grammar`.
- `pnpm --filter @squinch/spa dev` — playground on :5180 (`.claude/launch.json`).
- `cd spike && npm run spike` — Phase-0 exit-criteria harness (kept as regression).

## Layout of @squinch/core

`src/grammar` (Lezer DSL grammar → generated parser) → `src/model` (tree → semantic
model + SPEC §9 diagnostics, did-you-mean) → `src/layout` (hints → ELK + scaffold
edges + coplanar router) → `src/render` (Positioned + theme → SVG, icons inlined as
deduplicated `<symbol>`/`<use>`) → `src/themes` (DESIGN.md token sets);
`src/packs` holds the pack registry + sanitizer. Grammar note: comments are `//` only — `#` is
reserved for tags.
