# Note — spike: a layout engine of our own (2026-11)

**Status: a spike, not a decision.** The code is in `packages/core/spike/grid/`,
outside `src/`, and nothing ships from it. The ELK engine is untouched apart
from `sizeOf` gaining an `export`.

The question was whether to keep extending the ELK-based engine or to own the
layout. This note records what a one-session prototype showed, so the decision
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
| `rank.ts` | 114 | Ranks for one container. Pins are hard; cycles broken once. |
| `isotonic.ts` | 33 | Positions along a rank — an exact solve, no iteration. |
| `channel.ts` | 74 | Track assignment. The only routing primitive. |
| `engine.ts` | 793 | Ties them together; knows nothing about Squinch. |
| `problem.ts` | 225 | A Squinch view → the engine's input. No geometry. |
| `layout.ts` | 87 | The engine's output → `Positioned`. |

About 1,000 lines of engine and 300 of adapter, no dependency. It returns the
same `Positioned` the renderer and `checkLayout` consume, so both engines can
be drawn and checked by the same code.

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

| Measure | ELK | Grid | |
|---|---|---|---|
| Layout time, whole corpus | 3,555 ms | 171 ms | 20× faster |
| Invariant violations (`checkLayout`) | 0 | 0 | |
| …with *every* wire held to "crosses no foreign box" | not asserted | 0 | stricter than today |
| Total area | 81.3 M | 81.0 M | ×1.00 |
| Total wire length | 230 k | 239 k | ×1.04 |
| Bends | 1,174 | 1,565 | **×1.33 — worse** |
| Wire crossings | 73 | 120 | **×1.64 — worse** |
| Jogs under 16 px | 12 | 47 | **worse** |
| Wires that bend though their ends face | 22 | 10 | better |
| Wires through an unrelated node | 2 | 0 | better |

ELK's 70 "overlaps" in the raw output are almost all deliberate shared trunks
(`wrap` buses and `channel`s), which the spike does not draw, so that row is
left out as not comparable.

Read plainly: the spike is **legal everywhere on the first full run** and much
faster, and it is **not yet as tidy as ELK**. It is level or better on small
and medium views, and visibly worse on large unhinted ones.

### What it honours that ELK cannot

`spike/grid/language.test.ts` asserts each of these against both engines:

| Source | ELK engine | Grid |
|---|---|---|
| `rows [a b c d]` with an unlisted bus between band-mates | error: "a band the layouter could not keep" | the band holds; the bus sits below |
| An edge between two row-mates inside an expanded container | warning: "cannot be routed there" | drawn, straight |
| Rank hints between members of one zone | warning: "have no effect" | applied |

Each is a first-`check` failure a cold agent can no longer hit. That matters
more than the geometry: the product's acceptance number is first-check passes.

### Where it is worse, and why

Seen in side-by-side renders (`spike/grid/render-pair.ts`):

- **Large unhinted graphs** (`35-monorepo#landscape`: 3 crossings to ELK's 0,
  a source card stranded top-right). Ranking uses a local "move toward the
  busier side" pass; ELK uses network simplex, which moves whole chains.
- **Crossings generally.** Pass-through wires are inserted one at a time where
  they cross least. ELK sweeps layers repeatedly. Boxes never reorder in the
  spike, including inside containers, where ELK does reorder.
- **A folded fan-out** (`39-wrap#fan`: 2,143 px wide to ELK's 1,264). There is
  no shared trunk, so twelve wires each take their own lane through band one.
- **Container wall ports** are chosen by the inside alone. A wire can enter
  through the frame's title strip or meet the wall away from where the outside
  would like it.

The first three are textbook algorithms (network-simplex ranking, layer-sweep
crossing reduction, hyperedge merging), each a few hundred lines. The fourth is
the real design question — it is the trade ELK's global `INCLUDE_CHILDREN`
makes the other way.

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
| `wrap` on a fan-out | partly | lays out, no shared trunk |
| `channel` | no | needs the same shared trunk |
| `align` | no | would be a placement constraint, not a post-pass |
| `route … from/to <side>` | no | 2 uses in the corpus |
| Notes, flow badges, zone-chip avoidance | no | placed after layout from nodes, wires and pills; engine-independent |
| Hint diagnostics | no | the spike plans and solves; it does not yet say why a hint is wrong |
| `color`, `only`, `detail`, legend, titleblock, themes | n/a | upstream or downstream of layout |

## Clean code, testability, simplicity

- **Testable in parts.** `engine.test.ts` tests ranking, placement, the median
  and track assignment each on a few lines of input, with no view, model or
  font. The ELK engine has no seam to test below `layoutView`.
- **Properties, not snapshots.** "`direction right` is the transpose of `down`"
  and "a long wire avoids the rank it passes" are one-line assertions.
- **Synchronous and dependency-free.** No `await`, no 1.6 MB bundle.
- **Not yet clean enough.** `layoutGroup` in `engine.ts` is one 450-line
  function. It has clear internal stages (links, layers, ports, place, stack,
  route, emit) and should be split along them before anything is built on it.
  Placement also has three tuning choices (sweep order, pull weights, an 8 px
  straightening pass) found by measuring this corpus; they need the same
  recorded-measurement discipline the ELK notes have.

## What this does and does not show

It shows the *mechanism* works across every feature that shapes geometry, that
it is small, and that it removes the three bug classes by construction rather
than by another pass. One session produced a legal layout for the whole corpus;
the ELK engine took months of fixes to reach the same sweep.

It does not show the *quality* is there. The gaps are specific and understood,
but "understood" is not "closed", and the long tail of a new engine is unknown
until agents write diagrams against it.

## Recommendation

Continue, behind a gate, without touching the shipping path:

1. Close the three algorithmic gaps (network-simplex ranking, layer-sweep
   ordering including boxes inside unhinted containers, shared trunks).
2. Decide wall-port placement — let the outside inform the inside's port order.
3. Split `layoutGroup`; move the annotation pass (notes, badges, chips) out of
   `layout.ts` into a function both engines call. That split is worth doing
   even if the answer is to stay on ELK.
4. **Gate:** bends, crossings and area at or below ELK's corpus totals, zero
   strict violations, and a lookbook review. Only then run a gauntlet round.

If the gate is not met after that work, stop: keep ELK, keep the split from
step 3, and keep the three language wins as the list of what ELK costs us.

The timing argument stands either way. After launch, `render --check` makes
layout output something users have committed, and any engine change makes their
CI stale.
