# Requirements for a layout engine, written from scratch

This is the brief for a **ground-up rewrite** of Squinch's spike layout
engine. Two engines already exist in this directory (`grid/`, the first, and
`loom/`, a partial rebuild of it). They are the *before*. You are writing the
*after*: a new engine, designed and written from nothing but this document,
the contract, and the tests.

Everything below was learned the hard way, from several hundred diagrams and
a long run of "that one looks wrong — why?". Treat each rule as a
requirement, not a suggestion; where two pull against each other the text
says which wins.

## 0. Ground rules for the rewrite

- **Write it cold.** Do not open, copy from, or port the engine
  implementation files of the earlier engines. That is every non-test `.ts`
  file in `grid/` and `loom/` **except** the ones listed under "What you may
  read". Their designs grew by accretion; the point of this exercise is a
  design that did not. If you find yourself wanting to see "how the old one
  did it", work it out from the requirement instead.
- **What you may read** (the contract, the Squinch side, the yardsticks, and
  tests as executable requirements):
  - `contract.ts` — `Problem`, `Solution` and friends. Your engine's whole
    interface.
  - `grid/problem.ts` — how a Squinch view becomes a `Problem` (so you know
    what real Problems look like: zones and frames as containers, hints as
    `pins` / `held` / `aligned` / `columns`, `wrap` folds, bundles, titles).
  - `grid/layout.ts` — `layoutViewGrid(model, view, font, solver)`: runs any
    `solve` on a view and dresses the result as `Positioned`.
  - `grid/metrics.ts`, `grid/score.ts` — how a layout is measured and scored.
  - `grid/asks.ts`, `grid/random.ts`, `grid/trial/*.squinch`,
    `grid/round2/*.squinch` — test helpers and the diagram sets.
  - Every `*.test.ts` in `loom/` and `grid/` — as statements of required
    behaviour. (Unit tests of the old engines' *internal* modules — rank,
    spread, tracks, sketch, tree — tell you what those authors needed from
    their own parts; you owe nothing to that decomposition.)
  - `packages/core/test/invariants.ts` (`checkLayout`),
    `packages/core/test/helpers/corpus.ts`, `packages/core/src/layout/layout.ts`
    for the `Positioned` type and the ELK engine's entry point `layoutView`.
  - `docs/SPEC.md`, `docs/DESIGN.md`, `docs/ENGINEERING.md`, `CLAUDE.md` —
    the product's own constitution.
  - `docs/notes/layout-engine-spike.md` — the history. Read it for *why* a
    rule exists if a rule here puzzles you; it describes the old designs in
    detail, which you are not following.
- **Where it goes.** A new directory, `packages/core/spike/<name>/` — pick a
  short name. It exports `solve(problem: Problem): Solution` from
  `engine.ts`, importing its public types from `../contract.js`.
- **Do not modify** `grid/`, `loom/`, `contract.ts`, anything under
  `packages/core/src` or `packages/core/test`, or any other package. If the
  Squinch side needs to change for a requirement to be met, say so in your
  report instead.

## 1. What the engine is for

Squinch draws architecture diagrams from text. Its layout must be
**deterministic** (same input → byte-identical output, on any machine: no
clock, no randomness, no environment, no iteration order that depends on
anything but the input), **isomorphic** (no `node:` imports in engine code —
it runs in browsers), and good enough that an agent writing a diagram from
prose, with no layout hints at all, gets a picture a person would call tidy.

The engine knows nothing about Squinch. It is given boxes (some holding
boxes), wires between them, and per container a direction, spacing, and what
the author pinned; it returns a rectangle per box and an orthogonal polyline
per wire.

## 2. The contract (`contract.ts`)

- A `Group` is a container's inside: `dir` (`down`: ranks advance
  downward, boxes of a rank sit left to right; `right`: the same picture
  transposed), `pad`, `gap.lane` (between two boxes of one rank),
  `gap.rank` (between two ranks), `boxes` in declared order.
- A `Box` is a leaf (it states `w`, `h`) or a container (`group` set; the
  engine computes its size, never narrower than `minW`).
  - `face`: only that much of the box's east/west walls, from the top, may
    take a wire (a table's head; its rows hang below).
  - `bleed`: something drawn below the box that is not part of it (a card's
    stacked sheets). Nothing may be placed over it.
  - `title`: the top-left corner the container's title occupies (see §5.7).
- `pins`: box → rank, as the author stated (`rows`). Unpinned boxes are
  ranked by the engine. `held`: boxes whose *place within their rank* the
  author arranged — their relative order is never changed. `aligned`: sets
  of boxes in different ranks that must share one centre line exactly.
  `columns`: bands across the ranks — every box of one band stands wholly
  before every box of the next, in every rank.
- A `Wire` joins two boxes anywhere in the tree (leaf or container, any
  depth). `label` is the size of a label to place on it. `bundle`: wires
  with the same bundle id share one end and are drawn as one trunk with
  branches (§5.6).
- `Solution`: absolute integer rectangles for every box (containers
  included); `ranks` (each box's rank in its own container); for every drawn
  wire an orthogonal polyline from the `from` box's wall to the `to` box's
  wall, and its label rectangle if it has one; `skipped` — ids of wires not
  drawn (one end contains the other, or an end is not in the picture).
- Treat the `Problem` as read-only. `solve` must be a pure function of it.

## 3. Hard rules — a layout that breaks one is wrong

These are checked by `checkLayout` (with every wire held to the strict
"coplanar" rule, as the existing test suites do) and by the suites in §7.

1. No two boxes of one container overlap; a box never leaves its container;
   containers are padded as stated; a container is at least `minW` wide.
2. **A wire never passes through a box that is not one of its own ends or a
   container holding one of them** — not a leaf, not a container, not a
   `bleed`. It may only cross a container's wall on its way to something
   inside.
3. Wires are orthogonal polylines with integer coordinates; consecutive
   points differ in exactly one coordinate; no repeated points; no three
   in a line.
4. A wire meets a box on a wall, at least 8 px from a corner. Two wires
   never meet one wall at the same point; two ports on a wall keep 16 px
   apart where the wall has room.
5. Two different wires are never drawn on top of each other along a
   segment — except wires of one bundle along their shared trunk.
6. A wire's label does not overlap a box or another label, and sits on its
   own wire.
7. Every wire that can be drawn is drawn. An upward wire (target ranked
   above source), a wire between two boxes of one rank, a wire between
   boxes in different containers at any depth, a wire into or out of a
   container held in someone else's rank: all are legal inputs and all must
   produce legal output. The old production engine (ELK) refuses or
   mis-draws several of these; this engine never may.
8. The author's statements hold: a pinned rank is that rank; `held` boxes
   keep their relative order in their rank; `aligned` boxes share a centre
   line to the pixel; `columns` do not interleave.
9. Determinism and purity (§1).

## 4. What "a good layout" means, in priority order

The score in `grid/score.ts` writes this down; lower penalty is better.

1. Legal (§3).
2. **Few crossings.** Two wires crossing is the worst legal flaw.
3. **Nothing almost-right.** A jog shorter than 16 px; two boxes of one
   container whose centre lines are 1–7 px apart; a wall's only wire 1–7 px
   off the wall's middle. Each reads as a mistake. Either exact, or clearly
   different.
4. **Balance.** A box whose wires fan out to several boxes stands over the
   middle of them (or, for an odd number, straight over the middle one).
5. **Straight wires**, few bends, short wire.
6. Canvas size is *not* a goal. A bigger picture is not a worse one. Even
   spacing is preferred to tight spacing.

## 5. Layout rules

### 5.1 Ranks

- Unpinned boxes are ranked to minimise total wire length across ranks (a
  network-simplex-quality answer, not longest-path): a lone source drops to
  just above what it feeds; a feeder floats above a pinned target.
- Cycles are broken in declaration order: the first-declared wire of a
  mutual pair keeps its direction.
- Two boxes joined by a wire *may* share a rank if the author pinned them
  there. A pinned band stays whole even when an unpinned box lies on a path
  between two of its members.
- Each container is ranked on its own, by the wires lifted to it (a wire
  between boxes in two different children counts as a wire between those
  children).

### 5.2 Order within a rank — the decision that fixes crossings

- **Order the whole picture together.** A container's wall is shared: the
  order in which wires cross it decides crossings on *both* sides. Ordering
  containers one at a time, innermost first, leaves the outside to live with
  the inside's choice and was the largest single source of crossings. The
  inside and the outside must be decided jointly.
- **Count exactly.** The quantity being minimised must be the number of
  crossings that will actually be drawn. (Measured on the earlier engines:
  when the model is exact the picture agrees with it; every mismatch found
  was a bug — e.g. a plain box's ports being ordered without regard to
  where on a neighbouring container's wall each wire arrives.)
- A wire that passes a rank on its way to a further one takes a place in
  that rank's order like a box does; which side of each box it passes is
  part of the same decision. So is where each wire's port stands on a
  container's wall.
- Wires leaving a box sideways (through a container's side wall), and wires
  between two boxes of one rank, must be part of the count too — a wire
  passing between a box and the side wall its own wires leave by crosses
  them; nothing may stand between two rank-mates a same-rank wire joins
  directly.
- **Declaration order is worth a tie, not a crossing.** A box leaves its
  declared place only to remove a crossing — never merely to straighten a
  wire, and never at all if `held`.
- **A box no wire touches** (inside or out) stands after its row-mates that
  have one, unless `held`. Containers then keep their wired boxes to the
  same side and line up.
- Among orders that cross the same, prefer the straighter (judged with real
  box sizes, not positions as fractions of a row — rows of different
  lengths make fractions lie).
- The search must be able to make a move that needs several things to
  change at once — a wire's port on a wall, its place in the row inside, and
  the row outside — where each change alone would cross something.
- Dense diagrams (twenty boxes in four expanded groups, wired freely) are
  where this matters. Targets in §7.

### 5.3 Routing

- Wires run in the channels between ranks and the gutters between
  neighbours on a rank; that is why they cannot pass through boxes.
- Between two ranks a wire that changes lane turns on a track of its own;
  tracks are 16 px apart; a wire runs at least 16 px straight before it
  turns. Tracks are assigned so that wires which need not cross do not.
- A wire between two neighbours on one rank runs straight across the gutter
  between them if their walls face each other; several such wires each get
  their own place on each wall.
- A wire between two boxes of one rank with something between them goes
  round, under the row.
- A wire to a container's **side** wall from a box that is not last in its
  row takes whichever channel — over the row or under it — fewer wires
  already use on that stretch, and steps out into the gutter; it never runs
  along a container's wall.
- An upward wire leaves by the top of its source and enters by the bottom
  of its target; it is routed like any other.
- A wire into a container enters through the wall facing where it comes
  from and continues to the box inside; the pieces drawn by each container
  on its way join without a step.

### 5.4 Ports

- A wall's ports are in the order that keeps their wires from crossing, and
  evenly spread — except that a port slides along its wall to meet a wire
  that could then run straight, never changing places with a neighbour,
  never within 8 px of a corner.
- Two wires from one box into one container leave in the order they arrive
  on that container's wall.
- A wire arriving at a box's side wall comes in level with where it left
  the box on the other side of the gutter, if the wall allows.
- A wall's *only* wire meets it in the middle. If the wire is straight and
  the box has room, the box moves onto the wire; if not, the straight
  stretch of the wire moves onto the box's middle.

### 5.5 Placement along a rank

- **Boxes line up on their centres**; ports then go to meet the wires.
  (Lining a box up on one of two evenly spaced ports sets a chain a third
  of a wall off its own baseline.)
- **A parent stands centred over its children** whatever feeds it from the
  other side — both wires bent rather than one straight and the parent
  hanging over one child. For a box with wires on both sides, the side with
  more pull decides. A box over exactly two wires stands exactly between
  them.
- A stage with a successor and a side lookup stays in line with the
  successor; the lookup hangs beside it. (A dead-end box pulls less.)
- A box holds its lane against a wire merely passing it: the wire goes
  round.
- One of eleven wires leaving a hub cannot be straight anyway and should
  not drag its far end; a wire with both its walls to itself should be dead
  straight if a box can move to make it so without bending another wire or
  costing more wire than it saves.
- **A wire running back against the flow follows and never leads** — it
  must not draw its box out of its row.
- **No gaps nothing is holding open.** Row-mates that begin side by side
  stay side by side; a box tied only to something that is tied only to it
  must not be left stranded wherever it started.
- **One 8-pixel grid for the whole picture**: every box's centre line, in
  every container and across them, stands on it, so two boxes are on one
  line or a clear step apart. A container's size is a whole number of steps
  either side of its centre, and its wall ports stand on the grid, so two
  containers joined by a straight wire round the same way.
- A rank with no wire up or down is centred on its neighbours.
- Two containers joined by several wires stand in a column (middle to
  middle) unless every wire leans the same way. Each wire between two boxes
  pulls on its own — except a bundle's shared stretch, which pulls once.
- `aligned` sets stand where the wires of *all* their members together put
  the shared centre line, and go to the grid as one. (If each simply
  follows the other they agree at once and stay wherever they started.)
- Within a rank, boxes are top-aligned (in a `down` container) when the rank
  holds a container or a box with a `face`; otherwise centred on the rank.

### 5.6 Labels and bundles

- A label sits half-way along its wire: in the gap between two ranks if the
  wire crosses an odd number of gaps, in the row it passes if even. It
  reserves room **only in the container where the wire's two ends part
  company**, not in every container the wire passes through.
- A labelled gap is deeper by the label; a rank gap never shrinks below its
  stated size because some other gap has a label. Spacing is even.
- Several labelled wires between two neighbours on one rank each carry
  their label on their own stub, in columns if they would collide.
- A bundle is one trunk: one port on the shared box, one lane through each
  rank they all pass, one track where they part. Each wire of a bundle
  carries its label on its **own last stub**, not on the trunk.

### 5.7 Containers and titles

- A container is laid out so that it is as small as its inside allows
  (§5.5's grid rule aside), and never narrower than `minW`.
- **A wire that has to turn anyway enters a titled container clear of the
  title** (right of it in a `down` container; below it in a `right` one),
  and a wire turning just inside the wall turns below the title. **A wire
  that runs straight on into the first box inside may pass the end of the
  title** — the renderer draws it behind the title's halo; a jog to avoid
  the title is worse. No later step may push a port back under a title.
- A wire going round the boxes of a titled container takes the side away
  from the title and hugs the row, rather than opening a band under the
  title.
- An arrival lane from outside must never stretch a container: it is only
  followed when it lies within the extent of the container's own boxes.
- A container inside a container of the other direction is nothing special.

### 5.8 Direction

`dir: "right"` is `dir: "down"` with the axes swapped, exactly: the same
problem solved both ways gives transposed pictures. Titles are the one
asymmetry (a title lies along the top wall in both).

## 6. Engineering requirements

- **A design, not a pile.** The earlier engines' recurring failure was a
  stage that worked, then a fix beside it, then a signal passed back from a
  later stage to an earlier one, then a "best of N attempts" to paper over
  the feedback. Decide what depends on what and build it so that each
  decision is made once, with what it needs in view. If something genuinely
  needs iteration (a container's size depends on its inside; where its
  wires arrive depends on its outside), make the iteration explicit, small,
  and bounded, and say why in the code.
- Small modules with one job each; plain functions over plain data; no
  module that only makes sense read alongside three others. A reader
  should be able to hold one file in their head.
- Every rule in §5 should be findable: one place, a comment that states the
  rule as the user would see it, and a test built from a handful of boxes.
- Unit tests for each module on its own, with a few lines of input — no
  view, no model, no font.
- Comments say *why*, in the house style of the repo (look at any file under
  `packages/core/src`): prose, not tags.
- TypeScript strict; `npx tsc --noEmit -p tsconfig.json` in `packages/core`
  must pass (the `spike` directory is already included).
- A `README.md` in the engine's directory: the design, the stages, the
  rules it keeps and where, how to extend it.
- **Extendable**: adding an ordering move, a tidiness rule, or a new kind of
  wire (e.g. a route-side hint) should each be a local change. Say in the
  README where each would go.
- Performance: see §7. No quadratic blow-ups hidden in convenience code on
  the hot path of the ordering search.

## 7. Acceptance

Create these in your engine's directory. The suites in `loom/` are the
model — copy each and point it at your engine (they use a small
`layout.ts` wrapper that passes a solver to `layoutViewGrid`; write your
own). All of them must pass.

| Suite (in `loom/`) | What it holds the engine to |
|---|---|
| `engine.test.ts` — the `describe("solve")` and `describe("ordering the whole picture")` blocks | each tidiness and ordering rule, on a handful of boxes. Port these as they are; they are the behavioural spec. Skip the blocks that unit-test the old engines' internal modules, and write your own unit tests for yours. |
| `language.test.ts` | hints this engine honours and ELK cannot |
| `zones.test.ts` | zones and expanded containers arranged as asked |
| `wrap-containers.test.ts` | `wrap` inside containers |
| `direction-right.test.ts` | every view turned sideways stays legal and reads rightward |
| `trial.test.ts` | 20 hand-written + 80 random diagrams: zero violations |
| `compare.test.ts` | every corpus view: zero violations |
| `score.test.ts` | the verdict against ELK |
| `before-after.test.ts` | the verdict against the earlier spike engines — extend it to print your engine against **both** `grid` and `loom` |

Targets — the `loom` engine's numbers, which the rewrite should match or
beat. Report yours beside them.

| | ELK | `grid` | `loom` |
|---|---|---|---|
| Violations, any set | many | 0 | 0 |
| Score vs ELK, 384 views: better / level / worse | — | 183 / 190 / 11 | 189 / 182 / 13 |
| Total penalty vs ELK | — | −35% | −37% |
| Corpus (259 views): crossings | 73 | 25 | 26 |
| Corpus: bends | 1,174 | 1,041 | 1,057 |
| Corpus: jogs under 16 px | 12 | 1 | 1 |
| Corpus: almost-aligned pairs | 9 | 1 | 2 |
| Trial + random (115 views): crossings | 607 | 580 | 440 |
| Round 2 (35 views): crossings | — | 4 | 1 |
| Random (80 views): crossings | — | 441 | 365 |
| Time, 259 corpus views | 3.5 s | 0.95 s | 0.77 s |
| Time, 80 random views | — | 174 s | 50 s |

A rewrite that is a little behind `loom` on one line and ahead on others is
acceptable if you can say why. One that is illegal anywhere, or slower than
`grid`, is not.

Known hard cases worth looking at by eye (render with the tools the `loom`
directory has — `render-trio.ts`, `dump.ts` — or your own):
`grid/round2/10-nested-zones.squinch` (`side`), `grid/round2/14-tables.squinch`
(`schema`), `grid/trial/17-nested.squinch` (`deep`),
`grid/trial/04-pubsub.squinch` (`flow`), `gauntlet/solutions/35-monorepo.squinch`,
`gauntlet/solutions/20-multicloud-migration.squinch` (`landscape`), and the
random diagrams with seeds 9, 21, 45 (`randomDiagram(n)` in `grid/random.ts`).

## 8. What to hand back

1. The engine, its tests and its README, in its own directory.
2. A report (your final message), honest about what is and is not done:
   - the design in a paragraph, and how it differs from "order and lay out
     each container in turn, then try again";
   - the table in §7 with a column for your engine;
   - before/after against `grid` and `loom`: views better / same / worse per
     set, and the views where yours is furthest behind, with the reason if
     you know it;
   - every requirement in §3–§6 you did **not** meet, and every place you
     found this document wrong, unclear, or contradicting a test;
   - anything you had to read from the excluded files, and why.

Commit as you reach working milestones, on the current branch, with exactly:

```
git -c user.name="JQ" -c user.email="jquatier@gmail.com" -c commit.gpgsign=false commit -m "<message>"
```

No co-author or other trailers; do not push; do not open a pull request.
