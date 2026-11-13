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

About 1,700 lines of engine and 380 of adapter, no dependency, no file over
290 lines. It returns the same `Positioned` the renderer and `checkLayout`
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

| Measure | ELK | Grid, pass 1 | Grid, pass 2 | Grid, pass 3 | Grid, now |
|---|---|---|---|---|---|
| Layout time, whole corpus | 3,331 ms | 171 ms | 210 ms | 230 ms | 301 ms |
| Invariant violations (`checkLayout`) | 0 | 0 | 0 | 0 | 0 |
| …with *every* wire held to "crosses no foreign box" | not asserted | 0 | 0 | 0 | 0 |
| Total area | 81.3 M | 81.0 M | 79.9 M | 79.6 M | 79.4 M (×0.98) |
| Total wire length | 230 k | 239 k | 230 k | 229 k | 199 k (×0.86) |
| Wire crossings | 73 | 120 | 78 | 73 | **38 (×0.52)** |
| Bends | 1,174 | 1,565 | 1,331 | 1,337 | **989 (×0.84)** |
| Jogs under 16 px | 12 | 47 | 19 | 11 | 12 |
| Wires that bend though their ends face | 22 | 10 | 8 | 8 | 8 |
| Wires through an unrelated node | 2 | 0 | 0 | 0 | 0 |
| Frame titles a wire runs through | 3 flagged in shipped views | — | 17 of 35 | 5 of 35 | 5 of 35 |

"Now" is after the trial below: the two changes that moved it came from
diagrams outside the corpus, not from the corpus.

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

Read plainly: on the corpus the spike is legal everywhere, eleven times
faster, level on area, and ahead on wire, bends, short jogs and crossings
(half of ELK's). Several views are now the better picture (`27-k8s#cluster`:
0 crossings to ELK's 2, 806 px tall to 878, every label on its wire).

### Tidiness: alignment, straight wires, nothing almost-aligned

Legal and compact is not the same as good-looking. A review of side-by-side
renders ("the column of three expanded systems looks better with ELK") turned
up faults no total had flagged, and each became a rule:

- **Boxes line up on their centres; ports go to meet the wires.** Placement
  used to line a box up on one of its neighbour's ports, so a chain whose
  middle stage had a second wire sat a third of a wall off its own baseline.
  Now boxes pull centre to centre, and each port slides along its wall to
  where its wire runs straight — keeping its order and 16 px from its
  neighbours, and keeping the even spread where no straight run is possible.
- **A box holds its lane against a wire passing it.** Where the two want the
  same place the wire goes round; a box off its line is seen, a wire a little
  longer is not.
- **A parent stays centred over its children.** Only a wire that has both its
  walls to itself is pulled dead straight; a fan keeps its symmetry.
- **One grid for the whole picture.** Every box's centre line stands on the
  8 px design grid, in every container and across them (a container's width is
  a whole number of steps, so its inside is on its parent's grid). Two boxes
  are on one line or a clear step apart, never a few pixels — DESIGN's
  "nothing almost-aligned", which could not be held while ELK placed nodes.
- **No jog too short to draw.** A turn under 16 px is removed — a port slides,
  then every port on that wall, then a passing wire shifts, then a box moves
  if nothing straight bends for it — or is opened to a full corner.
- **Several labelled wires share the gap between two neighbours**, each label
  on its own wire's stub, instead of the second being sent the long way round.
- **An arrival lane never stretches a container** to reach it (the cause of
  the tall empty frame in the flagged view).

`metrics.ts` gained `nearMiss` — pairs of boxes in one container whose centre
lines are 1–7 px apart — because nothing else measured it.

| | ELK | Grid, before | Grid, now |
|---|---|---|---|
| Corpus: bends | 1,174 | 1,113 | 1,083 (×0.92) |
| Corpus: jogs under 16 px | 12 | 4 | 13 |
| Corpus: almost-aligned pairs | 9 | 17 | 1 |
| Corpus: wire length | 230 k | 219 k | 198 k (×0.86) |
| Corpus: crossings | 73 | 38 | 40 |
| Trial: bends | 4,328 | 3,957 | 4,088 |
| Trial: almost-aligned pairs | 44 | 89 | 2 |
| Turned sideways: almost-aligned pairs | 66 | 66 | 0 |
| Turned sideways: jogs under 16 px | 43 | 47 | 28 |

Two more rules came from a second look at two views ("the Data container has
a bunch of empty area", "the bottom should be centred below the rest"):

- **The side with more pull decides where a box sits.** A box used to take
  the median of every wire it has, above and below together — so a container
  with one wire in and two out lined up over one child instead of between
  them, and dragged the row below off-centre. Now each side gives its own
  median and the heavier side wins: a parent sits centred over its children
  whatever feeds it. This costs bends by the count (a centred parent bends
  both wires where a lopsided one bends one) and is the right trade.
- **A box is only moved to straighten a wire if the wires of everything that
  moves get shorter in sum.** Otherwise one wire went straight while a
  row-mate's grew by as much, and a centred row slid sideways.
- **A wire going round the boxes of a titled container goes round the far
  side from the title, and hugs the row.** It used to open a band under the
  title and push the boxes down.
- **A wire's label reserves room only where it is drawn.** It was also
  reserving a row inside every container the wire passed through — which
  both padded those containers and hid the hint that orders their exits.
- **A container's exits are ordered by where the wires end up**, not by the
  next slot along, which had been placed to suit the container in the first
  place.

Short jogs on the corpus are level with ELK rather than below it (13 to 12):
the grid moves a box up to 4 px, and where a port cannot absorb that — two
wires into a container's fixed ports, a crowded wall — a small jog comes
back.

### Diagrams neither engine had seen

Every number above was earned on the corpus the engine was tuned against. So
`spike/grid/trial/` holds twenty diagrams written afterwards, on purpose
unlike the corpus — a hub with ten services, a saga with compensations, a
lattice, a tree, a dense bipartite graph, nested containers three deep, zones
side by side — and `trial.test.ts` adds eighty seeded random ones (flat,
grouped into expanded systems, with `rows`, `wrap` or a rightward flow).
115 views in all:

| | ELK engine | Grid engine |
|---|---|---|
| Check errors | 17 | — (plans and solves; no diagnostics yet) |
| Check warnings | 18 | — |
| Invariant violations in what was drawn | 31 | 0 |
| Wires through an unrelated node | 11 | 0 |
| Total area | 117.7 M | 106.6 M (×0.91) |
| Total wire | 856 k | 773 k (×0.90) |
| Bends | 4,328 | 3,957 (×0.91) |
| Jogs under 16 px | 119 | 125 |
| Wire crossings | 607 | 772 (**×1.27 — worse**) |

What the trial found, and what was done about it:

- **A label overlap** — two labelled wires between one pair of neighbours.
  Fixed: one labelled wire has the gutter, a second goes round.
- **Crossings at ×1.8.** Two causes. Flat graphs: the root kept declaration
  order however many wires that crossed. Now **every container reorders the
  boxes the author did not place, when and only when declaration order
  crosses wires** — which also halved crossings on the corpus (73 → 38).
  Nested graphs: two neighbouring containers each ordered their wall ports to
  suit themselves. Now a container follows the flow — its entry ports take
  the order the wires arrive in — over up to three further passes.
- **Everything a little bent.** Placement splits a disagreement evenly, which
  leaves both wires slightly off. A final pass moves a box the whole way,
  pushing row-mates along, wherever that makes one wire dead straight without
  bending another. Bends fell below ELK's on both sets.

What it still shows: **crossings between nested containers.** Flat random
graphs now cross less than ELK (107 to 138); graphs with expanded systems
cross about twice as much. A container's inside is still ordered before its
surroundings are known and only partly corrected afterwards; ELK lays the
whole hierarchy out at once. That is the remaining structural gap, and the
next thing to work on.

Two caveats on reading the table. The random `rows` cases pin six boxes
regardless of their edges; the grid engine honours that and pays in crossings,
where the ELK engine reports an error and ignores the hint. And reordering an
unarranged root is a change in what the language promises (declaration order
was the root's order under ELK), made here because the picture is better —
it should be confirmed in SPEC rather than assumed.

### Zones and expanded containers: is it where the author put it?

The complaint that started this: asking for zones side by side and not
getting them. `spike/grid/zones.test.ts` states an arrangement in each source
and checks the rectangles for it — 28 hand-written cases and 60 random rows
of two to four zones, each an expanded system, wires anywhere between them.

| | ELK engine | Grid engine |
|---|---|---|
| Hand-written: arranged as asked | 20 of 28 | 28 of 28 |
| Hand-written: a row's tops on one line | 8 of 28 | 28 of 28 |
| Random rows: arranged as asked | 60 of 60 | 60 of 60 |
| Random rows: tops on one line | 21 of 60 | 60 of 60 |

Two different things are wrong under ELK, and they explain the complaint.

**Top-level zones do go side by side — unevenly.** ELK centres each zone in
its layer, so three zones of different heights sit at three different tops.
Nothing is refused; it just never looks like the row that was asked for.

**Anything inside another boundary is not arranged at all.** A zone is one
block to the ELK engine and its members are ranked inside it by ELK, so all
eight failures are the same failure:

- two VPCs inside a cloud zone, asked side by side → stacked;
- two regions inside a cloud, with replication between their databases →
  stacked, 1,087 px tall, where side by side is 612;
- two expanded systems inside one zone → stacked;
- `rows` between the members of one zone → ignored, with a warning;
- an on-premises zone beside a cloud holding two VPCs → the VPCs stacked;
- zones stacked on purpose against an upward wire → an error, and reversed;
- side by side by `cols`, or by `place … right-of` → stacked.

The grid engine has one rule — project the hints onto each container's direct
children — so a zone inside a zone is arranged exactly as one at the root is.
The suite also found two bugs in the spike's own reading of the language,
both fixed: `place b right-of a` moved `a` away when nothing else had pinned
it, and `cols` only ordered boxes within a rank where the spec says columns.
Columns are now bands across the ranks.

### `wrap` inside containers

Containers get too wide: a dispatcher and nine workers is one row of nine. The
ELK engine can fold a view only when it holds nothing but one chain or one
fan-out — a view with an expanded container or a zone gets "`wrap` has no
effect". `spike/grid/wrap-containers.test.ts` asks for the fold in ten such
views and checks that no row holds more than was asked.

| | ELK engine | Grid engine |
|---|---|---|
| Rows folded as asked | 1 of 11 (a chain that was already one per row) | 11 of 11 |
| A dispatcher and nine workers, expanded, `wrap 3` | 1,432 × 634 | 584 × 764 |
| Ten stores in a zone, `wrap 5` | 1,736 × 333 | 920 × 456 |
| Wide inside wide, `wrap 4` at both levels | 2,464 × 425 | 1,347 × 584 |
| A chain of eight stages, expanded, `wrap 4` | 224 × 1,166 | 676 × 532 |

How it works: each container folds its own direct children, by the same rule
as the root — a chain becomes a serpentine, anything else keeps its ranks and
splits each over-wide one into bands. Three things make the result a grid
rather than a staircase, all found by looking at the first attempt:

- the bands of one rank stand in columns (the `align` constraint);
- wires from one source into the later bands are one trunk, as are wires from
  the earlier bands to one target;
- the same holds across the container's wall — nine workers writing to one
  store outside are a trunk, not nine lanes threading the bands below.

Two ways to ask. The view's `wrap N` reaches every container the view opens.
A container can also carry its own — `layout { wrap 4 }` in the system's
block, beside `rows`, `cols`, `place` and `direction` — which is where the
fact belongs, since it follows the container into every view. That line is
now part of the language (SPEC §3): the model accepts it, `wrap` beside
`rows` or `cols` in one block is an error as in a view, and the ELK engine
folds the view scoped to the container and warns, with the `rows` line to
write, where the container is expanded inside another view.

### Left to right

`spike/grid/direction-right.test.ts` asks three things of a rightward flow.

**Does it read rightward?** Twelve acyclic diagrams with nothing arranged by
hand — chains, fans, a lattice, a tree, tiers. Both engines: every one of 75
wires leaves an east wall and enters a west one, and all 45 columns keep one
left edge. No difference; sizes within a few pixels.

**Are arrangements honoured?** Under a rightward flow a `rows` band is a
column. Twelve stated arrangements — zones one after another, two zones in one
column, a cloud holding two VPCs, a downward container inside a rightward
view, a wire running back against the flow, a folded chain, tables.

| | ELK engine | Grid engine |
|---|---|---|
| Arranged as asked | 11 of 12 | 12 of 12 |
| Tidy (a row's tops level, a column flush left) | 8 of 11 | 10 of 11 |

ELK's one miss is the same as under a downward flow: two VPCs inside a cloud,
asked into one column, come out side by side.

**Is everything still legal on its side?** Every corpus and trial view that
is not already rightward, turned to flow right — 303 views.

| | ELK engine | Grid engine |
|---|---|---|
| Check errors | 14 | — |
| Invariant violations | 11 | 0 |
| Total area | 114.3 M | 109.2 M (×0.96) |
| Total wire | 392 k | 350 k (×0.89) |
| Bends | 1,972 | 1,757 (×0.89) |
| Crossings | 153 | 139 (×0.91) |
| Jogs under 16 px | 43 | 47 |

One rough spot, in both engines: a chain with a wire running back (`a -> b
-> c`, `c -> a`) does not sit on one baseline. The returning wire shares a
wall with the forward one, the two ports sit a third of the wall apart, and
the next box lines up on its port rather than on the box's centre — 11 px
off. Two fixes were tried and measured (line boxes up on centres and let
ports slide to meet; place boxes before the wires that pass between them).
Both made that case level and neither was kept: the first moved the totals
the wrong way on bends, the second cost 9% of area on dense graphs.

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
- **Crossings between nested containers** — see the trial above.
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
| `wrap` on any graph, in any container | yes | folds every over-wide row at every level; trunks are bundles — no bus router |
| `channel` | yes | the same bundle, shared at the target |
| `align`, `cols` as columns | yes | a placement constraint: one centre line, and each column wholly before the next |
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

On the corpus the spike now beats ELK on every measure but area, where it is
level. On diagrams it had never seen it draws 115 views with no violation
where the ELK engine reports 17 errors and leaves 31 violations, and it is
ahead on area, wire and bends — and behind on crossings wherever containers
nest. What remains before a gauntlet round:

1. **Crossings between nested containers.** The one measured weakness.
2. **Confirm two conventions**: a parent centred over two children
   (DESIGN.md), and reordering unplaced boxes when declaration order crosses
   wires (SPEC.md).
3. **The rest of the surface**: `route … from/to <side>`, notes and flow
   badges (share the annotation pass with `layout.ts`), and the hint
   diagnostics — fewer than today, because five of them describe things that
   now simply work.
4. **Titles under a rightward flow.**
5. **Lookbook review** of every view side by side, then one gauntlet round
   with the engine swapped in. The trial set is a start on the over-fitting
   question; cold agents are the real answer.

The timing argument stands either way. After launch, `render --check` makes
layout output something users have committed, and any engine change makes their
CI stale.

## A score for "does it look better?"

`spike/grid/score.ts` turns the question into one number per view, so it can
be asked of every view at once and answered the same way each time. A view's
*penalty* adds up what a reviewer would mark on it:

| Weight | For each |
|---|---|
| 60 | illegal thing: a wire through a box, a broken invariant |
| 10 | crossing |
| 5 | jog too short to draw cleanly; pair of boxes almost, but not, in line |
| 4 | box off the middle of the boxes its wires fan out to |
| 3 | wire that bends although its ends face each other |
| 1 | bend; 200 px of wire; 200×200 px of canvas |

Lower is better; within 5% either way is "the same". The weights are a
judgement, written down once and applied to both engines, and
`score.test.ts` prints how the verdict moves when each is halved or doubled.

`npx vitest run spike/grid/score.test.ts --disable-console-intercept`, over
409 views — the corpus, the twenty trial diagrams, sixteen more written after
the engine (`round2/`: checkout, a data platform, three subnets, event-driven,
microservices, CI/CD, two regions, an ML lifecycle, an SSO hub, nested zones,
IoT, a bank, a long chain, tables, a SaaS product, a team mesh) and eighty
random ones:

| Set | Views | Better | Same | Worse | Total penalty |
|---|---|---|---|---|---|
| Corpus | 259 | 104 | 84 | 71 | −19% |
| Trial | 35 | 20 | 7 | 8 | −31% |
| Round 2 | 35 | 23 | 3 | 9 | −38% |
| Random | 80 | 43 | 11 | 26 | −4% |
| **Everything** | **409** | **190** | **105** | **114** | **−14%** |

Three things to know before quoting that.

- **It turns on centring.** A parent centred over two children bends both
  wires; ELK runs one straight and hangs the parent over that child. Count
  bends alone and the centred picture loses. With the centring term set to
  nothing the tally is 140 better, 119 the same, 150 worse — the new engine
  behind by count, still 14% ahead on total penalty. The term is in because
  centring is what was asked for; the number without it is printed beside.
- **The views it wins, it wins by more.** Where the grid is ahead the cause
  is usually something ELK got wrong outright — 62 illegal things across the
  set, none in the grid — or a wire taken the long way round. Where it is
  behind the cause is nearly always crossings: 249 more of them across the
  114 lost views, mostly in dense random graphs and between nested containers.
- **The score cannot see a hint that was not honoured.** `10-nested-zones#side`
  asks for two networks side by side; ELK stacks them and scores 40, the grid
  does as asked and scores 121 for the crossings it draws getting there.

What the scoring round changed in the engine, each found by a view that lost:

- A container's wall ports stand on the 8-pixel grid like its boxes. Two
  containers joined by a straight wire used to round to different lines and
  leave a jog of a few pixels between them.
- A bundled wire's label stands on its own last stub, not half-way along the
  trunk it shares, where it split the trunk into a comb.
- Several wires into the side of one plain box each get their own place on
  the wall (two used to land on one point).

Still behind, by eye as well as by number: wires between nested containers
(`14-tables#schema`, `10-nested-zones#side`), and a box with no wires is kept
in declared order even where moving it would let two zones line up
(`20-multicloud-migration#landscape`, 688 px wide to ELK's 472).

### After three more passes

| Set | Views | Better | Same | Worse | Total penalty |
|---|---|---|---|---|---|
| Corpus | 259 | 109 | 84 | 66 | −21% |
| Trial | 35 | 22 | 8 | 5 | −36% |
| Round 2 | 35 | 28 | 3 | 4 | −45% |
| Random | 80 | 49 | 12 | 19 | −8% |
| **Everything** | **409** | **208** | **107** | **94** | **−18%** |

Without the centring term: 157 better, 123 the same, 129 worse — ahead by
count now, where it was behind. Short jogs: 3 on the corpus (ELK 12), 40 on
the trial set (ELK 119). Crossings: 32 on the corpus (ELK 73); 698 on the
trial set (ELK 607), all of the excess in dense random graphs.

What moved it, each from a view that lost:

- **Nested containers agree on an order.** Two things are learned from each
  layout and they answer each other: the order of a container's boxes
  follows where its wires arrive from, and the order of the wires leaving a
  container follows where they end up. Refreshed together they swapped
  places every pass and ended crossed. Now they take turns, a container
  reports the *box* a wire finally reaches rather than its own wall port,
  and a last pass refreshes neither (`engine.ts`, `Laid.reach`).
- **Wall ports out of order with where their wires end up count as the
  crossing they cause outside**, where the container cannot see it
  (`order-slots.ts`, `astray`).
- **Unplaced boxes may trade places** to uncross a wire from outside, and
  the wire slots beside them re-sort before the trade is judged.
- **A wire to a side wall takes whichever channel is quieter** — over the
  row or under it — and steps into the gutter rather than running along a
  container's wall (`side.ts`).
- **A short jog still being handed from hop to hop on the last round is
  opened to a full corner** instead of left where it stopped.

Tried and not kept: letting the inside of a container decide its entry order
outright (more crossings upstream than it saved); standing unwired boxes
after wired ones in a row (no gain, and it overrides declaration order).

Three things that are taste rather than defects, to be decided:

- **Spacing.** The grid gives every gap the density's spacing. ELK, in a view
  with any label, lets unlabelled gaps shrink — 22 px between two boxes of a
  rightward chain, 36 px between ranks — so its small views are 10–15%
  smaller and score better on area alone.
- **Centring** (above).
- **Declared order.** A box with no wires keeps its declared place even
  where moving it would let two zones line up
  (`20-multicloud-migration#landscape`: 688 px wide to ELK's 472).
