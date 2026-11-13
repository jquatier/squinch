# braid

A layout engine for Squinch diagrams: boxes in ranks, wires in channels.
Written from `../REQUIREMENTS.md`, `../contract.ts` and the test suites, and
from nothing else — it shares no code with the two engines before it
(`../grid`, `../loom`).

`solve(problem: Problem): Solution` in `engine.ts` is the whole interface.
The engine knows nothing about Squinch: boxes (some holding boxes), wires,
and per container a direction, spacing and what the author pinned go in; a
rectangle per box and an orthogonal polyline per wire come out.

## The design in one page

```
solve(problem)                                                   engine.ts
  plan    the tree · every container's ranks · every wire as     tree.ts rank.ts plan.ts
          pieces · which rank-mates are glued
  order   the order of every row of every container, together    order.ts count.ts estimate.ts
  lay     each container drawn in its own frame, innermost       lay.ts place.ts ports.ts tracks.ts
          first
  emit    the frames set in the page, the wires stitched         emit.ts
```

Four stages, each deciding one thing, once, with what it needs in view. None
hands anything back to an earlier one, and nothing is tried twice and the
better result kept.

**One representation.** Every container is a *cell*: a stack of *rows* in a
frame of its own in which ranks always run downward (a `right` container is
the same cell, transposed on the way out). The rows are the cell's north
wall, its ranks — with a row of labels in each gap that carries one — and
its south wall. A row holds *items*: boxes; a *lane* for each wire passing
that rank; on a wall row, each wire's *port*. A label is an item with a
size, so "labels do not overlap boxes, each other, or a foreign wire" is
ordinary spacing between row-mates rather than a placement search.

Every wire is a run of *pieces*, each inside one cell:

| piece | what it is |
|---|---|
| `seg` | from an item of one row to an item of the next |
| `turn` | between two boxes of one rank with something between them: round, under the row |
| `glued` | between two neighbours on one rank: straight across the gutter |
| `side` | from a box to the cell's east or west wall — straight out, or along the channel over or under its row |

Which pieces a wire has follows from the ranks and from which rank-mates are
*glued* (stand side by side because a wire joins them directly), and both
are settled in `plan`. So the set of items is fixed before the order is
searched, and the search only ever permutes rows.

**One count.** Between two consecutive rows lies a *channel*, bounded by the
upper row, the lower row and the cell's two side walls. Every piece routed
through it joins two points on that boundary, and two pieces cross exactly
when their ends alternate going round it (`count.ts`). That single rule
covers wires between ranks, wires going round a row, and wires leaving by a
side wall. A point's place on the boundary is an item's place in its row —
and, for a wire entering a container, the place of its port on that
container's wall, asked of the container every time. That is what makes the
inside and the outside of a wall one decision: move a port, and the count
on both sides of the wall moves with it. `sweep.ts` checks the count against
the finished pictures; they agree (see "What is measured").

**One judge.** `order.ts` keeps a candidate only if `score` prefers it:
fewer crossings; then fewer boxes out of their declared order; then
straighter wires, estimated from real box sizes (`estimate.ts`). The lexical
order *is* the rule "declaration order is worth a tie, not a crossing; among
equals prefer the straighter". Two moves propose candidates:

- **rethread** lifts one thread — every lane and port of one wire, in every
  cell it passes — and puts it back along the cheapest path, found exactly
  by a shortest-path pass over the gaps of the rows it visits. The port on a
  wall, the lane inside and the lane outside move together: the move that no
  sequence of single swaps can make.
- **shift** stands a box (with the rank-mates glued to it) elsewhere in its
  row and rethreads the wires that end on it. Tried only while there is a
  crossing to remove or a box to return to its declared place.

**One placement problem per cell.** Where everything stands along its row is
put to a network-simplex solver (`simplex.ts` — the same solver that ranks
the boxes) as "least total sideways run": each wire is a term
`|x(one end) − x(other end)|`, each pair of row-mates a minimum distance.
An L1 measure makes a wire that can be straight exactly straight and stands
a box with three wires below it over the middle one; because every distance
given is a multiple of 8, every centre line lands on one 8-pixel grid with
no rounding step. The tidiness rules of §5.5 are the weights and offsets of
the terms, all in one function (`pulls` in `place.ts`).

**What is iterated, and why.** Three things, each explicit and bounded:

1. The order search repeats its two moves until neither improves the score
   (at most 8 rounds). It is a local search over one state with one judge;
   there is no second start and no best-of-N.
2. A container's size depends on its inside, and where the wires outside
   arrive depends on that size: so cells are laid out innermost first, once.
   The cell outside then brings its wires to the ports the inside chose
   (their offsets are part of its placement terms). The single thing passed
   back down is `nudge` in `lay.ts`: a straight stub from a box inside a
   finished container to that container's side wall may slide along the
   box's wall to come level with the wire it meets. It moves no box and
   changes no size.
3. `unkink` in `place.ts` runs up to four passes over a cell's lanes to
   close single-step jogs (§4, "nothing almost-right") using the slack lanes
   are given beside boxes.

**How it differs from "order and lay out each container in turn, then try
again."** Containers are never ordered one at a time: the state is every
row of every cell, the count reads a container's wall off its ports each
time it is asked, and a move may change rows in several cells at once. And
nothing is laid out twice: geometry is computed once, bottom-up, from a
finished order — the order search never sees a coordinate, only sizes.

## The modules

| file | job | rules it keeps (REQUIREMENTS §) |
|---|---|---|
| `tree.ts` | index the Problem: who holds whom; each wire's home and the chain of boxes down to each end | wires lifted to the container where the ends part (5.1); wires not drawn (3.7) |
| `simplex.ts` | minimise Σ weight·length subject to minimum lengths | — used by rank and place |
| `rank.ts` | ranks for one container | least total wire; pins as given; cycles broken in declaration order; a pinned band stays whole (5.1) |
| `plan.ts` | cells, rows, items, pieces; glue; where labels go | idle boxes last (5.2); rank-mates a wire joins stand together, a third goes round (5.3); labels half-way, only in the home; bundles share lanes and ports, their labels on their own stubs (5.6); which wall a wire uses at every level (5.3) |
| `count.ts` | the exact crossing count; how a `side` piece reaches its wall | count exactly; a container's wall is shared; sideways wires counted (5.2); the quieter channel (5.3) |
| `estimate.ts` | guessed positions from real sizes | straighter among equals, judged with real sizes (5.2); a wire that turns enters clear of the title (5.7) |
| `order.ts` | the search | whole picture together; declaration order worth a tie; held boxes and column bands never pass each other; moves that change several rows at once (5.2) |
| `place.ts` | x of every item of a cell, and its width | all of 5.5; `minW`, as small as the inside allows, ports clear of the title (5.7); column bands, aligned sets (3.8) |
| `ports.ts` | where wires meet a plain box's top and bottom walls | order that prevents crossing; evenly spread; slide to meet a straight wire; only wire in the middle; 8 px from corners (5.4); `face` |
| `tracks.ts` | which track each turning wire takes in a channel | tracks 16 apart; wires that need not cross do not; no stub along another's; a bundle parts on one track (5.3, 5.6) |
| `lay.ts` | one cell: stack the rows, place side ports, draw every piece | channel depths, labelled gaps, top-aligned or centred ranks (5.5, 5.6); wires turn below the title (5.7); gutters; `bleed` |
| `emit.ts` | cells into the page, wires stitched, `right` transposed | 5.8; no repeated points, no three in a line (3.3) |
| `audit.ts` | the hard rules of §3 checked on a Solution (tests and tools only) | 3.1–3.8 |

Each has a `*.test.ts` beside it built from a handful of boxes
(`fixtures.ts`). `engine.test.ts` is the behavioural spec carried across
from the earlier engines; the remaining suites are the acceptance suites of
REQUIREMENTS §7 pointed at this engine.

## Where to extend it

- **A new ordering move** — a function in `order.ts` that permutes rows,
  called through `attempt` inside the round loop. It is judged by the same
  `score` as the rest; nothing else changes. (Turning an unplaced container
  about, or a second starting order, would each be such a move.)
- **A new tidiness rule** — if it is about where boxes stand: a term (or a
  weight) in `pulls` in `place.ts`. About where ports stand: `ports.ts`.
  About which wire turns first: the pair cost `above` in `tracks.ts`. If it
  should be *measured*, add it to `audit.ts`.
- **A new kind of wire** (say a route-side hint, "go round to the left") —
  a new piece kind in `plan.ts` (or a field on `Turn`/`Side`), its chord in
  `chordsIn` in `count.ts` so the count stays exact, its run in the channel
  loop of `lay.ts` and its points in the draw loop there. `order.ts`,
  `place.ts` and `emit.ts` need not know.
- **A new constraint from the author** (like `columns`) — arcs in `build` in
  `place.ts` for the geometry, and `mayPass` in `order.ts` for what may
  change places.

## Tools

```
npx tsx spike/braid/sweep.ts [corpus|trial|round2|random|right] [-v] [-x] [NR=n]
    every set through this engine alone: both judges, the metrics, and
    whether the counted crossings equal the drawn ones (-x lists views that differ)
npx tsx spike/braid/dump.ts <file.squinch|random-N> <view> [right]
    one view's geometry as text, with what both judges say
npx tsx spike/braid/render.ts out.html <file.squinch|random-N>[:view] …
    one view drawn by ELK, grid, loom and braid, side by side (ONLY=loom,braid)
BEFORE_AFTER=1 npx vitest run spike/braid/before-after.test.ts --disable-console-intercept
    this engine against grid and loom, view by view (ONLY=, NR=, AGAINST=)
```

## What is not done

See the hand-back report for the full list. In short: one 8-pixel grid holds
within every run of containers that share a direction, not across a
container of the other direction; a wire that ends *at* a container (rather
than inside it) is drawn to its wall but takes no part in the port order
there; bundles are counted as their members (a bus crossed once is counted
once per branch it shadows); and a port is not slid along a container's
north or south wall once the container is drawn.
