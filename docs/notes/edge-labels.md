# Note — edge-label placement

Engineering notes, not requirements (the *rules* live in DESIGN §4). This file
exists because label placement was redesigned several times; if a label lands
somewhere odd again, start here rather than re-deriving.

> **Rewritten 2026-11 for the weft engine.** A label is now placed by the
> layout engine as part of the layout: it is an item in the row or the gap its
> wire passes, so it sits on its own wire by construction
> ([`layout-engine.md`](layout-engine.md) §4, requirements §5.6). Three earlier
> mechanisms this note used to document are gone: the post-layout placement
> search with its overhang allowance and detached-label baseline (deleted
> 2026-08 when reservation replaced it); ELK inline labels with the spacer
> scheme; and the pass that slid an ELK pill off a same-rank wire, which
> existed only because two routers could not see each other's reservations.
> What survives below is policy that does not depend on the engine, and the
> rejected approaches. The old text is in git:
> `git show c95ab03~1:docs/notes/edge-labels.md`.

## The policy, as it stands

- **Room is reserved at layout, never scavenged after it.** Every labelled
  edge carries a `labelRect` and the renderer draws the pill exactly there.
  Every earlier design that placed pills after layout — a search along
  segments, relocation below the nodes, leaders — lost to reservation.
- **A label sits half-way along its wire**: in the gap between two ranks if
  the wire crosses an odd number of gaps, in the row it passes if even;
  between two row-mates, on the wire in the gutter. Several labelled wires
  between one pair of neighbours each carry their label on their own stub, in
  columns if they would collide.
- **It reserves room only in the container where the wire's two ends part
  company**, and a labelled gap is deeper only as far as the label and its
  tracks do not already fit.
- **A trunk's wires carry their labels on their own last stubs**, not on the
  shared trunk, where a label would split the trunk into a comb.
- **A label never overlaps a box, a card's stacked sheets, or another
  label.** The corpus invariant sweep asserts it. The sheets are not part of
  the card's rectangle; the planner states them as the box's `bleed`, so the
  label on a wire leaving a card's bottom clears them.
- **A label is crossed by nothing but its own wire.** It first moves along
  its own wire to the nearest clear place; one with no clear place is given
  room — its neighbours stand half its width off — and the layout is redone,
  at most twice (`layout-engine.md` §4). At the swap 29 pills in 13 corpus
  views lay across a neighbouring wire; now none does in the corpus, and
  `test/invariants.test.ts` asserts it. What remains: wires between two
  row-mate containers, whose ports are fixed by their insides
  (`layout-engine.md` §8).

## Flow badges (2026-08)

A `show flow` view draws a numbered badge on each step. The property a badge
needs is *attachment* — it must read as belonging to one wire — and
**collision was the wrong test**: the badges that first shipped overlapped
nothing the invariants asserted and still read as numbering the wrong edge
(docked flush against a neighbour's pill; resting on an unrelated async wire).

The policy, in `layout/annotate.ts`, engine-independent:

- **An edge with a pill** reserves one rect for both, pill width + 4 + badge
  (`plan.ts`). The annotation pass carves the badge off the end of that rect
  nearest the wire and hands the remainder back as the pill's `labelRect`, so
  the renderer and every obstacle set still see one rect meaning "the pill
  draws here".
- **An edge without a pill** reserves nothing. Its badge is a bead drawn
  centred *on* the wire, half-way along its own run.
- The badge is sized from the **full** flow's numbers, so stepping a flow one
  hop at a time cannot move it.
- Anchoring is to a point **along** the polyline, not the nearest vertex — a
  vertex is always a corner, and a badge in the elbow reads as decoration on
  the turn rather than a number on the line.

`checkLayout` asserts the property directly: no other edge may be closer to a
badge than its own.

## Rejected approaches (do not relitigate without a fresh reason)

| Approach | Why it lost |
|---|---|
| Placing pills after layout (search along the edge's segments, relocate below the nodes when none fits) | Shipped for months and produced every bug this file used to catalogue: detached labels, labels at two heights on one row, a 1 px miss sending a pill to the bottom of the canvas. Space has to be made during layout. |
| Anchor near the arrowhead ("what does this arrow do to its destination") | Tried; the midpoint feel was preferred. |
| Rotate the pill 90° onto vertical wires | Implemented and reverted — reads worse than a plain label beside the wire. |
| Perpendicular nudge off the wire | In a tight gutter a pill plus margins needs essentially all of it, so nudging one way hits the other neighbour — a dead end exactly when you would want it. |
| A leader line on a detached pill | Tried and reverted: a detached pill lands below both of its edge's nodes, so a line back to the edge's midpoint crosses one of them. It would need routed leaders, which is a feature, not a tweak. |
| The flow number on one side of the wire and the pill on the other | Splitting them means drawing the number into space nothing reserved. Number and pill share one reservation instead. |
| The flow badge as its own label near the arrowhead | It fixes attachment, but the badge divorces from its pill — number and label at two heights on one wire, so the reader joins two marks instead of reading one — and every badge becomes a layout element that grows the view. On unlabelled edges it loses the bead-on-the-line reading. |
| Relax the 4 px collision margin | The label then visually kisses the node border, and it loosens every tight placement everywhere. |

## If it happens again

- Dump the geometry first — the edge's points, its `labelRect`, what stands
  near it — before touching the policy. Every wrong turn recorded here came
  from changing the policy on a hunch and looking at one picture.
- "It looks fine in one theme" proves nothing: type metrics change node sizes,
  which changes routes.
- If the label is where the engine put it and the place is wrong, the rule to
  change is in `layout/weft/sheet.ts` (where a label goes) or `lay.ts` /
  `gutter.ts` (how much room it gets); if a badge is wrong, `annotate.ts`.
