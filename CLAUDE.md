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

Phase 0 — ELK spike (docs/PLAN.md §3): hand-built model of the canonical example
through ELK, proving rows-pinning / place / side-routing / port-spread /
bundled-text-metrics with byte-identical output on two platforms. All five exit
criteria pass, or hit the decision gate. Timebox ~3 days.

## Commands

Nothing runnable yet — update this section as the workspace comes to life.
