# Note — edge-label placement

Engineering notes, not requirements (the *rules* live in DESIGN §4). This file
exists because label placement has been redesigned several times; if a label
lands somewhere odd again, start here rather than re-deriving.


> **Superseded (2026-08): label space is now reserved at layout time.** Every
> labelled edge carries a `labelRect` — ELK inline labels for cross-rank edges
> (spacer scheme, `layout.ts`), `elk.spacing.individual` gutters and sized
> lanes for coplanar ones — and the renderer draws the pill exactly there. The
> placement search this note documents is deleted; the corpus invariant sweep
> asserts no label overlaps a node or another label. Everything below is kept
> as the history of why reservation won: each section describes machinery that
> existed because space was scavenged after layout instead of made during it.

## The policy, as it stands

For each labelled edge, in edge declaration order:

1. Rank the edge's segments by length, longest first.
2. For each segment that can host the label (`w <= len + 24` — a modest
   overhang past the bends is fine, the pill background is opaque), try
   positions from the segment midpoint outward: `0.5, 0.42, 0.58, 0.34, …`.
3. Take the first position clear of the obstacle set: all nodes, zone border
   bands, frame borders and titles, and every pill already placed.
4. Only if *no* segment can host it: relocate below the edge's two nodes,
   shifting down past everything.

Pills are placed in edge order, so earlier edges win ties — deterministic.

## The overhang allowance is 56 (was 24)

A pill may be this much wider than the longest segment of its own edge before it
gives up and relocates below the nodes. It is only a gate on *trying* the
segments — the collision check is the real arbiter — so a larger allowance never
places a pill on top of anything; it only lets a label wider than its run stay
on the wire it belongs to.

24 was set when the failure being fixed was a 6px overhang. It is far too tight
for a short dogleg. Measured over all 225 labelled edges the repo owns:

| allowance | labels that still detach |
|---|---|
| 24 | 25 |
| 32 | 23 |
| 40 | 13 |
| **56** | **7** |
| 72 | 3 |

The curve bends between 32 and 40 and flattens after 56. At 56 the seven that
still detach are the ones that genuinely cannot sit on a wire — two of them are
the 272px and 236px labels in `05-long-labels`, which is the case that exists to
produce them. Going further buys three more labels at the cost of pills 2.5×
the length of the segment they sit on, which stops reading as "on the wire".

Worth knowing when a label moves: `api.example.com` (needs 52) and `sync both
ways` (38) came back onto their wires at 56, so `products-api` and
`24-arrow-kinds` both changed for the better; `DynamoDB stream` (61) still
detaches.

## Detached labels share a baseline

The two fallbacks start from different places on purpose: a `relocated` pill
drops straight below its nodes, an ordinary one starts on its wire and steps
down 22 at a time, so it can stop early and stay near the wire it belongs to.

Once a pill has stepped past the nodes anyway, that distinction has bought
nothing and the two rules leave labels on the same row at different heights. In
`products-api` `DynamoDB stream` (relocated, starts at the node baseline) landed
at y=522 and `index updates` (not relocated, started on its wire at 473 and
stepped down three times) at 539 — 17px apart, which reads as sloppy rather than
deliberate. So after the search, a pill that ended up below the baseline is
pulled back up to it when that row is free.

This is what actually restored `products-api` when the allowance moved to 56,
and it improves diagrams the allowance never touched: the `×3` aggregate in
`21-logos` was stranded in open space below the diagram and now sits directly
under the node its edge leaves, 30px of canvas shorter.

## Flow badges (2026-08)

A `show flow` view draws a numbered badge on each step. Those badges were the
last annotation still *placed* rather than reserved, and they were closed as
fine one day before someone looked at `microservices#checkout` and found:

- badge **7** docked to the left of `decrement stock` and landing flush against
  `mark shipped`, so it read as numbering the wrong edge;
- badge **4** walked 18px out from its edge's start and coming to rest **on a
  neighbouring async wire** it had nothing to do with;
- in `18-flows`, a badge docked left of a pill that sat right of its wire —
  putting the badge back on the line it was labelling.

None of these overlapped anything the invariants assert, which is why they
survived a corpus sweep and a close-out. **Collision was the wrong test.** The
property a badge needs is *attachment*: it must read as belonging to one wire.

The policy now:

- **An edge with a pill** reserves one rect for both, pill width + 4 + badge.
  The annotation pass carves the badge off the end of that rect nearest the
  wire and hands the remainder back as the pill's `labelRect`, so the renderer
  and every obstacle set still see one rect meaning "the pill draws here".
- **An edge without a pill** reserves nothing extra. Its badge is a bead drawn
  centred *on* the wire, at the point nearest its own label dummy — the
  invisible 2px spacer every edge already carries, which ELK places at that
  edge's median layer. Widening that spacer instead was tried and reverted: it
  pushed the bead off to one side and rearranged whole diagrams
  (`12-flow-checkout`) that have no pills in them at all.
- **A flow view with no labels anywhere** does not switch the label machinery on
  just to anchor badges; each one sits at the midpoint of its own run.
- The badge is sized from the **full** flow's numbers, so stepping a flow one
  hop at a time still cannot move it.

Anchoring snaps to the nearest point **along** the polyline, not the nearest
vertex — the vertex is always a corner, and a badge in the elbow reads as
decoration on the turn rather than a number on the line.

`checkLayout` now asserts the property directly: no other edge may be closer to
a badge than its own. Run against the old placement code it reports six
violations across the corpus; the fix reports none.

## Rejected approaches (do not relitigate without a fresh reason)

| Approach | Why it lost |
|---|---|
| Anchor near the arrowhead ("what does this arrow do to its destination") | Tried; the midpoint feel was preferred. |
| Corner margins + horizontal-segment weighting | Caused detached pills in ordinary cases. |
| Rotate the pill 90° onto vertical wires | Implemented and reverted — reads worse than a plain detached label. |
| Perpendicular nudge off the wire | Measured on the case below: the wire threaded a ~50px gutter and a 42px pill plus margins needs essentially all of it, so nudging one way hit the other neighbour. Dead end *in tight gutters* — which is exactly when you'd want it. |
| A leader line on detached pills | **Tried and reverted** — and it is the idea this file previously recommended. The problem is where a detached pill lands: `relocate` puts it below *both* of the edge's nodes, so a line back to the edge's own midpoint has to cross one of them. On `microservices#orders-pci` it drew straight through the Orders node and the Catalog card, which reads worse than the ambiguity it was meant to fix. It would need routed leaders, which is a feature, not a tweak. |
| Converting flow badges to ELK `HEAD` labels | **Spiked and measured**, after the close-out reason first recorded here ("their placement has never produced a collision") turned out to be the wrong test — see the **Flow badges** section for what actually broke. `HEAD` does fix attachment: ELK reserves the badge as its own label and parks it near the arrowhead, unambiguously on one wire. It costs more than it buys. The badge divorces from its pill — number and label end up at two heights on the same wire, so the reader joins two marks instead of reading one — and every badge becomes a layer element, which grew `18-flows` and put a gratuitous dogleg into `12-flow-checkout`. On unlabelled edges it also loses the bead-on-the-line reading, sliding each number off to the side of its wire. Reserving the badge *with* its pill gets the same attachment guarantee at no layout cost. |
| Relax the 4px node collision margin | Would fix near-misses (see below, which failed by **1px**) but the label then visually kisses the node border, and it loosens every tight placement everywhere. |

## Worked example: "views" in the dense-mesh lookbook case

The symptom that motivated the current step 1–2. Catalog → History is a
five-segment dogleg. The old code considered **only the longest segment** — a
112px vertical run at x=344 — and tried nine positions along it. All nine
failed: that run threads the gutter between Email (right edge x=320) and Fraud
(left edge x=370). The wire has 24px clearance, but a 42px pill centred on it
reaches x=323, one pixel inside Email's 4px margin; and because the segment is
vertical, sliding along it only changes y, while Email spans the whole middle
of the run. So the pill detached to the bottom of the canvas.

Meanwhile **three of that edge's other segments were completely clear**,
including a 64px run at (383, 250) — where the label now sits.

The sketch variants never showed the bug: Caveat's metrics make nodes wider, so
ELK routes that edge with three segments instead of five and its longest run
happens to be clear. Coincidence of geometry, not a better code path — a
reminder that "it looks fine in one theme" proves nothing here.

## If it happens again

- Dump the geometry first (edge points, segment lengths, which obstacle blocks
  each candidate) before touching the policy. Every wrong turn above came from
  changing the policy on a hunch.
- The leader-line idea that used to sit here — draw a detached pill the dotted
  leader notes use — has now been tried and reverted; see the rejected-approaches
  table for why it does not survive where a relocated pill actually lands.
