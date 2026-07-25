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

- `cd spike && npm run spike` — run Phase-0 cases + all exit-criteria assertions
  (fails on golden hash mismatch; `cp out/*.svg out/hashes.json golden/` to rebless).
- `cd spike && npm run gen-metrics` — regenerate metrics.json from the bundled Inter
  fonts (build-time only; layout reads metrics.json exclusively).
