# CLAUDE.md

Squinch — architecture diagrams as code. LLM-first authoring, human layout control,
deterministic rendering. Pre-alpha; currently in Phase 0 (see docs/PLAN.md §3).

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
  metrics tables only. No canvas/DOM measurement anywhere in layout.
- **The DSL has no pixel coordinates, ever.** Layout control is relative only.
- **Structure/layout separation**: deleting every `layout` block must still render
  well; conflicting hints are check-time errors, never silently dropped.
- **Errors serve the agent loop**: location + problem + likely fix (did-you-mean).
  `check --format json` and the human format carry identical information.
- **Every rendered SVG is validated** with a real XML parser
  (`src/render/validate.ts`, fast-xml-parser) in tests and tools — never assume
  emitted markup is well-formed; browsers are lenient, strict parsers are not.
  Label pills are collision-resolved; the golden suite asserts no two overlap.
- **Pack SVGs are sanitized at load** (allowlist; strip scripts/handlers/
  foreignObject). AWS icons ship verbatim (CC-BY-ND): never modify the asset files —
  theme treatment is render-time only.
- Performance budgets in docs/PLAN.md §2 are CI-enforced acceptance criteria.

## Current phase

Phase 0 **passed** (2026-07-24, 5/5 exit criteria — outcome + binding findings in
docs/PLAN.md §3). The spike lives in `spike/`; CI (`.github/workflows/spike.yml`)
re-runs it on macOS + Linux against committed golden hashes. Key architecture from
the spike: same-rank edges bypass ELK and use our coplanar router; declared ranks are
enforced via invisible scaffold edges. Next: Phase 1 (Lezer grammar → model → full
layout mapping → themed renderer).

## Commands

- `pnpm --filter @squinch/core test` — grammar build + full core suite (model
  diagnostics, golden SVG byte-compare, determinism, spike parity).
  `UPDATE_GOLDEN=1` to rebless goldens after an intentional visual change.
- `cd packages/core && npm run demo [file.squinch]` — render examples to `out/` in
  both themes.
- `cd packages/core && npm run grammar` — regenerate Lezer parser from
  `src/grammar/squinch.grammar`.
- `cd spike && npm run spike` — Phase-0 exit-criteria harness (kept as regression).

## Layout of @squinch/core

`src/grammar` (Lezer DSL grammar → generated parser) → `src/model` (tree → semantic
model + SPEC §9 diagnostics, pack registry, did-you-mean) → `src/layout` (hints →
ELK + scaffold edges + coplanar router) → `src/render` (Positioned + theme → SVG) →
`src/themes` (DESIGN.md token sets). Grammar note: comments are `//` only — `#` is
reserved for tags.
