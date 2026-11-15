# Note — the layout engine (`weft`)

Engineering note. Open this first the next time layout is revisited. It says
why Squinch has a layout engine of its own, how that engine works and why each
part is the way it is, what was tried and rejected, how its quality is measured
and gated, where it is still weak, and how to change it without breaking it.

Companions, each with one job:

- [`layout-engine-requirements.md`](layout-engine-requirements.md) — the
  standing requirements: the hard rules, the priority order, every placement
  and routing rule. The code's comments cite it by section ("REQUIREMENTS
  §5.2").
- [`layout-engine-spike.md`](layout-engine-spike.md) — the history, round by
  round, with the numbers each round produced.
- `packages/core/src/layout/weft/README.md` — the code-side map: modules,
  where each rule is kept, how to run the tests.

Where this note and the code disagree, the code is right and this note needs
fixing.

## 1. Why there is an engine

Until 2026-11 layout was ELK (`elkjs`, layered algorithm) plus routers of our
own, all in one 3,200-line `layout.ts`. The swap is commit `c95ab03`; the old
file is `git show c95ab03~1:packages/core/src/layout/layout.ts`. ELK was
replaced for four reasons, each of which had cost real bugs.

**A rank could not hold two connected nodes.** ELK's layered algorithm is
Sugiyama layering, where a layer is by definition a set of nodes with no edges
between them. `rows [a b]` with `a -> b` is the most ordinary thing an author
writes, so every same-rank edge was hidden from ELK and drawn afterwards by a
second, hand-written router (the "coplanar router"); declared ranks were
pushed onto ELK with invisible "scaffold" edges, which are lower bounds only.
Four attempts to hand the job back to ELK were measured and all failed
(partitioning, the interactive layerer, a synthetic rightward compound,
deleting the router). `wrap` needed a third router (the "bus router") and
`channel`/`align` were passes that moved things after ELK had finished.

**Two routers had seams.** Each placed wires, ports and labels without seeing
the other. The bugs this produced, all shipped at some point: a label parked
on a crossing (ELK put a cross-rank edge's label at its median layer, which is
the layer of any same-rank wire that edge threads the gutter of); a same-rank
wire into a container stopping at the container's wall instead of the leaf it
names, unless a corridor could be proven empty; a `rows` band ELK split into
two tiers, leaving wires ending in empty canvas; ports stacked on one point;
hints that could not reach inside a zone, because a zone was one block to ELK
and its inside was ELK's alone.

**Language features were errors only because ELK could not draw them.** An
edge running upward between declared rows was a "hint conflict" error. A band
with an unlisted node on a path between its members was an error. Two
row-mates inside an expanded container with an edge between them was a
warning. Rank hints between members of one zone were a warning. `wrap` folded
exactly two shapes (one chain, one fan-out) and warned on everything else.
Each was a first-`check` failure for a cold agent, and first-check passes are
the product's acceptance number.

**It was slow and heavy.** ELK took about 95% of layout time and was a 1.6 MB
dependency. Layout of the 259 corpus views, warmed up: 2.5 s under ELK, 0.25 s
under weft (median view 8.0 ms against 0.8 ms; weft slower on none).

What ELK still decided by the end was narrow — ranks were ours, root order was
forced to declaration order, same-rank wires were ours — so the cost of owning
the rest was smaller than it looked.

## 2. The shape of the layout code

`layoutView(model, view, font?)` in `packages/core/src/layout/layout.ts` runs
four steps. It still returns a Promise because every host awaits it; the work
is synchronous.

| Step | File | What it does |
|---|---|---|
| plan | `plan.ts` | A view → an engine `Problem`, plus the diagnostics. The only file that knows both vocabularies. |
| solve | `weft/` | `solve(problem): Solution`. Knows nothing about Squinch. |
| dress | `layout.ts` | The `Solution` as `Positioned`: nodes, frames, zones, wires, ports. Also the diagnostics that need the result (an `align` that could not be given, a `route` side that could not be used, a wire not drawn). |
| annotate | `annotate.ts`, `notes.ts` | Flow badges, zone chips, crossed frame titles, notes. Engine-independent. |

`sizes.ts` is the one source for how big a leaf, pill or note is;
`positioned.ts` is the type the renderer and the invariant sweep consume.

**The plan.** The picture is a tree of containers: root ⊃ zones ⊃ expanded
frames ⊃ leaves. One rule covers every container: project the hints
(`rows`/`cols`/`place`, `align`, `wrap`, `direction`) onto that container's
*direct* children and hand the engine the result. A hint path that names
something deeper is read as the direct child that holds it; a hint may name a
zone by its id. That single rule is why hints reach inside zones and frames —
under ELK each kind of container had its own mechanism and a zone's inside had
none. The plan also decides sizes, the room a note needs, which wires are a
bundle (`channel`, and the trunks a `wrap` fold makes), and which walls a
`route … from/to` asks for. It contains no geometry.

**The contract** (`weft/contract.ts`). A `Group` is a container's inside:
`dir` (`down` or `right`), `pad`, `gap.lane`/`gap.rank`, `boxes` in declared
order, and what the author stated — `pins` (box → rank), `held` (boxes whose
order in their rank is fixed), `aligned` (sets sharing one centre line),
`columns` (bands across the ranks that never interleave). A `Box` is a leaf
with a size or a container with a `group`; it may have a `face` (how much of
its side walls a wire may land on — a table's head), a `bleed` (something
drawn below it that nothing may overlap — a card's stacked sheets), a `title`
(the corner a container's title occupies), a `minW`, and `room`. A `Wire`
joins two boxes anywhere in the tree and may carry a `label` size, a `bundle`
id, and `fromSide`/`toSide`. The `Solution` is integer rectangles, each box's
rank, an orthogonal polyline per wire with its label rectangle, `skipped`
(wires not drawn because one end contains the other) and `unhonoured` (wires
drawn, but not by the side they asked for).

Two fields were added after acceptance, for product parity, and are opt-in:

- **`Box.room`** — clear space outside a wall of a leaf, for a note anchored
  beside it. Nothing enters it but the box's own wires on that wall. It is not
  part of the box: the box's rectangle, ports and balanced place are computed
  as if the room were not there.
- **`Wire.fromSide`/`toSide`** — a *hook*. An end asked for a wall other than
  the one facing where the wire is going gets a lane right beside its box, in
  the box's own rank, and the wire's path starts at that lane. So the ordering
  stage sees the detour for what it is — a wire passing the box — and counts
  it. A side that cannot be used is reported in `Solution.unhonoured`, never
  dropped in silence.

## 3. The hard rules and the priority order

Full text: requirements §3 and §4. In short, a layout that breaks any of these
is wrong, and they are checked mechanically (§7 below):

1. Boxes of one container do not overlap; a box stays in its container.
2. A wire never passes through a box that is not one of its ends or a
   container holding one of them.
3. Wires are orthogonal, integer, with no repeated or collinear points.
4. A wire meets a wall at least 8 px from a corner; two ports on a wall keep
   16 px apart where the wall has room.
5. Two wires are never drawn along the same line, except a bundle's trunk.
6. A label sits on its own wire and overlaps no box and no other label.
7. Every wire that can be drawn is drawn: upward, same-rank, across
   containers at any depth.
8. What the author stated holds: a pinned rank, `held` order, `aligned`
   centre lines to the pixel, `columns`.
9. Deterministic and pure: no clock, no randomness, no `node:` import.

Among legal layouts, better means, in this order:

1. **Fewer crossings.**
2. **Nothing almost-right** — no jog under 16 px, no two boxes 1–7 px out of
   line, no lone wire 1–7 px off a wall's middle. Exact, or clearly different.
3. **Balance and symmetry.** A box whose wires fan out stands over the middle
   of them. *A box is never moved off its balanced place to straighten a
   wire.*
4. Fewer bends and shorter wire — as a tie-break and through ports, which may
   slide; never through box positions.
5. Canvas size is not a goal.

Item 3 above item 4 is the decision the whole engine turns on. It was made by
the project's owner looking at pictures, not by a number (§5, "balance
first"). Do not reverse it on the strength of a bend count.

## 4. How weft works

`solve` runs four stages, each once, each for the whole picture. Nothing later
sends anything back to an earlier stage.

```
grow     tree.ts     the tree of containers; each wire cut where its ends part
weave    sheet.ts    a sheet per container: ranks, slots, which wall each wire uses
order    order.ts    the order of every row of every sheet, together   (cost: count.ts)
lay      lay.ts      one sheet's geometry at a time, innermost first
           gutter.ts   wires between row-mates, and the room they need
           place.ts    every slot along its row                 (solver: project.ts)
           ports.ts    where wires meet the walls of leaves
           tracks.ts   what turns between two rows, on which track
```

The idea that makes one pass possible: **nothing in a sheet waits on a
position.** Ranks are final once computed. Which wall of a container a wire
uses is settled by ranks and by the declared order of same-rank ends. So the
set of things to be ordered never changes, the order of every row in the tree
can be searched as one state against one exact count, and geometry is the last
thing decided rather than something ordering has to guess. The earlier engines
laid a container out the moment they ordered it and then spent passes sending
corrections back (§6).

**Ranks** (`rank.ts`). Each container is ranked on its own, by the wires
lifted to its direct children. The author's pins are exact — pinned boxes are
one node with fixed offsets, so a pinned band cannot split, whatever unlisted
box lies on a path between its members. Wires are taken in declaration order;
one that cannot point down (it closes a cycle, or the pins say otherwise) runs
upward instead, so the first-declared wire of a mutual pair keeps its
direction. Everything unpinned goes where total wire length across ranks is
least (network simplex, tested against brute force), not merely as high as it
can: a lone source drops to just above what it feeds. Two boxes joined by a
wire may share a rank if the author put them there — a rank is a constraint
here, not a property of the algorithm.

**Sheets, slots, lanes, ports** (`sheet.ts`). Every container gets a sheet:
its ranks and the *slots* in them. A slot is a box, a *lane* (a wire passing a
rank on its way to a further one takes a place in that rank's order, like a
box), or a *port* (a wire crossing the sheet's north or south wall). A wire
between boxes in different containers is drawn in pieces, one per container it
passes, joined at the walls without a step. A same-rank wire between
neighbours uses their facing walls and nothing may stand between them; between
non-neighbours it leaves by the south walls and goes round under the row. A
wire to the sheet's side wall leaves straight only from a box that is last in
its row.

**One exact crossing count** (`count.ts`). The quantity minimised is the
number of crossings that will be drawn, over the whole tree, given only the
order of slots in every row. Two links between adjacent rows cross when their
ends stand in opposite orders; an end at a container stands where its wire
meets that container's wall, which is the container's own port order. That is
how the two sides of a wall are decided together: one order, counted on both
sides. Same-rank wires and wires to side walls are counted along their row.
The count is a sum of small units, so a move re-counts only what it touched.
Measured on the 80 random diagrams: the model counts 275 crossings, the
drawing has 281 — the six are in gutters and round-the-row wires, which the
count leaves out. Why exactness matters: on the earlier engines, every
mismatch between the model's count and the picture turned out to be a bug.

**The ordering search** (`order.ts`). The state is the order of boxes and
lanes in each row. Ports are not searched: a container's wall takes its wires
in the order the rank behind it has them, so the stretch just inside a wall
never crosses and any disagreement shows up outside, where the row out there
can answer it. The search is a descent with these moves:

- *seed* — boxes as declared; each lane where a straight stroke between its
  wire's ends would pass;
- *sift* — take one slot along its row to where the whole picture crosses
  least; a box may carry its wires' lanes with it;
- *untangle* — when slots trade places, the lanes their wires run on to are
  put back in step, in the next row, the one after, and through a wall into
  the sheet outside. This is the move that changes a port, a place in the row
  inside and the row outside at once, where each alone would cross something;
- *reroute* — a wire's lanes change sides as a whole;
- *mirror* — a container nobody arranged, turned about whole;
- *restore* — boxes that left their declared order for nothing go back.

What decides between two orders: fewer crossings; then, only if no box has
passed another, the straighter (judged in real sizes — rows of different
lengths make fractions of a row lie). **Declaration order is worth a tie, not
a crossing**: a box leaves its declared place only to remove a crossing, and
never if `held`. A box no wire touches stands after its row-mates that have
one, so containers keep their wired boxes to the same side and line up. The
search runs from the declared order and, only if crossings remain, once more
from a second start (rows sorted by where their wires come from), keeping the
second only if it crosses less.

**Balance-first placement** (`place.ts`, `project.ts`). Each slot has one
place it wants along its row, read off its wires, and a weight that says who
gives way:

- a *fan* — a slot with two or more wires on its busier side stands over the
  middle of them: the middle of the span, or straight over the middle one of
  an odd number. This is the heavy want. Nothing lighter moves a box off it.
- a *single* — a slot with one wire on its busier side takes its place among
  the other children of the fan it belongs to: the boxes one box feeds stand
  packed and centred under it.
- a *chain* — one wire in, one out, all the way, is a straight line; that is
  its balanced place. It hangs from whichever end has a balanced place of its
  own, so one of eleven wires leaving a hub does not drag its far end.
- *nothing* — a slot no forward wire pulls stays beside its neighbour: no gaps
  nothing holds open. A wire running back against the flow follows its boxes
  and never leads them.

For a box with wires on both sides, the busier side decides. Every wire to the
next rank counts equally, whether or not its far end leads anywhere (an
earlier rule let a dead end pull less; it is withdrawn). Two containers joined
by several wires stand in a column. `aligned` sets are one variable; `columns`
are constraints between bands. Rows are solved one at a time, down the sheet
and back up, four times; each row solve is exact. Everything then goes to
**one 8-pixel grid**: every gap is a multiple of 8, positions are rounded
once, a container's width is a whole number of steps, so two boxes anywhere in
the picture are on one line or a clear step apart.

**Ports** (`ports.ts`). Boxes are placed first, on their centres; ports then
go to meet the wires. On one wall the ports stand in the order of their far
ends, evenly about the middle, except that a port slides along the wall to
where its wire runs straight — never changing places with a neighbour, never
closer than 16 px to one where the wall has room, never within 8 px of a
corner. A wall's only wire meets it in the middle; the wire's own stretch
moves to the box's middle, not the box to the wire.

**Gutters** (`gutter.ts`). A wire between two neighbours on one rank runs
straight across the gutter between their facing walls. Each gets its own place
on each wall; a leaf's end slides to be level with the other end (a table's
only within its head), and where both ends are fixed — two containers — the
wire steps once in the gutter. Everything here is measured before anything has
a position, which is what lets placement leave the gutter exactly the room it
needs.

**Tracks and channels** (`tracks.ts`). The strip between two rows is a
channel; turned on its side, a gutter is one too. Everything that turns in a
channel is a *net*: a run on one track with stubs up and down. Tracks are
16 px apart. Nets are stacked so that wires which need not cross do not, and
so that one wire's stub never lies along another's. A wire fixed at both ends
that would lie along another steps aside, or steps twice. This is the one
routing primitive: a dog-leg, a wire round a row, a wire leaving by a side
wall and a trunk are all nets.

**Labels as row items.** A label sits half-way along its wire: in the gap
between two ranks if the wire crosses an odd number of gaps, in a lane of the
middle rank if even. It reserves room only in the container where the wire's
two ends part company, and a labelled channel is deeper only as far as the
label and its tracks do not already fit. So a pill is on its own wire by
construction, and the "label on a crossing" seam of the two-router design has
no place to occur. (A label can still be crossed by *another* wire; §8.)

**Containers, directions, titles** (`lay.ts`, `frame.ts`). Sheets are laid
out innermost first, because a container's size is its inside's. `frame.ts` is
the only file that knows which axis is x: a rightward container is a downward
one with the axes exchanged, exactly, so a container with its own `direction`
is nothing special and needs no second layout call. A wire that has to turn
anyway enters a titled container clear of the title and turns below it; one
that runs straight on into the first box may pass the end of the title, where
the renderer draws the title on a halo (`titleCrossed`). A jog to avoid a
title was judged worse than a wire behind it.

**Wrap folds and bundles.** A fold is decided in the plan (`wrapRows` in
`plan.ts`), per container: one chain becomes a serpentine (every other band
runs backwards, so each fold is one step down); anything else keeps its ranks
and splits each over-wide rank into bands of N. The bands of one rank stand in
columns (an `aligned` set each). The wires from one source into the later
bands, and from the earlier bands on to one target, are a *bundle*: one port
on the shared box, one lane through each rank they all pass, one track where
they part, each wire's label on its own last stub. `channel` is the same
bundle shared at the target. There is no bus router; `via: "bus"` on a `PEdge`
only tells the renderer the wire is a wrap trunk.

**Room and hooks.** See §2. Room beside a box is one more term in the gap to
its neighbour (or part of its rank's depth, above and below). A hook's lane
stays beside its box through every ordering move.

## 5. Decisions, and the evidence for each

Each of these was argued once already. The evidence is here so it does not
have to be argued again without a new fact.

**Own the engine rather than extend ELK.** Evidence: §1; the four failed
attempts to make ELK co-rank connected nodes; the language-level comparison
(28 hand-written zone arrangements: ELK honoured 20, a row's tops level in 8;
the first in-house engine 28 and 28; `wrap` asked in 11 views with containers: ELK
folded 1, the first in-house engine 11); zero violations where ELK's layouts of 115
unseen diagrams carried 31; and the score in §7.

**Balance first; a box is never moved to straighten a wire.** The third
engine, `braid`, was a cold rewrite that beat everything before it on
crossings, bends and speed (corpus bends 701 against `loom`'s 1,057). It got
there by preferring the straight wire: a parent hung over one child on a
dead-straight wire rather than centred over its fan, and small jogs crept in
(corpus lopsided boxes 145 against 130; random-set jogs under 16 px 59 against
32). The owner looked at the pictures side by side and rejected it: a
symmetric fan with two bent wires reads better than a lopsided one with a
straight wire. The requirements were revised to say so and `weft` was written
from them: corpus lopsided 104, bends 707 — within six of `braid` — and
crossings lower than either. The score's `lopsided` weight (4) deliberately
outweighs the two bends centring costs; with that term at zero the earlier
engines' verdict against ELK flipped from ahead to behind by count, which is
the reason the term is written down rather than left implicit.

**The "dead end pulls less" rule is withdrawn.** It let a chain stay straight
past a side lookup by making a box with no onward wire pull less. That is
straightness beating balance by another name; the parent now stands between
the two.

**Order the whole picture together, against an exact count.** Ordering
containers one at a time, innermost first, was the largest single source of
crossings in the first engine: flat random graphs crossed less than ELK's
(107 to 138) while graphs with expanded systems crossed about twice as much.
Counting a container's wall on both sides took the trial set from 566 to 545
crossings; the cold rewrites, built around the idea from the start, took the
80 random diagrams from 441 (`grid`) to 281 (`weft`).

**Decide each thing once; no "best of N layouts".** `grid` ended at sixteen
full layouts per picture with three signals passed back between them, and
took 180 s on the 80 random diagrams. `weft` lays each sheet out once and
takes 1.4 s. The requirement is in §6 of the requirements document ("a design,
not a pile"); the iteration that remains is listed, bounded, in the README.

**Declaration order is worth a tie, not a crossing.** Under ELK the root kept
declaration order however many wires that crossed. Letting unplaced boxes move
— only when that removes a crossing — halved corpus crossings in the first
engine (73 → 38). `rows`/`cols`/`place` hold a box where the author put it.

**A box no wire touches stands aside.** Decided on
`20-multicloud-migration#landscape`: two zones one above the other were 688 px
wide and staggered with the unwired box in declared order, 480 px and in line
with it moved to the end. Seven corpus and trial views changed; none scored
worse.

**One 8-pixel grid, and no jog under 16 px.** DESIGN's "nothing
almost-aligned" could not be held while ELK placed nodes. Corpus
almost-aligned pairs 9 → 0, jogs under 16 px 12 → 0.

**Boxes line up on centres; ports slide to meet wires.** Lining a box up on
one of two evenly spaced ports set a chain a third of a wall off its own
baseline.

**Canvas size is not scored.** The owner's words: "I wouldn't worry about
bigger or smaller, just what layout looks better." Area was dropped from the
score, and two views less than two points apart are level. That removed about
eighty small views that had "lost" by a fraction of a point for being 30 px
taller.

**A straight wire may pass the end of a title.** Keeping every wire clear of
titles left a 4 px step at a titled container's wall (`17-nested#deep`); the
renderer already draws a crossed title on a halo.

**Labels reserve room only where the wire's ends part.** Reserving in every
container the wire passed padded those containers and hid the hint that orders
their exits.

**A plain box with one wire across a gutter to a container's fixed port
centres itself on that wire** (after acceptance; lookbook
`38-container-direction`, view `load`). Before, the port stopped at the box's
corner limit and the wire stepped in the gutter. This moves a box to meet a
wire, which looks like an exception to "never move a box to straighten a
wire"; it is not, because a box with a single wire has no fan to be balanced
over — on the wire *is* its balanced place.

**Cold rewrites from a requirements document.** `loom` was meant as a rebuild
and turned out to carry most of `grid`'s stages over. Writing the rules down
and handing them to an author who had not seen the earlier code produced the
two engines that actually improved (`braid`, `weft`). The document is kept as
the standing requirements for that reason: it is the thing to hand over if
the engine is ever rewritten again.

### Tried and rejected

| Tried | Result | Why it is not kept |
|---|---|---|
| Straightness first (`braid`) | Best bends and speed at the time | Pictures judged worse by eye: lopsided fans, small jogs. See above. |
| **Leaves that grow wider** — a fanning box widened to cover its fan; a container's leaves given one width | Corpus bends 707 → 425, no violations | The pictures were not better. Width reads as importance; a grown card is mostly empty; sizes in one picture stop being uniform; adding a wire would resize a box. The score sees none of that. If it returns it should be something the author asks for, not something wiring decides. |
| `grid`, the first engine | Legal everywhere, ahead of ELK | Grew by accretion: each container laid out when ordered, then corrected by feedback — sixteen layouts per picture. |
| `loom`, the rebuild | Slightly ahead of `grid`, 3× faster on dense diagrams | A partial rebuild; the placement stages were `grid`'s. |
| A whole-picture sketch to seed ordering (`grid`) | Corpus crossings 25 → 29 on its own | It knows nothing of routing. Kept only as a second start, used when the first leaves crossings — which is what weft's second start still is. |
| Letting a container's inside decide its entry order outright | More crossings upstream than it saved | The wall is shared; one side cannot own it. |
| Holding wall ports to whole grid steps during the last jog removal | More bends and jogs than it removed | — |
| Compacting gaps twice | Three more views worse, nothing gained | — |
| More ordering rounds (`grid`) | No gain; it settled in two | — |
| ELK's convention for a parent of two (line up with the first child) | Fewer bends by count | Lopsided; the same decision as balance first. |
| For a chain with a wire running back: line boxes up on centres and slide ports; or place boxes before passing wires | Both fixed that case | In `grid` the first moved bend totals the wrong way and the second cost 9% of area on dense graphs. (Centres-then-ports is what weft does, designed in from the start.) |
| Making the tracks follow the ordering model more closely | Not needed | Measured first: the drawn count already equalled the model's. The gap was the search, not the model. |
| Shrinking unlabelled gaps the way ELK's spacer scheme did | — | Taste, decided for even spacing: every gap is the density's spacing. |

The ELK-era experiments (hub-in-the-middle fans, a return wire instead of a
serpentine, `HEAD` labels for flow badges, and so on) are recorded in
`wrap.md`, `edge-labels.md` and `note-placement.md`, where the policies they
shaped still live.

## 6. The four engines, briefly

| | ELK | `grid` | `loom` | `braid` | `weft` |
|---|---|---|---|---|---|
| Better / level / worse than ELK, 384 views | — | 183 / 190 / 11 | 189 / 182 / 13 | 233 / 145 / 6 | 238 / 143 / 3 |
| Total penalty vs ELK | — | −35% | −37% | −46% | −49% |
| Corpus (259): crossings | 73 | 25 | 26 | 25 | 22 |
| Corpus: bends | 1,174 | 1,041 | 1,057 | 701 | 707 |
| Corpus: jogs under 16 px | 12 | 1 | 1 | 5 | 1 |
| Corpus: lopsided boxes | — | 134 | 130 | 145 | 104 |
| Random (80): crossings | — | 441 | 365 | 288 | 281 |
| Random: jogs under 16 px | — | 41 | 32 | 59 | 10 |
| Time, 80 random views | — | 180 s | 51 s | 1.9 s | 1.4 s |

Those are the numbers at the moment each engine was last measured. After the
post-acceptance fix above, weft's corpus stands at 705 bends and 0 jogs under
16 px, with 0 almost-aligned pairs (ELK: 9).

`grid`, `loom` and `braid` are deleted. They are in git history under
`packages/core/spike/`; `7ff8eb6` is the commit that removed them, and
`02e8595` moved weft from `spike/` into `src/layout/weft`.

## 7. How quality is measured and gated

Three kinds of check, and none replaces the others.

**Legality.** The hard rules of §3, asserted three ways: `checkLayout`
(`packages/core/test/invariants.ts`) on every `Positioned` the corpus
produces; a Problem-level audit (`test/weft/legal.ts`) that holds a `Problem`
and its `Solution` to every hard rule directly, including the two only the
contract can state (a box's `room` is entered by nothing but its own wires; a
wire asked to use a side uses it or is listed); and that audit run over
seeded random Problems (`audit.test.ts`, `random-problem.ts`) with rooms,
asked sides, both directions, pins, bundles and labels. A failure names its
seed. The sweep over the diagram sets adds two rules `checkLayout` cannot
state alone: every edge the view has is drawn, and no two wires outside one
bundle run along the same line.

**The measures.** `test/weft/metrics.ts` counts, on any `Positioned`, what a
reviewer would mark: crossings, bends, kinks (a jog under 16 px), near-misses
(two boxes of one container 1–7 px out of line), lopsided boxes (off the
middle of the boxes their wires fan out to), off-centre wires (a wall's only
wire 1–7 px off the wall's middle), unstraight wires (bent although their ends
face each other), wire length and area.

**The diagram sets** (`test/weft/sets.ts`), 409 views in all:

- **corpus** (259 views) — every `.squinch` file the repo owns: examples,
  lookbook cases, gauntlet solutions, core's fixtures, auto views included;
- **trial** (35 views) — twenty diagrams written after the first engine, on
  purpose unlike the corpus: a hub with ten services, a saga, a lattice, a
  tree, a dense bipartite graph, containers three deep, zones side by side;
- **round 2** (35 views) — sixteen more, written later still;
- **random** (80 views) — seeded: flat, grouped into expanded systems, with
  `rows`, `wrap` or a rightward flow.

Each set is also drawn turned on its side (every view forced to `direction
right`), which is the same engine working along the other axis.

**The standing gate: a quality baseline.** `test/weft/sets.test.ts` draws
every view of every set both ways, requires zero broken rules, and compares
the per-set totals of each measure against `test/weft/quality.baseline.json`.
Lower is better for every one; a total that rises fails the test, and a total
that falls is printed with a reminder to re-record. `UPDATE_QUALITY=1`
re-records — in the same commit as the change that earned the difference, with
the reason in the message. A set whose view count changed has to be
re-recorded too, because totals over different views do not compare. The
baseline also carries `labelOnWire`: labels another wire crosses, the one
thing in §8 that is counted so it cannot grow unnoticed. Its numbers are the
product path's (auto views, notes, route sides) and so differ a little from
the acceptance figures quoted in this note, which were measured before those
were wired in.

**The score used to choose between engines** (history; the file went with
ELK — `git show c95ab03:packages/core/test/weft/score.ts`). While there were
two engines to compare, the measures were folded into one penalty per view:

| Weight | For each |
|---|---|
| 60 | illegal thing (a wire through a box, a broken invariant) |
| 10 | crossing |
| 5 | kink |
| 5 | near-miss |
| 4 | lopsided box |
| 3 | unstraight wire |
| 2 | off-centre wire |
| 1 | bend |
| 1 | 200 px of wire |
| 0 | area |

Lower is better; two views within 2 points or within 5% are level. The
weights are a judgement written down once and applied to both engines alike;
`lopsided` deliberately outweighs the two bends that centring a parent costs.
At acceptance, against ELK on the 384 views both engines could be scored on
(views that fold with `wrap` sat out, because ELK ignored most of them): 238
better, 143 level, 3 worse; total penalty −49%. Corpus crossings 73 → 22,
bends 1,174 → 705, jogs under 16 px 12 → 0, almost-aligned pairs 9 → 0. If two
candidate engines ever have to be compared again, restore that file rather
than inventing new weights — the history in `layout-engine-spike.md` is only
comparable under these.

What no number sees, so nobody trusts one alone: whether a hint was honoured
(ELK scored *better* on `10-nested-zones#side` for stacking two networks the
author asked for side by side); whether sizes are uniform (the growing-leaves
experiment); crowding near the canvas edge.

**Looking at pictures.** Every decision in §5 that mattered was made by
someone looking at renders side by side. Acceptance was the owner looking at
every corpus view, ELK beside weft. A change to placement or ordering is not
done until the pictures it moved have been looked at (§9).

Beyond the engine's own suites, the product gates still apply: golden SVG
byte-compare, the corpus invariant sweep, `render --check` on every example
project, the lookbook snapshot, and the bench budgets.

## 8. Known weak spots

Written down at acceptance. None is a hard-rule violation.

- **Dense diagrams can stop at a local minimum.** The ordering search is a
  descent from the declared order with one restart. On some of the 80 random
  diagrams — several expanded groups, wired freely — it draws more crossings
  than ELK did, though fewer in total. `random-21` was the standing outlier
  through every engine (ELK 8 crossings; `loom` 19).
- **A side-routed wire does not choose the nearer side.** A hook takes the
  lane on the side asked — or, out of a north or south wall, the east side
  unless that is taken — not the side of the box nearer where the wire is
  going. A hooked wire is also not felt in placement (the box is not pulled
  by it), and its short stretch between wall and lane is not in the crossing
  count.
- **`lookbook/cases/26-route-label` crosses wires.** A consequence of the
  previous item.
- **Canvases are tighter than ELK's**, so a note pinned to a corner sits
  closer to the content than it used to.
- **Crossings inside a gutter are not counted** (two containers side by side
  joined by several wires whose fixed ports are in opposite orders), nor one
  round-the-row wire against another round the same row. This is the six of
  281 in §4.
- **A lane from outside is not followed inside.** A container's north and
  south ports stand where its inside puts them; the outside comes to meet
  them. Only across a gutter is a finished container's side port moved to
  come level with a wire (`slide` in `lay.ts` — the one message from outside
  to inside).
- **A label can be crossed by another wire** (never by a box or a label).
- **Titles in a rightward container** lie along the wall wires enter by, so a
  wire may run under one; the renderer draws the title on a halo.
- **A wire ending at a container's side wall** takes the free place nearest
  the wall's middle; nothing more is considered.
- A wall's only wire can still be a few pixels off the middle where it meets
  a container port that is off the grid (3 cases in the random set).

### The most promising next steps

1. **A wider ordering search for dense diagrams**: more starts, or a
   perturbation step when the descent stalls. The count is exact and
   incremental and a restart is cheap (80 random views take 1.4 s in all), so
   there is room. Judge it on the random set's crossings and on time; the
   corpus will barely move.
2. **Let a hook choose its side** by where the wire is going, and put its
   stub in the count. That should fix `26-route-label`.
3. **Count gutter crossings** — a new unit in `count.ts`.
4. **Tell the inside where the outside would like a port** (requirements
   §5.4, §5.7 "arrival lane"), within the extent of the container's own
   boxes.

Not a next step: anything that buys bends with balance, or resizes boxes by
their wiring (§5).

## 9. How to change the engine safely

**Find the rule.** Every rule in the requirements has one place in the code,
a comment there stating it as a user would see it, and a test on a handful of
boxes. The README's "The rules, and where each is kept" is the index. In
brief:

| To change | Go to |
|---|---|
| What a hint means; which wires are trunks; sizes; note room | `plan.ts` |
| Ranks | `weft/rank.ts` |
| Which wall a wire uses; lanes; label places; hooks | `weft/sheet.ts` |
| What counts as a crossing | `weft/count.ts` |
| Ordering moves | `weft/order.ts` (`Search`) |
| Where boxes stand; balance weights | `weft/place.ts` (`aim`) |
| Ports on a leaf's wall | `weft/ports.ts` |
| Same-rank neighbours | `weft/gutter.ts` |
| Track order and spacing | `weft/tracks.ts` |
| Row depths, container width, polylines, small-jog removal | `weft/lay.ts` |
| A diagnostic that needs the result | `layout.ts` |
| Badges, chips, notes | `annotate.ts`, `notes.ts` |

**Keep the structure.** Each decision is made once with what it needs in
view. If a fix wants a later stage to send something back to an earlier one,
or a second layout to compare with the first, that is the failure mode of the
first two engines; find the stage that should have known. Where iteration is
genuinely needed it is explicit, small and bounded, and the README lists every
instance.

**Run, in this order** (from `packages/core`; the README has the commands):

1. the engine's unit tests — per module (`modules.test.ts`, `rank.test.ts`)
   and on whole small Problems (`engine.test.ts`). Seconds.
2. the Problem-level legality audit over random Problems
   (`test/weft/audit.test.ts`).
3. the language suites (`language`, `zones`, `wrap-containers`,
   `direction-right`): hints drawn as asked.
4. `test/weft/sets.test.ts`: every view of the four sets, both directions —
   zero broken rules, and the quality baseline. If a total moved, know why
   before re-recording it (`UPDATE_QUALITY=1`).
5. `pnpm --filter @squinch/core test` — goldens, the corpus invariant sweep.
   A placement change will move goldens; `UPDATE_GOLDEN=1` only after step 6.
6. look at the pictures (below).
7. `pnpm --filter @squinch/core bench`, and re-sync the lookbook and every
   example project (`render --sync`), committing the SVGs.

**Render before and after.** The quickest honest comparison is two checkouts:

```
git worktree add ../squinch-before HEAD        # before you start
# … make the change in the main checkout, then in each: pnpm -r build
node packages/cli/bin/squinch.js render <file.squinch> -o out/        # both trees
```

and, for the whole corpus at once, `npx tsx lookbook/build.ts` followed by
`git diff --stat lookbook/out` names every lookbook view that moved; restore
the directory afterwards if the change is not going in. For a diagram that is
not in the corpus — a trial or round-2 file, or `randomDiagram(seed)` from
`test/weft/random.ts` written out to a file — render it with the CLI like any
other. Look at every view that moved, not a sample: the growing-leaves experiment had no
violations and a better score, and was wrong.

**Determinism.** `solve` must stay a pure function of the `Problem`: no
`Map`/`Set` iteration whose order depends on anything but the input, no
floating-point result that reaches a coordinate unrounded, no `node:` import.
CI byte-compares goldens on three operating systems.

**User-visible cost.** After launch, users commit renders and
`render --check` compares them. Any change to placement makes their CI stale
until they re-sync. That is a reason to batch layout changes into a release
and name them in the changelog, not a reason to avoid them.
