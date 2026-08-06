# Squinch — engineering constraints

> The numbers and rules that bind the engine, and why the main tools were
> chosen. Companion to [SPEC.md](SPEC.md) (the DSL) and [DESIGN.md](DESIGN.md)
> (how diagrams look — a renderer requirements document, not decoration).
>
> The invariants themselves — determinism, LF, bundled text metrics, pack
> sanitization, no JS in exported SVG — are stated once in
> [CLAUDE.md](../CLAUDE.md) and not repeated here. Two copies of a rule is one
> copy too many.

## Why these tools

| Choice | Why |
|---|---|
| **Lezer** for the parser | one grammar drives parsing, CodeMirror highlighting, error recovery and LSP tokens, with incremental reparse for live preview |
| **ELK.js** for layout | the only OSS engine with layered layout + ports + hierarchy + orthogonal routing, which is what the Tier 1/2 hints need (rank pinning → model order, sides → ports) |
| Plain SVG renderer | one renderer shared verbatim by the CLI, the playground and the VS Code webview |
| **@resvg/resvg-js** for PNG | deterministic raster with no browser in the loop |

ELK's one hard limit shaped the architecture and still binds: **it cannot keep
an edge's endpoints in the same layer.** Same-rank ("coplanar") edges are
therefore excluded from the ELK graph and routed by our own deterministic
router, and declared ranks are enforced with invisible scaffold edges. Four
measured attempts to hand that job back to ELK are recorded in
[notes/coplanar.md](notes/coplanar.md) — read it before trying a fifth.

## Performance budgets

Acceptance criteria, not aspirations. Enforced by `pnpm --filter @squinch/core
bench`, which runs in CI:

| Measure | Budget |
|---|---|
| Incremental reparse (per keystroke) | < 10ms |
| Full parse, 200-node model | < 50ms |
| Layout + render, 200-node model | < 500ms |
| Playground keystroke-to-preview, < 50-node view | < 250ms |

Landscape-scale models (500+ nodes) may degrade gracefully but must never hang
the editor pane.

The bench also compares against `packages/core/scripts/bench.baseline.json`,
which records medians **per machine** — timings do not compare across
machines, so CI has no baseline and enforces the budgets alone. Locally, >25%
over your own recorded number fails; sub-5ms measurements report but never
gate. Re-record with `npx tsx scripts/bench.ts --update-baseline` in the same
commit as the change that earned the cost.

## Verification

- **Unit** — grammar (parse and error fixtures), model builder, hint→ELK mapping.
- **Golden SVG snapshots** for every SPEC example across themes: determinism
  and regression in one gate. `UPDATE_GOLDEN=1` to rebless after an
  *intentional* visual change.
- **Corpus invariant sweep** — geometric assertions (no overlapping label
  pills, notes inside the canvas) over every committed diagram, which is what
  replaced the retired spike parity harness.
- **Lookbook review each release** — diffs must be intentional, named
  improvements, never drift. The checklist is DESIGN.md §9: no near-misses, no
  label collisions, no port pile-ups.
- **Benchmarks** in CI against the budgets above.
- **The agent gauntlet** as the end-to-end acceptance suite — twenty-nine
  natural-language prompts answered by cold agents with only the skill and the
  CLI. It is **maintainer-only and never runs in CI**: a round spends real
  money on live agents. What CI runs on every push is the free half, the
  deterministic scorer over the committed solution corpus. See
  [gauntlet/README.md](../gauntlet/README.md).

## Deliberately not built

Recorded so they stop being relitigated: `route … around` / `via` waypoints
([notes/routing-hints.md](notes/routing-hints.md) — ELK already avoids nodes),
the `grid` statement (`rows` and `cols` compose to the same thing), and
federation (`import` / `expose`), which parse to a clear error rather than a
silent no-op (SPEC §12).
