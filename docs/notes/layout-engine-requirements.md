# Requirements for the layout engine

> **Status (2026-11): standing requirements.** This began as the brief for a
> ground-up rewrite of the layout engine, handed to an author who was not
> allowed to read the engines that came before. The engine written from it,
> `weft` (`packages/core/src/layout/weft/`), is the product's layout engine.
> The rules and priorities below are what that engine is held to, and what any
> change to it — or any future rewrite — must keep. The code's comments cite
> this file as "REQUIREMENTS §n"; the section numbers are stable.
>
> Why each rule exists, and what was tried instead:
> [`layout-engine.md`](layout-engine.md). The history round by round:
> [`layout-engine-spike.md`](layout-engine-spike.md).

Everything below was learned the hard way, from several hundred diagrams and
a long run of "that one looks wrong — why?". Treat each rule as a
requirement, not a suggestion; where two pull against each other the text
says which wins.

## 0. Where things are

- `packages/core/src/layout/weft/contract.ts` — `Problem`, `Solution` and
  friends. The engine's whole interface.
- `packages/core/src/layout/weft/engine.ts` — `solve(problem): Solution`.
- `packages/core/src/layout/plan.ts` — how a Squinch view becomes a `Problem`
  (zones and frames as containers, hints as `pins` / `held` / `aligned` /
  `columns`, `wrap` folds, bundles, titles, note room, route sides).
- `packages/core/src/layout/layout.ts` — `layoutView`: plan, solve, dress the
  `Solution` as `Positioned`, annotate.
- `packages/core/test/weft/` — the engine's suites, the measures
  (`metrics.ts`), the Problem-level audit of §3 (`legal.ts`), the diagram
  sets (`sets.ts`: the corpus, `trial/`, `round2/`, the seeded random
  generators) and the recorded quality baseline (`quality.baseline.json`).
- `packages/core/test/invariants.ts` — `checkLayout`, the hard rules on a
  `Positioned`.

**If the engine is ever rewritten again, write it cold.** The two rewrites
that improved on what came before (`braid`, then `weft`) were written from
this document, the contract and the tests, by an author who had not read the
previous engine. The one "rebuild" done with the old code open (`loom`)
carried most of the old stages over. Hand a new author this file, the
contract, `plan.ts`, and the test suites as executable requirements — not the
engine.


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
  drawn (one end contains the other, or an end is not in the picture);
  `unhonoured` — ends of wires drawn, but not by the side they asked for,
  each with why;
  `unaligned` — boxes left out of an `aligned` set or pushed off their line
  (two boxes of one rank cannot share a centre line: a set takes one box of
  a rank, the first given).
- Two opt-in extensions, added after the engine was accepted (the contract's
  own comments are the full statement):
  - `Box.room` — clear space outside a wall of a leaf, by screen side, as
    deep as stated and as long as the wall. Nothing enters it but the box's
    own wires on that wall, and the container's walls stay outside it. It is
    not part of the box: the box's rectangle, ports and balanced place are
    its own.
  - `Wire.fromSide` / `toSide` — the wall a wire is asked to leave or enter
    its box by. Only for a wire whose ends are in different ranks or
    containers. A side that is the natural one changes nothing; any other is
    drawn the long way round, at least 16 px straight out of the wall first.
    The side carries outward: the wire crosses the same wall of every
    container around the box, whatever stands in the box's row — it goes
    over or under that. Only the wall facing against the wire's own way is
    carried just while the box has a clear run to it (it is in the first
    rank at every level); otherwise the wire turns beside the box. A wire
    that ends at a container is asked of the container's own wall. Where the
    named box's wall cannot be given the end keeps its natural side and is
    listed in `unhonoured`, with the reason.
- Treat the `Problem` as read-only. `solve` must be a pure function of it.

## 3. Hard rules — a layout that breaks one is wrong

These are checked by `checkLayout` on every `Positioned`, by the
Problem-level audit in `test/weft/legal.ts`, and by the suites in §7.

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
   produce legal output. (The engine this replaced, ELK, refused or
   mis-drew several of these.)
8. The author's statements hold: a pinned rank is that rank; `held` boxes
   keep their relative order in their rank; `aligned` boxes share a centre
   line to the pixel; `columns` do not interleave. Where statements
   contradict each other, rule 1 wins — no boxes overlap — and what gave way
   is listed in `unaligned`.
9. Determinism and purity (§1).

## 4. What "a good layout" means, in priority order

`packages/core/test/weft/metrics.ts` measures each of these; the weights
that once folded them into one penalty per view, for comparing engines, are
in `layout-engine.md` §7.

1. Legal (§3).
2. **Few crossings.** Two wires crossing is the worst legal flaw.
3. **Nothing almost-right.** A jog shorter than 16 px; two boxes of one
   container whose centre lines are 1–7 px apart; a wall's only wire 1–7 px
   off the wall's middle. Each reads as a mistake. Either exact, or clearly
   different.
4. **Balance and symmetry.** A box whose wires fan out to several boxes
   stands over the middle of them (or, for an odd number, straight over the
   middle one). This outranks straightness: **never move a box off its
   balanced place to make a wire straight.** The owner of this project
   looked at an engine that preferred the straight wire and judged its
   pictures worse; a symmetric fan with two bent wires reads better than a
   parent hanging over one child on a dead-straight wire.
5. Few bends and short wire — *after* balance, as a tie-break and through
   ports (which may slide), never through box positions.
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
  Asked to leave the box by that side, it does — to a lane beside the box —
  and takes the channel from there.
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
- A side wall takes any number of wires, as a north or south wall does: the
  wires hooked into it from the row above stand highest, the wires straight
  out of it between, the wires hooked out of it downward lowest, a step
  apart, so that none crosses another.
- A wall's *only* wire meets it in the middle; the wire's own stretch moves
  to the box's middle, not the box to the wire. Several wires on a wall
  stand evenly about its middle.

### 5.5 Placement along a rank

- **Boxes line up on their centres**; ports then go to meet the wires.
  (Lining a box up on one of two evenly spaced ports sets a chain a third
  of a wall off its own baseline.)
- **A parent stands centred over its children** whatever feeds it from the
  other side — both wires bent rather than one straight and the parent
  hanging over one child. For a box with wires on both sides, the side with
  more pull decides. A box over exactly two wires stands exactly between
  them.
- Every wire to a box in the next rank counts equally in that balance,
  whether or not the box at its far end leads anywhere. (An earlier
  version let a dead-end box pull less so a chain stayed straight past a
  side lookup; that is withdrawn — the parent stands between the two.)
- A box holds its lane against a wire merely passing it: the wire goes
  round.
- One of eleven wires leaving a hub cannot be straight anyway and should
  not drag its far end. A single chain (one wire in, one wire out, all the
  way) is a straight line — that *is* its balanced place. Beyond that,
  straightness is never a reason to move a box: when balance leaves a box
  free (ties, slack), take the position with fewer bends; otherwise bend
  the wire.
- **A wire running back against the flow follows and never leads** — it
  must not draw its box out of its row.
- **No gaps nothing is holding open.** Row-mates that begin side by side
  stay side by side; a box tied only to something that is tied only to it
  must not be left stranded wherever it started.
- (Where exact centring and the grid disagree — a parent exactly midway
  between two children whose centres are an odd number of steps apart —
  the children stand one step further apart so both hold.)
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
- A labelled gap is deeper only as far as the label and its tracks do not
  already fit (a test holds a container below a labelled gap to the same
  rectangle as without the label); a rank gap never shrinks below its
  stated size because some other gap has a label. Spacing is even.
- Several labelled wires between two neighbours on one rank each carry
  their label on their own stub, in columns if they would collide.
- A label is crossed by no wire but its own, and stays on the canvas. It
  moves along its own wire to a clear place first; only a label with none is
  given room, by keeping the wires beside its stub half its width away.
  (Added after acceptance. Not yet held between two row-mate containers,
  whose ports are fixed by their insides.)
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
  must pass.
- A `README.md` in the engine's directory: the stages, the rules it keeps
  and where, how to extend it, how to run the tests.
- **Extendable**: adding an ordering move, a tidiness rule, or a new kind of
  wire (e.g. a route-side hint) should each be a local change. Say in the
  README where each would go.
- Performance: see §7. No quadratic blow-ups hidden in convenience code on
  the hot path of the ordering search.

## 7. Acceptance

The suites live in `packages/core/test/weft/`; the engine directory's README
lists them by file and says how to run each. By role, all of them must pass:

| Suite | What it holds the engine to |
|---|---|
| `engine.test.ts` | each tidiness and ordering rule of §5, on a handful of boxes — the behavioural spec |
| `modules.test.ts`, `rank.test.ts` | each module on its own, a few lines of input, no view, model or font |
| `audit.test.ts` | every hard rule of §3 on seeded random Problems, with and without `room` and asked sides; purity |
| `language.test.ts`, `zones.test.ts`, `wrap-containers.test.ts` | hints the language promises: upward edges, kept bands, row-mates inside containers, zones and expanded containers arranged as asked, `wrap` inside containers — and the diagnostics that remain |
| `direction-right.test.ts` | a rightward diagram reads rightward, and arrangements stated under a rightward flow are honoured |
| `sets.test.ts` | corpus, trial, round 2 and random, as written and turned on their side: zero broken rules, every edge drawn, no two wires outside one bundle along one line; and no total worse than `quality.baseline.json` |

Where a test contradicts §4 or §5.5 as written, this document wins: change
the test and say so in the commit.

What the engines scored when each was last measured, for whoever writes the
next one. `grid`, `loom` and `braid` were the three before `weft` and are
deleted (git history, under `packages/core/spike/`).

| | ELK | `grid` | `loom` | `braid` | `weft` |
|---|---|---|---|---|---|
| Violations, any set | many | 0 | 0 | 0 | 0 |
| Score vs ELK, 384 views: better / level / worse | — | 183 / 190 / 11 | 189 / 182 / 13 | 233 / 145 / 6 | 238 / 143 / 3 |
| Total penalty vs ELK | — | −35% | −37% | −46% | −49% |
| Corpus (259 views): crossings | 73 | 25 | 26 | 25 | 22 |
| Corpus: bends | 1,174 | 1,041 | 1,057 | 701 | 707 |
| Corpus: jogs under 16 px | 12 | 1 | 1 | 5 | 1 |
| Corpus: almost-aligned pairs | 9 | 1 | 2 | 0 | 0 |
| Corpus: lopsided boxes | — | 134 | 130 | 145 | 104 |
| Trial + random (115 views): crossings | 607 | 523 | 440 | 361 | 345 |
| Round 2 (35 views): crossings | — | 4 | 1 | 1 | 2 |
| Random (80 views): crossings | — | 441 | 365 | 288 | 281 |
| Random: lopsided boxes | — | 616 | 626 | 589 | 580 |
| Random: jogs under 16 px | — | 41 | 32 | 59 | 10 |
| Time, 80 random views | — | 180 s | 51 s | 1.9 s | 1.4 s |

(After a fix made once weft was accepted its corpus stands at 705 bends and
no jog under 16 px.) Timings are one machine's and only compare within a
column's own era; ELK against weft on the 259 corpus views, warmed up, was
2.5 s against 0.25 s.

**The target for any successor is the best of all columns, balance first**:
lopsided boxes and small jogs at `weft`'s level or better, then crossings,
then bends. `braid` is the cautionary column — best on bends when it was
written, and rejected, because it bought them with balance. One that is
illegal anywhere is not a candidate.

Known hard cases worth looking at by eye:
`packages/core/test/weft/round2/10-nested-zones.squinch` (`side`),
`round2/14-tables.squinch` (`schema`), `trial/17-nested.squinch` (`deep`),
`trial/04-pubsub.squinch` (`flow`), `gauntlet/solutions/35-monorepo.squinch`,
`gauntlet/solutions/20-multicloud-migration.squinch` (`landscape`),
`lookbook/cases/26-route-label.squinch`, and the random diagrams with seeds
9, 21 and 45.
