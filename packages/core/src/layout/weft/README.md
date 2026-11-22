# weft — the layout engine

`solve(problem: Problem): Solution` (`engine.ts`). It knows nothing about
Squinch: boxes (some holding boxes), wires, and per container a direction,
spacing and what the author pinned go in; a rectangle per box and an
orthogonal polyline per wire come out. No dependency, no `node:` import, no
clock, no randomness.

This file is the code-side map: the modules, where each rule is kept, how to
extend the engine and how to run its tests. It does not argue for anything.

- Why the engine exists, every decision with its evidence, what was rejected,
  how quality is judged, the known weak spots:
  `docs/notes/layout-engine.md`.
- The rules themselves: `docs/notes/layout-engine-requirements.md`. Comments
  in this directory cite it as "REQUIREMENTS §n".

The Squinch side is one directory up and is not part of the engine: `plan.ts`
(a view → a `Problem`, and the diagnostics), `layout.ts` (`layoutView`: plan,
solve, dress the `Solution` as the `Positioned` the renderer draws, annotate),
`annotate.ts` and `notes.ts` (badges, chips, notes), `sizes.ts`. The suites,
the yardsticks and the diagram sets are in `packages/core/test/weft/`.

## The design in one paragraph

(The longer account, stage by stage with the reasons, is §4 of the note.)

Every container gets a **sheet**: its ranks, the slots in them (boxes, a
*lane* for each wire passing a rank, a *port* for each wire crossing the north
or south wall), and for every wire that touches the container, how it is
drawn there. All sheets are built once, outermost first, and what makes that
possible is that nothing in a sheet waits on a position — ranks are final,
and which wall of a container a wire uses is settled by ranks and by the
declared order of same-rank ends. So the set of slots never changes, and the
**order of every row of every sheet is then searched as one state against
one exact count of crossings**; a container's wall is not ordered by anyone —
its ports are read off the rank behind it, and the same order is counted on
both sides. Only then is anything given a coordinate: each sheet is laid out
once, innermost first (a container's size is its inside's), by placing boxes
on their **balanced** places, sliding ports to meet the wires, and stacking
what turns onto tracks.

That differs from "order and lay out each container in turn, then try again"
in three ways: there is no "in turn" for ordering (one state, one cost, the
whole tree); there is no "try again" (nothing measured in a drawing is fed
back into ordering, and the one time sheets are laid out again — to give a
crowded label room, see Iteration — the order stands); and geometry is the last
thing decided, not a thing the ordering has to guess.

## Stages

```
solve
 ├─ grow     tree.ts     the tree of containers; each wire cut where its ends part
 ├─ weave    sheet.ts    a sheet per container: ranks (rank.ts), slots, links, walls
 ├─ order    order.ts    the order of every row, together       cost: count.ts
 └─ lay      lay.ts      one sheet's geometry, innermost first
      ├─ gutters   gutter.ts   wires between row-mates, and the room they need
      ├─ place     place.ts    every slot along its row         solver: project.ts
      ├─ ports     ports.ts    where wires meet the north and south walls of leaves
      │            sides.ts    …and their east and west walls
      └─ channels  tracks.ts   what turns between two rows, on which track
```

`frame.ts` is the one place that knows which axis is x: every sheet is
worked in its own frame (`u` along a rank, `v` across the ranks), a rightward
container being a downward one with the axes exchanged. `types.ts` is the
vocabulary. Each file opens with what it decides and why.

| File | Lines | Decides |
|---|---|---|
| `tree.ts` | ~70 | the containers each wire passes; wires that cannot be drawn |
| `rank.ts` | ~160 | ranks of one container: pins exact, the rest least total length |
| `sheet.ts` | ~450 | slots, links, trunks, labels' places, which wall each wire uses |
| `count.ts` | ~260 | how many crossings an order will draw — exactly, and incrementally |
| `order.ts` | ~560 | the order of every row |
| `project.ts` | ~70 | positions on a line under gaps, nearest to what each wants |
| `place.ts` | ~250 | where each slot stands along its row: balance first |
| `ports.ts` | ~90 | ports on a leaf's wall: ordered, even, sliding to meet |
| `sides.ts` | ~100 | ports on a leaf's side wall: hooks and straight wires in one order |
| `gutter.ts` | ~130 | a wire straight across between two neighbours; its label |
| `tracks.ts` | ~125 | track order and spacing in a channel |
| `lay.ts` | ~660 | rows, fit, channel depths, the polylines |
| `engine.ts` | ~120 | the stages in order; sheets onto the page; pieces joined |

## The rules, and where each is kept

Section numbers are REQUIREMENTS'. Each has a comment at the place named and
a test (on whole small Problems, or per module — see Tests).

**Ranks (§5.1)** — `rank.ts`. Pins are one node with fixed offsets, so a
pinned band cannot split; wires are taken in declaration order and one that
cannot point down runs up instead (`constraints`); network simplex
(`simplex`), checked against brute force.

**Order (§5.2)** — `order.ts`, `count.ts`.
- *The whole picture together*: one `Count` over all sheets; `comb` reads a
  wall's ports from the rank behind it, so inside and outside share the order.
- *Count exactly*: `Count.channel` (two links cross when their ends stand in
  opposite orders; an end at a container stands where its wire meets that
  container's wall) and `Count.along` (same-rank wires, wires to side walls,
  a hook's stretch from its wall to its lane — against every lane between
  the two, another hook of the same box included unless it leaves by the
  same wall, where the two nest).
  Crossings in gutters and between round-the-row wires are left out.
- *A passing wire takes a place in the row*: lanes are slots (`sheet.ts`).
- *Declaration order is worth a tie*: `Search.sift` (a box passes a box only
  for fewer crossings) and `Search.restore`.
- *A box no wire touches stands aside*: the row order in `buildSheet`
  (`aside`); `Search.free` keeps it there.
- *Straighter among equals, in real sizes*: `Count.rough`.
- *Several things at once*: `untangle` (lanes follow a trade, through walls),
  `reroute` (a wire's lanes change sides whole), `sift(…, carry)` (a box moves
  with its wires' lanes), `mirror` (a container turned about), `flip` (a hook
  out of a north or south wall, round the other side of its box).
- *What the author placed*: `Search.free` (`held`, `columns`, same-rank
  ends), `Search.sound` (nothing between two boxes a straight wire joins).

**Routing (§5.3)** — `tracks.ts`, `lay.ts`, `sheet.ts`.
- tracks 16 apart, ordered so that wires which need not cross do not, and so
  that no stub lies along another: `tracks.ts` (`above`, `stack`, `pitch`);
- a wire fixed at both ends that would lie along another steps aside
  (`stepAside`) or, failing that, steps twice (`twice`): `lay.ts`; and where
  neither can, the channel is stacked once more for any order that keeps
  every stub off every other (`stack(…, true)`);
- same-rank neighbours straight across the gutter: `gutter.ts`; round under
  the row otherwise: `sheet.ts` (`Flat.straight`), drawn in `drawFlat`;
- to a side wall, straight if last in the row, else by the quieter channel:
  `sideWay` in `sheet.ts` — from the box's north or south wall, or, asked for
  the side wall, from a lane beside the box (`Side.hook`);
- upward wires: a link marked `back`, drawn top-down and reversed.

**Ports (§5.4)** — `ports.ts` (`settle`, `meetAcross`): order by far end,
even about the middle, slide to meet, the only wire in the middle. Level
across a gutter: `gutter.ts`, and `slide` in `lay.ts` for two containers.

**Placement (§5.5)** — `place.ts`.
- balance outranks straightness: the weights `HEAVY`/`LIGHT`/`THIN` and `aim`;
- a parent over the middle of its children, the busier side deciding: `aim`,
  `middle`;
- children packed and centred under what feeds them, one grid step wider
  when their parent would otherwise fall between grid lines: `among`;
- a chain is a straight line, and hangs from the end that has a balanced
  place of its own: `aim` (`firm`);
- a wire running back follows and never leads; so does a wire to the
  sheet's own wall: `forward` in `aim`;
- no gaps nothing holds open: a slot nothing pulls sticks to its neighbour
  (`IDLE`, `FAR`), and the picture comes back to the west wall (`spare`);
- two containers joined by several wires stand in a column: `aim` (`column`);
- `aligned` as one variable, `columns` as lines between bands: the
  constraints at the top of `place`. A set takes **one box of a rank** — two
  boxes of one rank stand side by side and cannot share a centre line — the
  first as given; the rest are left out and placed like any box
  (`sheet.rep`, built at the end of `buildSheet`). And where the statements
  cannot all hold (a set against `columns`, against a held row, against
  another set) every row is pushed apart to its gaps after the solve, so no
  two boxes overlap whatever was asked (the last block of `place`). Both
  kinds of member that are off their line are reported in
  `Solution.unaligned`;
- the 8-pixel grid: every gap a multiple of it, positions rounded once
  (`snap`); a container's width a whole number of steps (`fit` in `lay.ts`);
- top-aligned ranks: `rows` in `lay.ts`.

**Nothing almost-right (§4.3)** — a jog under 16 px is closed where it would
arise: between rigid ends in `place.ts` (last block), at a leaf's port, a lane
or a wall port in `lay.ts` (after `meetAcross`), between two containers by
`slide`.

**Labels and bundles (§5.6)** — where a label goes is decided in
`buildSheet` (middle gap, middle rank's lane, a trunk's own stub); the bands
of a channel and their depth in `lay.ts` (`band`, depths); gutter labels in
`gutter.ts`. A bundle is a `trunk` in `buildSheet`: one port key, shared
lanes, links with one `net` — which `tracks.ts` gives one track.

**A label is crossed by nothing but its own wire (§5.6)** — in two steps,
the cheap one first.
- *The label moves along its own wire* to the nearest place no other wire,
  box, room or label is in: `clearLabels` at the end of `lay.ts`. It costs
  the picture nothing — no box or wire moves — and a label that is clear
  where it stands is not touched.
- *A label with no clear place is given room*, and only such a label
  (`giveRoom` in `sheet.ts`, asked for by `engine.ts` once the sheets are
  drawn): the wires either side of the stub it stands on keep half its
  width away. Where that room is kept: between the ports of a leaf's wall
  (`settleWide` in `ports.ts`, `End.room`); beside a lane or a container's
  port (`Slot.room`, in `sep` of `place.ts`); on through a container's wall,
  port after port, to the leaf inside (`claim`, `Link.room`) — or, in a
  container of the other direction, between the levels its box's wires
  leave at (`Side.room`); beside a leaf, for a lane passing it
  (`Slot.stub`). The stub that carries the label is the one at the less
  crowded wall. Nothing that closes a short jog afterwards may step into
  that room (`move`, `stepAside` in `lay.ts`); a lane stepping aside
  (`shift`) keeps out of it once a label given room was found crossed all
  the same (`Sheet.firm`).
- Wires between two row-mates stand a label's depth apart where the label
  lies across them — a rightward sheet (`gutter.ts`, `pitch`).

**Containers and titles (§5.7)** — a turning wire's port and lane keep clear
of the title, a straight one may pass: the `titled` bound in `place.ts`; a
track under a title runs below it: channel 0's depth in `lay.ts`.

**Direction (§5.8)** — `frame.ts`; the only other mentions of `dir` are the
title, `face`/`bleed` (which lie along the page, not along the flow) and the
flush ranks of a rightward sheet.

**Room beside a box (`Box.room`)** — clear space outside a wall of a leaf,
by screen side, that nothing enters but the box's own wires on that wall.
- turned into the sheet's frame, and folded with `bleed` (the deeper holds):
  the kid in `buildSheet` (`sheet.ts`, `Kid.room` in `types.ts`);
- beside the box, along its rank: one more term in the gap between two
  neighbours and before the west wall — `sep`, `low` and the `columns` lines
  in `place.ts` (`Placing.bleed` after a slot, `Placing.lead` before it); the
  east wall goes round it in `fit` (`lay.ts`);
- above or below the box, across the ranks: part of the rank's depth — the
  rows step of `lay.ts`. The channels start outside it, so no track, lane or
  label can be in it, and the box's own wire crosses it as a longer stub;
- what a gutter holds (a step, a label) stands past the room: `drawFlat`;
- never part of the box: `place.ts` works on centres and widths, which the
  room does not touch, so a box with room is balanced exactly as without.

**Sides a wire is asked to use (`Wire.fromSide`, `toSide`)** — a `Hook`
(`types.ts`).
- decided in `buildSheet` (`hookFor`): an end asked for a wall other than
  the one facing where the wire goes gets a lane right beside the box, in
  its own rank, and the wire's path starts (ends) at that lane instead of
  at the box. So to the ordering stage the detour is what it is — a wire
  passing the box — and it is counted like one;
- which side of the box the lane stands on: the wall asked, for an east or
  west one. For a north or south one either will do (`beside.free`): it
  starts on a side nothing runs straight out of and the ordering stage
  chooses — `Search.flip`, kept for fewer crossings or, at a tie, a straighter
  picture, so the wire goes round the side nearer where it is going. Where it
  stands is not kept anywhere but in the row: `hookAfter` (sheet.ts) reads it
  off the order, for `place.ts`, `lay.ts` and the search alike. The hook's
  own stretch is counted (`Count.along`);
- a hook round a container, out of its north or south wall: the wire's port
  on that wall stands, among the wires of one box inside, at the end of the
  wall the lane is beside (`Search.hooking`, read in `comb`; combed again
  when the lane changes sides, `rehook`) — as a leaf's port does;
- the lane stays beside its box: `Search.beside` / `sound` (its side, no box
  and no other box's hook lane between), `trade` (a box that moves takes its
  hooks' lanes along), the seed, and `aim` in `place.ts` (close beside it);
- drawn in `lay.ts` (`hookOf`): from a side wall, straight across to the
  lane; from the north or south wall, out, along a track of the channel
  there (a net of its own, `hook:…`) and down (up) to the lane. Its port on
  a north or south wall is placed with the wall's others, at the end
  nearest the lane;
- a wire to the sheet's own side wall, from a leaf: north and south are
  `Side.via` over and under. Asked for the side wall itself, the wire runs
  straight out where the box is last in its row (kept so by `sheet.last`);
  with row-mates between (`beyond`), it leaves by that wall to a lane beside
  the box and goes over or under the row from there (`Side.hook`, drawn in
  `drawSide`);
- **a side wall takes any number of wires** (`sides.ts`): the hooks whose
  lane comes down to the wall (`beside.tail`) stand highest, the nearest lane
  first; the wires straight out — flats across the gutter, wires on to the
  sheet's wall — between; the hooks whose lane goes on down lowest, the
  nearest lane last. In that order none crosses another, which is why
  `Count.along` does not count a box's own hook lane against the wires
  straight out of the same wall (`own`). The straight wires are placed first
  with the hooks' room kept free (`reserve`, read by `gutters` as `keep` and
  by the `level` step of `lay.ts`), then `stand` places the hooks about them
  (`hookV`). A wire that steps in a gutter steps beyond the lanes of that
  wall's hooks (`Crossing.after`, `before`), and `slide` leaves a wall with
  hooks alone;
- **through a container's wall**: the side asked of a box carries on through
  the same wall of every container around it (`asked` always answers). The
  one wall held back is the north or south one that faces against the wire's
  own way: it is carried only while the box is in the first (last) rank at
  every level on the way in (`clear`, read off `rankings`: ranks and declared
  order, so it is known before the sheet inside is built), and otherwise the
  box takes its hook inside and the container keeps its natural wall. The
  container takes a hook like a leaf (`hookFor`), and the wire, already
  handed to the sheet inside by its natural wall to keep its place among that
  sheet's wires, is turned to the wall given (`Ask.thru`, set in `hookFor`;
  `Thru.wall` is final once the sheet outside is built); inside, it is a
  wire to a side wall, as between row-mates. Its place on the container's
  side wall is the inside's (`fixedPort` in `hookOf`), and the inside orders
  that wall as `sides.ts` orders a leaf's, reading off the sheet outside
  which wires are hooked round the container and which way (`comesAt` in
  `lay.ts`) — so wires hooked into one side wall of a container do not cross
  between the wall and their lanes. A wire that ends at the container is
  asked of the container's wall (`named`, the one test of "the box the wire
  names", read by every place that reports). Several wires that end at one
  side wall of a container take their places there in the order they come to
  it outside (`comesAt` again);
- not given, and reported in `Solution.unhonoured` with the reason and what
  a caller needs to say it in screen sides (`Refusal`: the row-mate, the wall
  the wire leaves by, the sides that would be given) — only for the box the
  wire names, and only where the picture bears it out: `engine.ts` drops a
  refusal whose end was drawn by the wall asked after all (a box the ordering
  stage put last in its row). The reasons are three: a wire of a bundle
  (`trunk`); the far wall of a box whose wire leaves its container sideways,
  toward a row-mate of the container (`far`); a box standing in one rank with
  the container the other end is in (`row`). A wall that already carries
  wires is never a reason. Between two row-mates of one container the side
  is ignored without report (the caller can see that), and a container the
  wire only passes through keeps its natural wall without report.

## Iteration, where there is any

- `order.ts`: the search is a descent; it runs from the declared order and,
  **only if crossings remain**, once more from a second start (rows sorted by
  where their wires come from), keeping the second only if it crosses less.
  This is a search restarting, not a later stage correcting an earlier one.
- `place.ts`: rows are solved one at a time, down and up, `SWEEPS` (4) times.
  Each row solve is exact; the sweeps are how a row hears from its
  neighbours.
- `lay.ts`: a port may step aside (at most 12 tries per channel) and a wire
  step twice (at most 6) to keep stubs off each other.
- The one message from outside to inside: `slide` in `lay.ts`, which moves a
  finished container's side port to come level with a wire.
- `engine.ts`: the sheets are laid out again (not ordered again) when a
  label was found with no clear place along its wire and has been given
  room — or was given room and is crossed all the same, because a lane
  stepped into it to close a jog, and its sheet now holds rooms firm
  (`Sheet.firm`, read by `shift` in `lay.ts`) — at most `ROOMS` (2) more
  times. Whether a label has a clear place
  is only known once the wires are drawn; a picture whose labels are all
  clear is laid out once.

## How to extend it

- **An ordering move**: a method on `Search` (`order.ts`) that changes rows
  through `swap`/`set` and compares `count.cross`/`count.rough` before and
  after; call it from `descend`. The count needs no change.
- **A new term in the count** (e.g. crossings inside a gutter): a new kind of
  `Unit` or a line in `Count.along`; `touch` already says what a row change
  dirties.
- **A tidiness rule about where boxes stand**: a branch in `aim`
  (`place.ts`) — a want and a weight. About ports: `ports.ts`. About jogs:
  beside the existing ones (see "Nothing almost-right").
- **A new kind of wire**: a field on `Wire` read in `buildSheet`, where each
  wire's walls are chosen (`pass(…)`); `Side.via` is already the place a wire
  says how it leaves. Drawing it is a case in `lay.ts`'s draw step, and if it
  turns in a channel it is one more `Net`. The route-side hint (`hookFor`) is
  the worked example.
- **A new field on the contract**: opt-in, absent by default, and a rule for
  it in the Problem-level audit (`test/weft/legal.ts`) and its random
  generator before the engine honours it. `Box.room` and the wire sides were
  added this way.
- **Another tie-break in track order**: `above` in `tracks.ts`.

## Tests

From `packages/core`. The suites are in `test/weft/`.

```
npx vitest run test/weft/                                             # everything
npx vitest run test/weft/modules.test.ts test/weft/rank.test.ts test/weft/engine.test.ts   # seconds
npx vitest run test/weft/audit.test.ts                                # random Problems, every hard rule
npx vitest run test/weft/sets.test.ts --disable-console-intercept     # every set, both directions; prints the totals
RANDOM=400 npx vitest run test/weft/sets.test.ts                      # more random diagrams (legality only)
UPDATE_QUALITY=1 npx vitest run test/weft/sets.test.ts                # re-record quality.baseline.json
```

| File | Holds the engine to |
|---|---|
| `modules.test.ts`, `rank.test.ts` | each module on its own, a few lines of input; ranks against brute force |
| `engine.test.ts` | each rule of REQUIREMENTS §5 on a whole Problem of a handful of boxes |
| `audit.test.ts` (`legal.ts`, `random-problem.ts`) | every hard rule on seeded random Problems, with `room` and asked sides; purity; a side asked is given or reported, per end, on Problems nested two deep with wires that end at containers (`nestedProblem`); the seeds that need a label's room held firm |
| `language.test.ts` | hints that used to be errors or warnings and now draw; the diagnostics that remain |
| `zones.test.ts`, `wrap-containers.test.ts`, `direction-right.test.ts` (`asks.ts`) | zones and containers arranged as asked; folds; rightward flow |
| `sets.test.ts` (`sets.ts`, `metrics.ts`, `random.ts`, `trial/`, `round2/`) | every view of the corpus, trial, round-2 and random sets, as written and turned right: no broken rule, and no total worse than `quality.baseline.json` |

Before changing behaviour read `docs/notes/layout-engine.md` §9 ("How to
change the engine safely"): the order to run these in, and how to look at the
pictures a change moved.

## What is not done

The list, with what each costs and what to try next, is §8 of
`docs/notes/layout-engine.md`. The ones a reader of this code will trip over:

- `order.ts`: one descent from the declared order and one restart; no wider
  search. Dense diagrams can stop at a local minimum.
- `count.ts`: crossings inside a gutter, and between two round-the-row wires,
  are not counted.
- `place.ts`: a hook does not pull its box.
- `order.ts`: a box cannot be sifted past its own hook's lane, so a hook out
  of an east or west wall holds its box on that side of the lane. Many hooks
  beside one box are slow to order: each is a slot of that row, and the cost
  grows steeply with their number (80 sided wires out of one container about
  a quarter of a second, 120 about a second).
- `sides.ts`: a side wall shorter than its wires holds them closer than a
  step, and where a straight wire is fixed at the very end of the wall (a
  container's port across the gutter) a hook that belongs beyond it takes the
  nearest free place and crosses it.
- `sheet.ts`: a side asked against the wire's own way (north, going down) is
  carried through a container's wall only from the first rank; from deeper
  the wire turns beside its box. Carried always it looped round every
  container on the way (docs/notes/layout-engine.md §8).
- A side is not carried through a container's wall toward a row-mate: where
  the wire's other end stands in the container's own rank, the wire leaves
  the container toward it (§ same-rank wires), whatever the box was asked.
- Past one level of nesting (`nestedProblem` in the audit), a label can lie
  under another wire (about one Problem in ninety) and two wires that each
  step twice in one channel can be drawn along one line (four in 3,000) —
  with or without sides asked.
- `lay.ts`: a container's north and south ports stand where its inside puts
  them; only `slide` (across a gutter) moves a finished container's port to
  meet a wire.
- A label can still be crossed by another wire where room cannot be given:
  two wires between row-mates that are both containers (their ports are
  fixed by their insides — 3 labels in the trial set turned rightward), and
  about one random Problem in five hundred.
- In a rightward container the title lies along the wall wires enter by; a
  wire may run under it and the renderer draws the title on a halo.
