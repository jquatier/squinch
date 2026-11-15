# Note — note placement

Engineering notes, not requirements (the *rules* live in DESIGN §5). Sibling of
`edge-labels.md`, which covers the pills on edges; this one covers `note`.

Notes were the last annotation layer with no obstacle avoidance at all. They are
drawn last, so a collision was maximally visible — the note painted over the
thing it collided with. Three shipped examples were broken when this was written,
including the golden: a `right-of db` note sat on a context card in
`microservices`, `storefront` and `landscape` alike.

> **Updated 2026-11 for the weft engine.** How a note's room is *reserved*
> changed with the engine and the two sections below are rewritten; the
> ELK-era mechanics (outside labels on the anchor's node, margins shared with
> row-mates, a second layout run, note layer-nodes) are gone and are in git:
> `git show c95ab03~1:docs/notes/note-placement.md`. The resolver's policy,
> the rejected approaches, the leader rule and the residuals did not depend on
> the engine and are unchanged.

## Edge-anchored notes are layout citizens (2026-08)

`note on a -> b` shares its edge's label reservation: the planner asks the
engine for one rect on the wire big enough for the pill *and* the note
(`reserve` in `layout/plan.ts`), so the two things that used to be placed at
the same midpoint cannot fight over it. The engine centres that rect on the
wire; the dresser (`layout.ts`) then keeps the pill in the middle and gives
the note the room to one side — east of a wire running down, south of one
running rightward.

The resolver still runs for a reserved note: the room is where the note goes
if nothing the engine did not place is in it, and the ladder below is what
stands it beside the wire otherwise. The ladder treats wires as obstacles —
its standoff is horizontal, so on a dog-leg's cross run "16 px off the wire"
was still on it, and `p99 8ms` in lookbook 10 once covered the corner.

## Node-anchored notes reserve their room on the anchor (2026-11)

`right-of`/`left-of`/`above`/`below` are layout citizens too. The note's room
is **clear space beside its anchor's wall** — `Box.room` on the engine's
contract, as deep as the note plus its 24 px gap and as long as the wall.
Nothing enters it: no other box, no lane, no label, no wire but the anchor's
own on that wall, and the container's walls stay outside it. So the room
exists wherever the node is — at the root, inside an expanded frame, inside a
zone — and the frame or zone grows to hold it.

Why reservation, and not the resolver alone: frames and zones are walls to
the resolver, and a container is packed to its padding, so for an anchor
inside one there was no clear spot to find. Every such note left its
container — `right-of svc.orders` once landed 110 px up, above the zone and on
a wire. No corpus diagram had a note inside a container, so nothing failed
until one was written.

What the reservation guarantees, and what it leaves to the resolver:

- **The room is not part of the box.** The anchor's rectangle, its ports and
  its balanced place are computed as if the room were not there
  (`layout-engine.md` §2). A node does not move off the middle of its fan
  because it has a note.
- **A face wires also use** (`above` a node fed from the top): the note
  stands past the last port on that face, known only after layout; the
  dresser extends the room that far and the resolver places the note 8 px past
  the last wire.
- **The room is stored relative to the anchor**, not absolutely.
- **The resolver checks the room before using it** — a pill, a badge or an
  earlier note can be in it — and otherwise runs the ladder as it always did.

Rejected on the way (under either engine):

| Approach | Why it lost |
|---|---|
| Frames and zones as walls, nothing else | Necessary (it is in the resolver) but not sufficient: a container has no spare room inside, so the note still left it. |
| Mirror the room on the anchor's opposite face | Keeps a row straight, but spends a second empty band — 51 px above a node whose note is below it. |
| Making the room part of the node | Ports move to the inflated face, and the node is balanced on a centre that is not its own. |
| A note as a node of its own, tied to its anchor by an invisible edge | It fixed the note's rank and nothing else: within the rank it sorted last, 300 px from its anchor. |

Still on the resolver alone: corners (canvas chrome), a note anchored to an
**expanded container** (its frame is the anchor; it gets no reservation, so
next to a zone wall it can still be pushed outside the zone), and any note
whose room turned out to be taken.

## The policy (the resolver, for everything not reserved)

Per note, in declaration order:

1. Obstacles are all nodes, every wire, every edge-label pill, every zone
   chip, every flow badge, a reserved band for the legend/titleblock, and every
   note already placed. A frame or a zone is a **wall**, not an obstacle: a
   note may be wholly inside one (below a frame's title strip) or wholly
   outside it, never across the border.
2. Candidates are tried in order and the first clear one wins, at the standing
   4px margin.
   - **`right-of`/`left-of`/`above`/`below`** — gap `24 → 48 → 72 → 96` from the
     anchor; at each gap, slide along the anchor's other axis by `0, ±16 … ±240`,
     nearest first. **The authored side never changes.**
   - **`on a -> b`** — standoff `16 → 40 → 64` from the wire; at each standoff,
     slide along the polyline by arc-length fraction `0.5, 0.42, 0.58, …`, the
     same ladder the pills walk, so a note and its own pill spread rather than
     stack.
   - **corner** — a short slide along the edge it is pinned to (≤4 steps), then
     *outward* off the canvas, which grows the diagram.
3. The ladder is walked three times, loosening one axis at a time: candidates
   fully inside the canvas, then candidates inside it *horizontally*, then
   anything. Growing the canvas is sometimes unavoidable — a `below` note on the
   bottom row has nowhere else to go — but extending downward reads as the
   diagram getting taller, while sliding off the left edge shifts every other
   element sideways to make room. Taking the first clear candidate in ladder
   order did the latter, and widened a diagram by 200px to park a note in the
   margin.
4. If nothing on the ladder is clear, walk it again with wires allowed — a note
   on a wire still beats one that crossed the diagram to avoid it — and only
   then keep travelling in the authored direction, bounded at 50 steps. A note
   may leave the cluster entirely: the dotted leader
   keeps it attached, which is the property `edge-labels.md` wishes pills had.

Notes are placed in declaration order and each joins the obstacle set, so an
earlier note wins a contested spot — deterministic, the same tie-break as pills.

## Rejected approaches (do not relitigate without a fresh reason)

| Approach | Why it lost |
|---|---|
| Flip to the opposite side when the authored side is full | Contradicts the source. `right-of` means right-of; a reader who wrote it and got a note on the left has been overruled by the tool. |
| Step corner notes diagonally inward | Implemented and reverted. A corner note is chrome — it means "pinned to the frame" — and stepping inward read as a note that had lost its corner and was floating in the middle of the diagram. |
| Slide corner notes freely along their edge | Implemented and reverted. With enough travel `bottom-right` ended up to the *left* of `bottom-left`; the two had swapped. Corners now slide at most 4 steps, then grow the canvas instead. |
| A slide range of ±128 | Too small to clear a neighbouring **card** (88 tall, and wider than a node). A note beside a crowded column exhausted the ladder, fell through to the travel fallback and set off sideways across the diagram, trailing its leader over everything in between. ±240 keeps it on the authored side with a short leader. |
| Perpendicular nudge / relaxing the 4px margin | Already rejected for pills; see `edge-labels.md`. Both apply here unchanged. |
| An offset or coordinate escape hatch in the DSL | SPEC §5: "the no-coordinates principle applies to notes too." |

## The leader attaches at the nearest point, not a fixed side

Each end of the leader is the point on that rectangle nearest the other box.
It used to be the midpoint of whichever side the anchor keyword named, which
was right while a note always sat exactly beside its node — but once notes
slide up to 240px to dodge obstacles, a note well below its anchor still had
its leader leaving the node's right edge dead centre, reading as a diagonal
fired out of the right-hand side.

An edge note's leader ends at the nearest point of its wire, not the wire's
midpoint (2026-11): beside a dog-leg's last vertical run, the midpoint is back
on the cross run and the leader was a long diagonal to it.

Clamping is a no-op for a note still level with its anchor, which is why the
`landscape` golden and the `storefront` example did not move when this landed:
only notes that had actually slid changed.

## Known residuals

**Leader lines are not collision-checked — and will not be.** Decided
2026-08, favouring less owned code: routing leaders means segment/rect
intersection plus a detour policy, net-new geometry machinery for a cosmetic
residual that reserving room for notes has already shrunk
(their leaders are short verticals now). If a leader ever reads truly wrong,
reopen with a picture, not a hunch.

**Historical note:** The note *box* avoids everything;
the dotted line back to its anchor can still cross a label pill or a card. It is
1px and dotted so it reads as passing behind rather than colliding, but a leader
crossing a pill can make the pill's text look struck through. Routing leaders is
a real feature, not a tweak — it would need segment/rect intersection and a
detour policy — so it is deliberately not attempted here.

The legend and titleblock are drawn *after* notes but positioned from the final
canvas height, which is circular. The reserved band is computed from the
pre-note height. A note that then grows the canvas pushes the footer down with
it, so the two do not collide — but the reservation is an approximation rather
than an exact rect, and if that ever bites, the fix is to make the size
fixpoint explicit in `layout.ts`, where annotation placement already lives.

**Corner notes sit closer to the content than they used to** (2026-11): the
weft engine's canvases are tighter than ELK's were. Nothing overlaps — the
resolver still grows the canvas when a corner is taken — but there is less
air. Recorded as a known weak spot in `layout-engine.md` §8.

## Diagnosing the next odd note

Dump the geometry before touching the policy — the candidate list, and which
obstacle rejected each candidate. Every wrong turn above came from changing the
policy on a hunch and looking at one picture.

`packages/core/test/notes.test.ts` sweeps every diagram in the repo and asserts
no note overlaps a node, a pill or another note; `checkLayout` adds that no
note straddles a frame or zone wall or sits on a wire, and the same file holds
the framed and zoned cases the corpus never had. It keys on the `data-note`
attribute rather than on the note's shape, deliberately: the pill check in
`golden.test.ts` infers pills from `height="18" rx="2"` and would have silently
stopped asserting if that shape ever changed.
