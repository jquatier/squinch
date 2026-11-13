# weft — a layout engine written from the requirements

`solve(problem: Problem): Solution` (`engine.ts`), written cold from
`../REQUIREMENTS.md`, `../contract.ts` and the test suites. It knows nothing
about Squinch: boxes (some holding boxes), wires, and per container a
direction, spacing and what the author pinned go in; a rectangle per box and
an orthogonal polyline per wire come out. No dependency, no `node:` import,
no clock, no randomness.

## The design in one paragraph

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
whole tree); there is no "try again" (no layout is drawn twice, nothing
measured in a drawing is fed back into ordering); and geometry is the last
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
      ├─ ports     ports.ts    where wires meet the walls of leaves
      └─ channels  tracks.ts   what turns between two rows, on which track
```

`frame.ts` is the one place that knows which axis is x: every sheet is
worked in its own frame (`u` along a rank, `v` across the ranks), a rightward
container being a downward one with the axes exchanged. `types.ts` is the
vocabulary. Each file opens with what it decides and why.

| File | Lines | Decides |
|---|---|---|
| `tree.ts` | ~70 | the containers each wire passes; wires that cannot be drawn |
| `rank.ts` | ~170 | ranks of one container: pins exact, the rest least total length |
| `sheet.ts` | ~230 | slots, links, trunks, labels' places, which wall each wire uses |
| `count.ts` | ~230 | how many crossings an order will draw — exactly, and incrementally |
| `order.ts` | ~390 | the order of every row |
| `project.ts` | ~70 | positions on a line under gaps, nearest to what each wants |
| `place.ts` | ~240 | where each slot stands along its row: balance first |
| `ports.ts` | ~100 | ports on a leaf's wall: ordered, even, sliding to meet |
| `gutter.ts` | ~110 | a wire straight across between two neighbours; its label |
| `tracks.ts` | ~110 | track order and spacing in a channel |
| `lay.ts` | ~400 | rows, fit, channel depths, the polylines |
| `engine.ts` | ~80 | the stages in order; sheets onto the page; pieces joined |

## The rules, and where each is kept

Section numbers are REQUIREMENTS'. Each has a comment at the place named and
a test (`engine.test.ts` on whole problems, `modules.test.ts` per module).

**Ranks (§5.1)** — `rank.ts`. Pins are one node with fixed offsets, so a
pinned band cannot split; wires are taken in declaration order and one that
cannot point down runs up instead (`constraints`); network simplex
(`simplex`), checked against brute force.

**Order (§5.2)** — `order.ts`, `count.ts`.
- *The whole picture together*: one `Count` over all sheets; `comb` reads a
  wall's ports from the rank behind it, so inside and outside share the order.
- *Count exactly*: `Count.channel` (two links cross when their ends stand in
  opposite orders; an end at a container stands where its wire meets that
  container's wall) and `Count.along` (same-rank wires, wires to side walls).
  Measured on the 80 random diagrams: model 275 crossings, drawn 279.
- *A passing wire takes a place in the row*: lanes are slots (`sheet.ts`).
- *Declaration order is worth a tie*: `Search.sift` (a box passes a box only
  for fewer crossings) and `Search.restore`.
- *A box no wire touches stands aside*: the row order in `buildSheet`
  (`aside`); `Search.free` keeps it there.
- *Straighter among equals, in real sizes*: `Count.rough`.
- *Several things at once*: `untangle` (lanes follow a trade, through walls),
  `reroute` (a wire's lanes change sides whole), `sift(…, carry)` (a box moves
  with its wires' lanes), `mirror` (a container turned about).
- *What the author placed*: `Search.free` (`held`, `columns`, same-rank
  ends), `Search.sound` (nothing between two boxes a straight wire joins).

**Routing (§5.3)** — `tracks.ts`, `lay.ts`, `sheet.ts`.
- tracks 16 apart, ordered so that wires which need not cross do not, and so
  that no stub lies along another: `tracks.ts` (`above`, `stack`, `pitch`);
- a wire fixed at both ends that would lie along another steps aside
  (`stepAside`) or, failing that, steps twice (`twice`): `lay.ts`;
- same-rank neighbours straight across the gutter: `gutter.ts`; round under
  the row otherwise: `sheet.ts` (`Flat.straight`), drawn in `drawFlat`;
- to a side wall, straight if last in the row, else by the quieter channel:
  `sideWay` in `sheet.ts`;
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
  constraints at the top of `place`;
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

**Containers and titles (§5.7)** — a turning wire's port and lane keep clear
of the title, a straight one may pass: the `titled` bound in `place.ts`; a
track under a title runs below it: channel 0's depth in `lay.ts`.

**Direction (§5.8)** — `frame.ts`; the only other mentions of `dir` are the
title, `face`/`bleed` (which lie along the page, not along the flow) and the
flush ranks of a rightward sheet.

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
- **A new kind of wire** (e.g. a route-side hint, `route … from <side>`): a
  field on `Wire` read in `buildSheet`, where each wire's walls are chosen
  (`pass(…)`); `Side.via` is already the place a wire says how it leaves.
  Drawing it is a case in `lay.ts`'s draw step, and if it turns in a channel
  it is one more `Net`.
- **Another tie-break in track order**: `above` in `tracks.ts`.

## Tests

```
npx vitest run spike/weft/ --disable-console-intercept          # everything (≈1 min)
npx vitest run spike/weft/modules.test.ts spike/weft/rank.test.ts spike/weft/engine.test.ts
BEFORE_AFTER=1 npx vitest run spike/weft/before-after.test.ts --disable-console-intercept   # ≈5 min
npx tsx spike/weft/render.ts <out-dir> <file.squinch#view | random:N | right:…>…           # pictures
```

`engine.test.ts` is `loom/engine.test.ts`'s behavioural blocks, ported; one
test was changed where REQUIREMENTS §4.4 now overrides it (marked in the
file). `before-after.test.ts` also checks what `checkLayout` does not: that
no two wires outside one bundle are drawn along the same line (§3.5).

## What is not done

- **A lane from outside is not followed inside.** A container's north and
  south ports stand where its inside puts them; the outside comes to meet
  them, but the inside is not told where the outside would like a port
  (§5.4 "slides to meet", §5.7 "arrival lane") — except across a gutter
  (`slide`).
- **Crossings inside a gutter are not counted** (two containers side by side
  joined by several wires whose fixed ports are in opposite orders), nor a
  round-the-row wire against another going round the same row.
- **Titles in a rightward container**: the title lies along the west wall
  there and a wire entering through that wall may run under it (the renderer
  draws the title on a halo). Same as the engines before.
- **A wire ending at a container's side wall** takes the free place nearest
  the wall's middle; nothing more considered.
- **A label can be crossed by another wire** (never by a box or a label).
- A wall's only wire can still be a few pixels off the middle where it meets
  a container port that is off the grid (3 cases in the random set).
