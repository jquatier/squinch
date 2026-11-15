# Note — `wrap N`

Engineering note, not a requirement. `wrap N` (SPEC §6, Tier 0) is the one
aspect-ratio knob: no row holds more than N.

> **Rewritten 2026-11 for the weft engine.** Until then `wrap` folded exactly
> two shapes — a single chain, and a single source fanning out to leaves — and
> warned on every other, because the fold's band-skipping edges had to be
> hidden from ELK and drawn by a hand-written "bus router" that needed to know
> the shape. That restriction, the bus router, and the ELK options that were
> wrap-scoped are gone. The design choices that were about the *picture*
> still hold and are kept below. The old text is in git:
> `git show c95ab03~1:docs/notes/wrap.md`.

## The problem it answers

A 15-step chain renders 224×1808 flowing down, or 2848×128 flowing right. A
12-way fan-out renders 2512 wide. A dispatcher and nine workers inside an
expanded system is one row of nine. Folding by hand with `rows [gw] [w1 … w6]
[w7 … w12]` works, but the author has to count, and has to redo it when the
list changes.

## What it does

- **It folds any row wider than N**, in the view and in every container the
  view opens. Each container folds its own direct children. A container's own
  `layout { wrap N }` follows it wherever it is opened — expanded in another
  view, or as the root of a view scoped to it — and wins over the view's
  number there.
- **A fold is a `rows` line the planner writes** (`wrapRows` in
  `packages/core/src/layout/plan.ts`), which is why `wrap` beside `rows` or
  `cols` in one block is an error, and why a container the view already
  arranges by hand is not folded.
- **One chain → a serpentine.** Bands alternate direction, so each fold is a
  single step down. A short last band running backwards stands under the end
  of the band above.
- **Anything else keeps its ranks** and splits each over-wide rank into bands
  of N. The bands of one rank stand in columns, so the result is a grid and
  not a staircase.
- **Trunks.** The wires from one source into the later bands of a folded rank
  are drawn as one trunk with branches, and so are the wires from the earlier
  bands on to one shared target — also across the container's wall, so nine
  workers writing to one store outside are a trunk, not nine lanes threading
  the bands below. A trunk is the engine's ordinary `bundle` (the same thing
  `channel` uses); the renderer learns of it as `via: "bus"` on the edge.
- **The one warning:** "`wrap N` has no effect — no row here is wider than N".
  A knob that silently does nothing is the defect `routing-hints.md` records
  reverting `around` for.

Measured when the fold first reached containers (ELK beside the first
in-house engine): a dispatcher and nine workers, expanded, `wrap 3` —
1,432 × 634 unfolded, 584 × 764 folded; ten stores in a zone, `wrap 5` —
1,736 × 333 against 920 × 456.

## Decisions that still hold

| Decision | Why |
|---|---|
| A chain folds as a serpentine, not left-to-right bands with a return wire | Same canvas, but the return hop runs the diagram's width, and three or more bands stack parallel return wires in every gutter. Arrows are directional, so a reversed band is unambiguous. |
| The fan's source stays above its bands, not in the middle (`rows [w1..w6] [gw] [w7..w12]`) | Half the edges would run upward; a fold whose reading depends on which edges were reversed is not one to ship. |
| Bands in columns | Without it a fold is a staircase. |
| `wrap` is exclusive with `rows`/`cols` | Two statements assigning ranks in one block is a contradiction; never a silent winner. |

## Guidance that follows from the mechanics

A band is a rank, and under `direction right` ranks are columns — so `wrap 7`
on a rightward view makes tall columns, not wide rows. For a slide, leave the
direction down and use N ≈ √(nodes being folded), rounded up.

## Not built

An opt-in trunk for a *hand-written* fold. `channel` shares a trunk at a
common target; the mirror — one source into several targets, `channel gw ->
w7, w8, w9` — is the natural spelling if it is ever wanted, and the engine's
`bundle` already draws it.
