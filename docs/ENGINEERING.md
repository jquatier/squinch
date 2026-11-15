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
| **An in-house layout engine** (`weft`) | a rank is a constraint here, not a property of the algorithm, so everything the language says can be drawn — see below |
| Plain SVG renderer | one renderer shared verbatim by the CLI, the playground and the VS Code webview |
| **@resvg/resvg-js** for PNG | deterministic raster with no browser in the loop |

### Why the layout engine is our own

Layout was ELK (`elkjs`) until 2026-11. It was the only open-source engine
with layered layout, ports, hierarchy and orthogonal routing, and it was
replaced anyway, for reasons that are structural rather than bugs:

- **It cannot keep an edge's endpoints in the same layer.** In Sugiyama
  layering a layer *is* a set of nodes with no edges between them. `rows [a
  b]` with `a -> b` therefore needed a second, hand-written router beside ELK,
  and declared ranks were pushed onto it with invisible scaffold edges. Four
  measured attempts to hand that job back are summarised in
  [notes/coplanar.md](notes/coplanar.md).
- **Two routers have seams**: labels parked on crossings, wires that stopped
  at a container's wall instead of the leaf they name, bands ELK split in two,
  hints that could not reach inside a zone.
- **Parts of the language were errors or warnings only because ELK could not
  draw them** — an edge running upward between declared rows, `wrap` on
  anything but one chain or one fan-out, rank hints inside a zone.
- **It was most of the layout time** and a 1.6 MB dependency.

`weft` (`packages/core/src/layout/weft/`) is a layered engine written for
this job: one router, one exact crossing count over the whole tree of
containers, placement that puts balance before straightness. It has no
dependency and is synchronous, deterministic and isomorphic. On the corpus at
the swap, against ELK: crossings 73 → 22, bends 1,174 → 705, layout time
2.5 s → 0.25 s. [notes/layout-engine.md](notes/layout-engine.md) is the
record — how it works, every decision with its evidence, the rejected
alternatives, the known weak spots, and how to change it safely — and
[notes/layout-engine-requirements.md](notes/layout-engine-requirements.md)
holds the rules it is held to. Read both before redesigning anything in
layout.

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

- **Unit** — grammar (parse and error fixtures), model builder, and the layout
  engine module by module (`packages/core/test/weft/`): ranks against brute
  force, the crossing count, placement, ports and tracks on a handful of boxes
  each.
- **The layout engine's own gates** — a Problem-level audit of every hard rule
  over seeded random Problems; acceptance suites over four diagram sets
  (corpus, two hand-written sets made to be unlike it, seeded random
  diagrams), zero violations; and a quality baseline that fails when the
  totals get worse. [notes/layout-engine.md](notes/layout-engine.md) §7.
- **Golden SVG snapshots** for every SPEC example across themes: determinism
  and regression in one gate. `UPDATE_GOLDEN=1` to rebless after an
  *intentional* visual change.
- **Corpus invariant sweep** — geometric assertions (no wire through a box it
  does not end on, no overlapping label pills, notes inside the canvas) over
  every committed diagram.
- **Lookbook review each release** — diffs must be intentional, named
  improvements, never drift. The checklist is DESIGN.md §9: no near-misses, no
  label collisions, no port pile-ups.
- **Benchmarks** in CI against the budgets above.
- **The agent gauntlet** as the end-to-end acceptance suite — thirty-seven
  natural-language prompts answered by cold agents with only the skill and the
  CLI. It is **maintainer-only and never runs in CI**: a round spends real
  money on live agents. What CI runs on every push is the free half, the
  deterministic scorer over the committed solution corpus. See
  [gauntlet/README.md](../gauntlet/README.md).

## Deliberately not built

Recorded so they stop being relitigated: `route … around` / `via` waypoints
([notes/routing-hints.md](notes/routing-hints.md) — no wire passes through a
node it does not end on, so there is nothing to steer around),
the `grid` statement (`rows` and `cols` compose to the same thing), and
federation (`import` / `expose`), which parse to a clear error rather than a
silent no-op (SPEC §12).
