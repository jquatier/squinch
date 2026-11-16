# Note — how the layout engine came to be (2026-11)

**Status: history.** This was the working log of the spike that replaced ELK.
The spike ended with `weft` becoming the product's layout engine (commit
`c95ab03`). What the engine is, why, and how to change it is in
[`layout-engine.md`](layout-engine.md); the rules it is held to are in
[`layout-engine-requirements.md`](layout-engine-requirements.md). This file
keeps the order things happened in and the numbers each round produced,
because several decisions only make sense next to what was measured just
before them.

Every file path of the time is gone: the spike lived under
`packages/core/spike/` (`grid/`, `loom/`, `braid/`, `weft/`), outside `src/`.
`7ff8eb6` removed the first three; `02e8595` moved weft to
`packages/core/src/layout/weft/` and its suites to `packages/core/test/weft/`.
To read an old engine, check out the commit before `7ff8eb6`.

## The question

Whether to keep extending the ELK-based engine or to own the layout. Reading
the 2,900-line `layout.ts` of the time against its bug history, the recurring
bugs fell into three classes, none of them a bug in ELK or in our router:

- **Predict, then nudge.** We estimated ELK's layering before it ran,
  classified edges on the estimate, and pushed ELK toward it with scaffold
  edges that are lower bounds only. When ELK disagreed, a wire ended in canvas
  (gauntlet rounds 26 and 27).
- **Several owners of one canvas.** ELK, the coplanar router, the bus router
  and the post-passes each placed wires, ports and pills without seeing each
  other.
- **Features expressed as tricks.** Spacer labels on every edge, invisible
  node labels as margins, `elk.position` at multiples of 1000, a wrapper graph
  to dodge a crash, a second full layout for note margins.

## `grid` — the first engine

A layered engine for Squinch's own model: boxes in ranks, wires in channels,
containers laid out inside-first. About 1,700 lines and no dependency. Three
ideas carried it and survive in weft: a rank is a constraint, not a hint;
everything that turns is a run in a channel, so there is no second router; a
container is the same layout run on its inside, so root, zone and frame share
one code path and `direction right` is the same layout with the axes swapped.

On the 259 corpus views:

| Measure | ELK | pass 1 | pass 2 | pass 3 | after the trial |
|---|---|---|---|---|---|
| Layout time | 3,331 ms | 171 ms | 210 ms | 230 ms | 301 ms |
| Violations | 0 | 0 | 0 | 0 | 0 |
| Crossings | 73 | 120 | 78 | 73 | 38 |
| Bends | 1,174 | 1,565 | 1,331 | 1,337 | 989 |
| Jogs under 16 px | 12 | 47 | 19 | 11 | 12 |
| Wires through an unrelated node | 2 | 0 | 0 | 0 | 0 |

What moved pass 2: boxes reorder inside a container nobody arranged;
pass-through wires ordered by sweeps; bundles (a folded fan-out and a
`channel` are one trunk — `39-wrap#fan` went from 2,143 px wide to 1,264, with
no bus router); ranking by network simplex.

**A tidiness review** of side-by-side renders turned up faults no total had
flagged; each became a rule that is still in the requirements: boxes line up
on centres and ports go to meet the wires; a box holds its lane against a
passing wire; a parent stays centred over its children; one 8 px grid for the
whole picture; no jog too short to draw; several labelled wires share a
gutter; an arrival lane never stretches a container. A second look added: the
side with more pull decides where a box sits; a wire round a titled container
takes the far side from the title; a label reserves room only where it is
drawn; a container's exits are ordered by where the wires end up.

**Diagrams neither engine had seen.** Twenty hand-written diagrams unlike the
corpus plus eighty seeded random ones (115 views). ELK: 17 check errors, 31
violations in what it drew, 11 wires through unrelated nodes. `grid`: no
violations, ahead on area, wire and bends, and **behind on crossings (772 to
607)** — flat random graphs crossed less than ELK's (107 to 138), graphs with
expanded systems about twice as much, because each container's inside was
ordered before its surroundings were known. Fixing that took the rest of the
spike.

**The language, checked directly.** Zones and expanded containers arranged as
asked: ELK 20 of 28 hand-written cases (a row's tops level in 8), `grid` 28 of
28. `wrap` in views with containers: ELK folded 1 of 11, `grid` 11 (a
dispatcher and nine workers at `wrap 3`: 1,432 × 634 under ELK, 584 × 764).
Every corpus and trial view turned rightward (303 views): ELK 14 check errors
and 11 violations, `grid` none. Five things that were errors or warnings under
ELK simply drew: an upward edge between declared rows, a band with an unlisted
node between its members, row-mates with an edge inside a container, rank
hints inside a zone, `wrap` on any shape.

## A score, and what it changed

To ask "does it look better?" of every view at once, a penalty per view was
written down (the weights are in `layout-engine.md` §7). Verdict against ELK
over the rounds — better / level / worse, and total penalty:

| Round | Views | Verdict | Penalty |
|---|---|---|---|
| First score | 409 | 190 / 105 / 114 | −14% |
| After three passes (nested containers agree on an order; wall ports out of order count as the crossing they cause outside; side-wall wires take the quieter channel) | 409 | 208 / 107 / 94 | −18% |
| "Looks, not size": area out of the score, views under two points apart are level | 409 | 190 / 183 / 36 | −22% |
| `wrap` views out of the score; an "almost-centred" count added | 384 | 174 / 188 / 22 | −26% |
| Unplaced boxes join the crossing sweeps; best picture kept; idle gaps closed | 384 | 182 / 188 / 14 | −32% |
| Containers joined by several wires stand in a column | 384 | 178 / 192 / 14 | — |
| A whole-picture sketch as a second start | 384 | 179 / 191 / 14 | — |
| The whole picture ordered together | 384 | 180 / 191 / 13 | −34% |
| A box trade counts the far side of the wall; a container turned about | 384 | 183 / 190 / 11 | −35% |

Things learned on the way that are still true:

- **The verdict turns on centring.** A parent centred over two children bends
  both wires; ELK ran one straight and hung the parent over that child. With
  the centring term set to nothing, the first score read 140 / 119 / 150 —
  behind by count. Centring is in the score because centring is what was
  asked for.
- **The score cannot see a hint that was not honoured.**
  `10-nested-zones#side` asks for two networks side by side; ELK stacked them
  and scored 40, `grid` did as asked and scored 121.
- **Boxes with no wires stand aside** — decided on
  `20-multicloud-migration#landscape` (688 px wide and staggered → 480 and in
  line).
- **The model and the picture agree; the search was the gap.** Measured pass
  by pass on three dense diagrams, the drawn crossing count equalled the
  model's. What varied was the model's own count from one pass to the next on
  one diagram — 23, 60, 52, 37, 24 — a search stuck in different places.
- Trial-set crossings fell 772 → 523 over these rounds (ELK 607). `random-21`
  stayed the outlier throughout: ELK 8, `grid` 22.

Tried in `grid` and not kept: letting a container's inside decide its entry
order outright; holding wall ports to whole grid steps during the last jog
removal; compacting twice; more ordering rounds; dropping the old estimate of
outside crossings once they were counted for real; for a chain with a wire
running back, two fixes that each cost more than they bought.

By the end `grid` drew sixteen full layouts per picture — eight per attempt,
two attempts, three signals passed between them — and kept the best.

## `loom` — a rebuild

Three steps, each once for the whole picture: index and rank the tree; draft
every container's slots and order them all together against an exact crossing
count; lay out. Then once more with what the first drawing showed. Six
layouts, not sixteen.

| Set | Views | `loom` better | Same | Worse | Crossings | Time |
|---|---|---|---|---|---|---|
| Corpus | 259 | 9 | 245 | 5 | 25 → 26 | 0.95 s → 0.77 s |
| Trial | 35 | 5 | 27 | 3 | 82 → 75 | 1.8 s → 0.65 s |
| Round 2 | 35 | 8 | 25 | 2 | 4 → 1 | 3.1 s → 0.53 s |
| Random | 80 | 32 | 34 | 14 | 441 → 365 | 174 s → 50 s |

Against ELK: 189 / 182 / 13, −37%. It turned out to be a partial rebuild —
the placement stages were carried over from `grid`.

## Two cold rewrites: `braid`, then `weft`

So the rules were written down as requirements and handed, twice, to an author
who had seen none of this work and was not allowed to read the earlier
engines.

- **`braid`** won on crossings, bends and speed, but bought bends with
  balance: a box hung over one child on a dead-straight wire rather than
  centred over its fan. The owner looked at the pictures and rejected it.
- The requirements were revised — **balance and symmetry outrank
  straightness; a box is never moved to straighten a wire**; the "dead end
  pulls less" rule withdrawn — and **`weft`** written from them. It was ahead
  of every earlier engine on balance and on crossings and speed, and was
  accepted after the owner looked at every corpus view beside ELK's.

| | ELK | `grid` | `loom` | `braid` | `weft` |
|---|---|---|---|---|---|
| Better / level / worse than ELK, 384 views | — | 183 / 190 / 11 | 189 / 182 / 13 | 233 / 145 / 6 | 238 / 143 / 3 |
| Total penalty vs ELK | — | −35% | −37% | −46% | −49% |
| Corpus: crossings | 73 | 25 | 26 | 25 | 22 |
| Corpus: bends | 1,174 | 1,041 | 1,057 | 701 | 707 |
| Corpus: lopsided boxes | — | 134 | 130 | 145 | 104 |
| Corpus: jogs under 16 px | 12 | 1 | 1 | 5 | 1 |
| Random (80): crossings | — | 441 | 365 | 288 | 281 |
| Random: jogs under 16 px | — | 41 | 32 | 59 | 10 |
| Time, 80 random views | — | 180 s | 51 s | 1.9 s | 1.4 s |

Layout time on the 259 corpus views, warmed up: ELK 2.5 s, `weft` 0.25 s
(median view 8.0 ms against 0.8 ms; `weft` slower on none).

**Tried and not kept: leaves that grow.** A fanning box widened to cover its
fan, and a container's leaves given one width. Corpus bends fell from 707 to
425 with no violation, and the pictures were not better (`layout-engine.md`
§5 has the reasons).

## Into the product

In order (`git log` has each): the engine and its suites moved into core
beside the ELK layout; an engine switch let `layoutView` run either, with
badges, chips and notes placed by passes neither engine owns and weft's
planner raising the zone, route, channel, wrap and align diagnostics; every
corpus view was rendered by both engines through the product for review; two
contract extensions were added for parity (`Box.room` for notes, `Wire`
sides for `route … from/to`) with a Problem-level audit of the hard rules
over random Problems; a box beside a container was made to stand level with
the wire between them; then ELK, the `elkjs` dependency and the switch were
removed, and the examples, lookbook and goldens redrawn.
