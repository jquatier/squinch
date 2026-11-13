# The loom

A layout engine for Squinch diagrams: boxes in ranks, wires in channels.
It replaces neither ELK nor the first spike engine (`../grid`) yet — it is
the second, rebuilt from what the first one taught. `docs/notes/layout-engine-spike.md`
is the history; this is how the thing is put together.

## What it is given, and what it gives back

A `Problem` (`types.ts`): boxes, some of which hold boxes; wires between
them; and for each container a direction, spacing, the ranks the author
pinned, and which boxes the author placed. A `Solution`: a rectangle for
every box and a polyline for every wire. Nothing in the engine knows what a
view, a zone or a card is — `../grid/problem.ts` turns a Squinch view into a
Problem and `../grid/layout.ts` turns the Solution into the `Positioned` the
renderer already draws.

## Three things, each done once, each for the whole picture

```
solve(problem)                                   engine.ts
  grow    index the tree, rank every container   tree.ts, rank.ts
  order   draft every container's slots, and     sheet.ts
          order them all together                order.ts, order-one.ts, sketch.ts
  draw    lay each container out, innermost      lay.ts → ports, gutters, place,
          first; three rounds                              stack, emit
```

**Grow.** Who holds whom; the container where each wire's two ends part
company; each box's rank in its own container (network simplex: least total
wire, the author's pins as given); which boxes no wire touches.

**Order.** A container is a stack of *layers* — its ranks, a layer for
labels where a gap needs one, its two flow walls — and every layer is a row
of *slots*: a box, a wire passing through, a wire's port on the wall. The
order of the slots in every layer of every container is the one decision
that fixes which wires cross, and it is made for all of them together,
before anything has a position.

- The **cost** (`order-one.ts`) is an exact count: measured against finished
  pictures, it is the number of crossings drawn. Far below one crossing's
  worth it also carries how far from straight the wires stand, so that of
  two orders that cross the same the straighter wins.
- A container sees a child's wall by *asking* where each wire's port stands
  on it (`Sheet.wallFraction`), every time. That is what lets the child's
  ports move and the parent's count move with them.
- The **search** (`order.ts`) is small moves over that cost: each container
  settled alone; each again with what its wall costs the container outside
  counted in; each one nobody arranged tried turned about. A trade takes
  what it leads to in the rows either side along with it, so two wires can
  change places down a whole container in one move. A new move is a few
  lines and is judged by the same number as the rest.
- It runs from two **starts** — the order as declared, and the order a
  sketch of the whole picture suggests (`sketch.ts`) — and keeps the one
  that crosses less.

Declaration order is worth a tie: a box leaves its declared place for a
crossing, never for straightness, and never at all if the author placed it
(`rows`, `cols`, `place`, `align`). A box no wire touches stands after its
row-mates that have one.

**Draw.** With the order fixed, each container is laid out innermost first
(a container needs its children's sizes):

| Stage | File | Decides |
|---|---|---|
| ports | `ports.ts` | where on a wall each wire attaches |
| gutters | `gutters.ts`, `channel.ts` | wires between neighbours on one rank |
| place | `place.ts` | a lane for every slot — see below |
| stack | `stack.ts`, `channel.ts` | flow positions; a track per turning wire |
| emit | `emit.ts`, `side.ts` | rectangles and polylines |

It is done three times: a container is laid out before its surroundings, so
only from the second round does it know which lane each wire through its
wall arrives on. Then, once, the whole thing is ordered and drawn again with
what that drawing showed about where wires end up as a tie-break, and
whichever picture crosses less — then turns less — is the answer.

## Placement, in the order it happens

`place.ts` is a sequence of small steps; `tidy.ts` is the last few pixels.

1. **Pull** (`pulls.ts`): each wire draws its two ends toward a straight
   line, harder or softer by what it joins. A wire running back against the
   flow follows and never leads.
2. **Settle**: sweep down and up, each slot taking the weighted median of
   where its wires would run straight — the side with more pull decides, so
   a parent sits over its children whatever feeds it — and each row's
   overlaps resolved exactly (`isotonic.ts`).
3. **Compact** (`compact.ts`): close gaps nothing is holding open.
4. **Align**: boxes the author aligned share a centre line; `cols` are bands
   across the ranks.
5. **Meet**: ports slide along their walls to meet the wires.
6. **Tidy** (`tidy.ts`): straighten a wire that has both its walls to itself;
   snap every box's centre line to the 8-pixel grid; centre a box over
   exactly two wires; remove or open up any jog too short to draw; put a
   wall's only wire on the wall's middle.

## Rules the engine keeps, and where

| Rule | Where |
|---|---|
| A wire never runs through a box that is not its own | by construction: wires live in channels and gutters |
| The author's placement is never undone | `held` in `sheet.ts`, `order-one.ts`, `sketch.ts`; `onAxis` in `tidy.ts` |
| Every box's centre line is on the 8 px grid | `tidy.ts` snap; `rows.ts` settleWall; `stack.ts` sizes |
| A parent is centred over its children | `place.ts` settle; `tidy.ts` centre |
| A wire that turns anyway enters clear of a container's title | `place.ts` clearTitle; `rows.ts` fits |
| Wires of a bundle share a trunk; each label on its own branch | `sheet.ts`, `stack.ts`, `emit.ts` |
| Same input, same output | no clock, no randomness, no environment anywhere |

## Extending it

- **A new ordering move**: a function in `order.ts` (whole picture) or
  `order-one.ts` (one container) that changes slot order and lets the cost
  judge it.
- **A new tidiness rule**: a step in `tidy.ts`, with a test in
  `engine.test.ts` built from a handful of boxes.
- **A new kind of wire** (a side hint, say): a `Link` type in `types.ts`,
  drafted in `sheet.ts`, drawn in `emit.ts`.
- **A new measure of "better"**: `../grid/metrics.ts` and `../grid/score.ts`
  — both engines and ELK are scored by the same function.

## Running it

```
npx vitest run spike/loom/                       # everything
npx vitest run spike/loom/score.test.ts --disable-console-intercept      # against ELK
BEFORE_AFTER=1 npx vitest run spike/loom/before-after.test.ts --disable-console-intercept  # against the first spike engine
npx tsx spike/loom/dump.ts <file.squinch> <view> # one view's geometry, both spike engines
```
