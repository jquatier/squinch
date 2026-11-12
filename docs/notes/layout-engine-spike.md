# Note — spike: a layout engine of our own (2026-11)

**Status: a spike, not a decision.** The code is in `packages/core/spike/grid/`,
outside `src/`, and nothing ships from it. The ELK engine is untouched apart
from `sizeOf` gaining an `export`.

The question was whether to keep extending the ELK-based engine or to own the
layout. This note records what a three-session prototype showed, so the decision
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
| `sheet.ts` `order-slots.ts` `ports.ts` `gutters.ts` `place.ts` `stack.ts` `emit.ts` | 57–238 each | The stages. |
| `types.ts` `axes.ts` | 110, 58 | Vocabulary; the one place that knows which axis is x. |
| `problem.ts` | 233 | A Squinch view → the engine's input. No geometry. |
| `layout.ts` | 88 | The engine's output → `Positioned`. |

About 1,550 lines of engine and 370 of adapter, no dependency, no file over
240 lines. It returns the same `Positioned` the renderer and `checkLayout`
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

| Measure | ELK | Grid, pass 1 | Grid, pass 2 | Grid, now |
|---|---|---|---|---|
| Layout time, whole corpus | 3,445 ms | 171 ms | 210 ms | 230 ms |
| Invariant violations (`checkLayout`) | 0 | 0 | 0 | 0 |
| …with *every* wire held to "crosses no foreign box" | not asserted | 0 | 0 | 0 |
| Total area | 81.3 M | 81.0 M | 79.9 M | 79.6 M (×0.98) |
| Total wire length | 230 k | 239 k | 230 k | 229 k (×0.99) |
| Wire crossings | 73 | 120 | 78 | 73 (×1.00) |
| Bends | 1,174 | 1,565 | 1,331 | 1,337 (×1.14) |
| Jogs under 16 px | 12 | 47 | 19 | 11 |
| Wires that bend though their ends face | 22 | 10 | 8 | 8 |
| Wires through an unrelated node | 2 | 0 | 0 | 0 |
| Frame titles a wire runs through | 3 flagged in shipped views | — | 17 of 35 | 5 of 35 |

Pass 1 was one session; pass 2 went after the gaps it named; the third stopped
matching ELK and went after what ELK made the engine work around (next
section). What moved the numbers in pass 2, in order of effect:

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

Read plainly: the spike is legal everywhere, fifteen times faster, level on
area, wire and crossings, ahead on short jogs, and — convention aside — level
on bends. On several views it is now the better picture (`27-k8s#cluster`: 0
crossings to ELK's 2, 806 px tall to 878, every label on its wire).

### What ELK made us work around, and what happens instead

The goal changed in the third pass: not to reproduce the corpus, but to draw
what the language says. Each row is something `layout.ts` answers with an
error, a warning, a second mechanism or a silent compromise, traced to a limit
of ELK. `spike/grid/showcase.squinch` draws the first three side by side;
`language.test.ts` asserts each against both engines.

| The language says | ELK engine | Grid engine |
|---|---|---|
| An edge runs upward between two declared rows (`rows [a] [b]`, `b -> a`) | error: "hint conflict … runs upward" — and the rows are not honoured | drawn: out of the top of the lower box, into the bottom of the upper one, label on the wire |
| `rows [a b c d]` with an unlisted bus between band-mates | error: "a band the layouter could not keep" | the band holds; the bus sits below and its second edge runs up |
| An edge between two row-mates inside an expanded container | warning: "cannot be routed there" | drawn, straight |
| Rank hints between members of one zone | warning: "have no effect" | applied |
| `wrap N` on anything but one chain or one fan-out | warning: "has no effect" | folds any over-wide row; the wires into and out of a folded row are trunks |
| `align a b`, `cols` | a post-pass that moves nodes after ELK and patches the wires | a placement constraint: one centre line, exactly, row-mates make way |
| A frame's title | cannot be an obstacle; a crossed title is redrawn on a halo | an obstacle: ports keep clear of it and a wire turns below it |
| A same-rank wire into a container | stops at the wall unless a corridor is provably empty | always reaches its box |
| A folded fan-out's bus, a `channel` trunk | two hand-written routers, drawn after ELK | one `bundle`: a port, a lane and a track shared |
| A stage with a successor and a side lookup | steps off its row; fixed by a special case in directed frames | stays in line with the successor everywhere; the lookup hangs beside it |
| A zone chip on a border wires cross | slid along the border after layout | the same, kept |
| A jog too short to draw as a corner | reported by the invariant sweep | slid straight: the port, or every port on that wall, moves |

The first five are first-`check` failures a cold agent can no longer hit, and
the product's acceptance number is first-check passes.

### Where it is still rough

- **Titles under a rightward flow.** A frame laid out `direction right` takes
  a wire from above through its low wall, where the title lies along the wire's
  path (5 frames in the corpus). Needs the same rule on that wall.
- **A turn under a title is tight.** The wire enters beside the title and
  turns 8 px below it to reach a box underneath. Legal and legible; a frame a
  little wider would read better.
- **Root order is declaration order**, as under ELK. Where that crosses wires
  both engines cross them. Whether an unarranged *root* should reorder too is
  a language question, not an engine one.
- **Spacing is the nominal density.** A labelled view under ELK comes out
  about 10% tighter between ranks than DESIGN's numbers say, an artefact of
  the spacer scheme. The spike draws the documented 56 px, so some simple
  views are a little taller than their committed renders.

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
| `wrap` on any graph | yes | folds every over-wide row; trunks are bundles — no bus router |
| `channel` | yes | the same bundle, shared at the target |
| `align`, `cols` as an axis | yes | a placement constraint: one centre line, exactly |
| `route … from/to <side>` | no | 2 uses in the corpus |
| Zone-chip avoidance | yes | slid along the border, as today |
| Notes, flow badges | no | placed after layout from nodes, wires and pills; engine-independent |
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
- **Tuning is recorded, not hidden.** Placement has a handful of constants
  found by measuring this corpus: five sweeps, pull weights of 8 / 3 / 2 / 0.25
  (through-wire, box-to-box, wire-to-box, wall port), a pull divided by how
  crowded the far wall is and halved toward a dead end, and a 15 px
  straightening threshold. Each was kept
  because the corpus totals improved; none has been tried against diagrams
  outside the corpus.

## What this does and does not show

It shows the mechanism works across every feature that shapes geometry, that
it is small, that it removes the three bug classes by construction, and that
its quality reaches ELK's on this corpus with three sessions of work.

It does not show how it behaves on diagrams it has not seen. Every tuning
choice was made against these 259 views, which is exactly the over-fitting
risk; the gauntlet is the test for that, and it has not been run.

## Recommendation

On this corpus the spike now matches ELK on area, wire and crossings, beats it
on short jogs and crossed titles, and draws five things the ELK engine
refuses. What remains before a gauntlet round:

1. **Decide the centring convention** (DESIGN.md) — it is the whole of the
   remaining bend gap.
2. **The rest of the surface**: `route … from/to <side>`, notes and flow
   badges (share the annotation pass with `layout.ts`), and the hint
   diagnostics — fewer than today, because five of them describe things that
   now simply work.
3. **Titles under a rightward flow**, and a look at root reordering.
4. **Lookbook review** of every view side by side, then one gauntlet round
   with the engine swapped in. Every tuning constant was chosen against these
   259 views; the gauntlet is the test for over-fitting, and it has not run.

If the gauntlet round fails on shapes the corpus never had, that is the long
tail showing itself, and the question becomes how long it is.

The timing argument stands either way. After launch, `render --check` makes
layout output something users have committed, and any engine change makes their
CI stale.
