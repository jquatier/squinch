# Note — spike: a layout engine of our own (2026-11)

**Status: a spike, not a decision.** The code is in `packages/core/spike/grid/`,
outside `src/`, and nothing ships from it. The ELK engine is untouched apart
from `sizeOf` gaining an `export`.

The question was whether to keep extending the ELK-based engine or to own the
layout. This note records what a two-session prototype showed, so the decision
can be made on measurements rather than on the feel of the last bug.

## Why ask

`layout.ts` is one 2,900-line function. Reading it against the history, the
recurring bugs fall into three classes, and none of them is a bug in ELK or in
our router:

- **Predict, then nudge.** We estimate ELK's layering before it runs, classify
  edges on the estimate, and push ELK toward it with scaffold edges that are
  lower bounds only. When ELK disagrees a wire ends in canvas (rounds 26, 27).
- **Several owners of one canvas.** ELK, the coplanar router, the bus router
  and the post-passes each place wires, ports and pills without seeing each
  other (port stacking, the pill on a coplanar crossing, the field-row rule
  written twice).
- **Features expressed as tricks.** Spacer labels on every edge, invisible node
  labels as margins, `elk.position` at multiples of 1000, a wrapper graph to
  dodge a crash, a second full layout for note margins.

What ELK still decides for us is narrow: ranks are ours, root order is forced
to declaration order, same-rank wires are ours. ELK contributes coordinates,
cross-rank routing, and the inside of containers — for 95% of layout time and
a 1.6 MB bundle.

## What was built

A layered engine written for Squinch's own model rather than a general one:
boxes in ranks, wires in channels, containers laid out inside-first.

| File | Lines | What it is |
|---|---|---|
| `rank.ts` | 162 | Ranks for one container: pins are hard, the rest is the least total wire (network simplex). |
| `order.ts` | 59 | Box order within a rank, for a container nobody arranged. |
| `isotonic.ts` | 33 | Positions along a rank — an exact solve, no iteration. |
| `channel.ts` | 94 | Track assignment. The only routing primitive. |
| `engine.ts` | 142 | What spans containers: ranks, which wall each wire uses, stitching. |
| `group.ts` | 30 | One container: seven stages, each a function of the ones before. |
| `sheet.ts` `order-slots.ts` `ports.ts` `gutters.ts` `place.ts` `stack.ts` `emit.ts` | 57–171 each | The stages. |
| `types.ts` `axes.ts` | 110, 58 | Vocabulary; the one place that knows which axis is x. |
| `problem.ts` | 233 | A Squinch view → the engine's input. No geometry. |
| `layout.ts` | 88 | The engine's output → `Positioned`. |

About 1,400 lines of engine and 320 of adapter, no dependency, no file over
180 lines. It returns the same `Positioned` the renderer and `checkLayout`
consume, so both engines can be drawn and checked by the same code.

Three ideas carry it:

1. **A rank is a constraint, not a hint.** Nothing downstream may move it, so
   nothing has to predict it. Two boxes joined by an edge may share a rank.
2. **Everything that turns is a run in a channel.** A cross-rank dog-leg, a
   same-rank wire going round a blocker, a wire leaving a container by its side
   wall, the gutter between two neighbours (a channel turned ninety degrees) —
   one function assigns all their tracks. There is no second router.
3. **A container is the same layout run on the inside first.** Wires cross a
   wall at a port the inside chose. Root, zone and frame share one code path,
   and a container's own `direction` falls out for free: `direction right` is
   the same layout with the axes swapped at the very end.

## Results

`npx vitest run spike/grid/compare.test.ts --disable-console-intercept`, over
all 259 views in the corpus:

| Measure | ELK | Grid, first pass | Grid, now |
|---|---|---|---|
| Layout time, whole corpus | 3,485 ms | 171 ms | 210 ms |
| Invariant violations (`checkLayout`) | 0 | 0 | 0 |
| …with *every* wire held to "crosses no foreign box" | not asserted | 0 | 0 |
| Total area | 81.3 M | 81.0 M | 79.9 M (×0.98) |
| Total wire length | 230 k | 239 k | 230 k (×1.00) |
| Wire crossings | 73 | 120 | 78 (×1.07) |
| Bends | 1,174 | 1,565 | 1,331 (×1.13) |
| Jogs under 16 px | 12 | 47 | 19 |
| Wires that bend though their ends face | 22 | 10 | 8 |
| Wires through an unrelated node | 2 | 0 | 0 |

The first pass was one session; "now" is a second session spent on the gaps
the first one named. What moved the numbers, in order of effect:

- **Boxes reorder inside a container nobody arranged** (`order.ts`). ELK does
  this inside compounds and the spike did not; it was most of the crossing gap.
- **Pass-through wires ordered by one-sided sweeps**, keeping the best
  arrangement seen, then straightened as a whole where one lane is free in
  every rank they cross.
- **Bundles** — a folded fan-out and a `channel` are one trunk with branches:
  one port, one lane, one track. `39-wrap#fan` went from 2,143 px wide to
  1,264, matching ELK's hand-built bus router to within four pixels, with no
  bus router.
- **Ranking is network simplex**, tested against exhaustive search on sixty
  small graphs. It fixed the stranded card in `35-monorepo#landscape`, which
  now has 0 crossings to ELK's 0.

**The remaining bend gap is a style choice, not a defect.** A parent with two
children is centred over them (four bends, symmetric); ELK lines it up with
the first child (two bends, lopsided). Switching the spike to ELK's convention
gives 1,211 bends (×1.03) but costs area and wire. It is one line in
`place.ts` (`median`), and it is a design decision for DESIGN.md, not for the
engine.

Read plainly: the spike is legal everywhere, seventeen times faster, level on
area and wire, within a few percent on crossings, and — convention aside —
on bends. It is no longer visibly worse on the large views that failed the
first pass.

### What it honours that ELK cannot

`spike/grid/language.test.ts` asserts each of these against both engines:

| Source | ELK engine | Grid |
|---|---|---|
| `rows [a b c d]` with an unlisted bus between band-mates | error: "a band the layouter could not keep" | the band holds; the bus sits below |
| An edge between two row-mates inside an expanded container | warning: "cannot be routed there" | drawn, straight |
| Rank hints between members of one zone | warning: "have no effect" | applied |

Each is a first-`check` failure a cold agent can no longer hit. That matters
more than the geometry: the product's acceptance number is first-check passes.

### Where it is still worse, and why

Seen in side-by-side renders (`spike/grid/render-pair.ts`):

- **Container wall ports** are chosen by the inside alone. A wire can meet a
  wall away from where the outside would like it and take an extra jog on the
  way in (`27-k8s#cluster`, the `reconciles` wire). This is the trade ELK's
  global `INCLUDE_CHILDREN` makes the other way, and the one open design
  question.
- **Root order is declaration order**, as it is under ELK
  (`forceNodeModelOrder`). Where that order crosses wires, both engines cross
  them; the spike a little more (`34-web-many-apis#landscape`, 4 to 3).
- **A wire entering a box beside a second wire** lands on a port a third of
  the wall from centre, so a short chain can sit a few pixels off one
  baseline (`38-container-direction#pipe`). ELK shows the same jog, smaller.

## Feature coverage

| Feature | In the spike | Notes |
|---|---|---|
| `rows`, `cols`, `place`, `direction`, `density` | yes | one projection rule for every container |
| Container `layout { }` blocks, scoped-view adoption | yes | |
| Expanded frames, `expand *` nesting, zones, nested zones | yes | same code path as the root |
| Per-container `direction` | yes | no second layout call, no wrapper |
| Same-rank wires: straight, jog, go-around | yes | no separate router |
| Edge labels with reserved room | yes | a label is a slot in a layer; pills sit on their wire |
| Cards (sheets), people, `preview` cards, `fields` heads | yes | `bleed` and `face` on a box |
| `wrap` on a chain | yes | no special code — it is just `rows` |
| `wrap` on a fan-out | yes | a bundle: one trunk, branches — no bus router |
| `channel` | yes | the same bundle, shared at the target |
| `align` | no | would be a placement constraint, not a post-pass |
| `route … from/to <side>` | no | 2 uses in the corpus |
| Notes, flow badges, zone-chip avoidance | no | placed after layout from nodes, wires and pills; engine-independent |
| Hint diagnostics | no | the spike plans and solves; it does not yet say why a hint is wrong |
| `color`, `only`, `detail`, legend, titleblock, themes | n/a | upstream or downstream of layout |

## Clean code, testability, simplicity

- **Testable in parts.** `engine.test.ts` tests ranking, box order, placement,
  the median and track assignment each on a few lines of input, with no view,
  model or font. The ELK engine has no seam to test below `layoutView`.
- **Properties, not snapshots.** "Ranks are the least total wire" is checked
  against brute force; "`direction right` is the transpose of `down`" and "a
  long wire avoids the rank it passes" are one-line assertions.
- **Stages, not a closure.** One container is seven functions in seven files
  (`group.ts` lists them). The split was made after the algorithms settled and
  verified by a digest of every box and wire in the corpus, identical before
  and after.
- **Synchronous and dependency-free.** No `await`, no 1.6 MB bundle.
- **Tuning is recorded, not hidden.** Placement has four constants found by
  measuring this corpus: five sweeps, pull weights of 8 / 3 / 2 / 0.25
  (through-wire, box-to-box, wire-to-box, wall port), a pull divided by how
  crowded the far wall is, and an 8 px straightening threshold. Each was kept
  because the corpus totals improved; none has been tried against diagrams
  outside the corpus.

## What this does and does not show

It shows the mechanism works across every feature that shapes geometry, that
it is small, that it removes the three bug classes by construction, and that
its quality reaches ELK's on this corpus with two sessions of work.

It does not show how it behaves on diagrams it has not seen. Every tuning
choice was made against these 259 views, which is exactly the over-fitting
risk; the gauntlet is the test for that, and it has not been run.

## Recommendation

The spike has met the numeric part of the gate set after the first pass
(area, wire and crossings at ELK's level; bends pending the centring
decision). What remains before a gauntlet round:

1. **Decide the centring convention** (DESIGN.md) — it settles the bend count.
2. **Wall ports**: let the outside inform the order of a container's ports.
3. **The rest of the surface**: `align` as a placement constraint,
   `route … from/to <side>`, and the hint diagnostics the ELK engine gives.
4. **Share the annotation pass.** Move notes, badges and chips out of
   `layout.ts` into a function both engines call. Worth doing even if the
   answer is to stay on ELK.
5. **Lookbook review** of all views side by side, then one gauntlet round
   with the engine swapped in.

If the gauntlet round fails on shapes the corpus never had, that is the
long tail showing itself, and the question becomes how long it is.

The timing argument stands either way. After launch, `render --check` makes
layout output something users have committed, and any engine change makes their
CI stale.
