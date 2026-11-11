# Note — note placement

Engineering notes, not requirements (the *rules* live in DESIGN §5). Sibling of
`edge-labels.md`, which covers the pills on edges; this one covers `note`.

Notes were the last annotation layer with no obstacle avoidance at all. They are
drawn last, so a collision was maximally visible — the note painted over the
thing it collided with. Three shipped examples were broken when this was written,
including the golden: a `right-of db` note sat on a context card in
`microservices`, `storefront` and `landscape` alike.

## Edge-anchored notes are layout citizens (2026-08)

`note on a -> b` rides its own edge into ELK as a second inline label, so the
gap is sized for the pill *and* the note (`Positioned.noteBoxes`). The two
things that used to be placed at the same midpoint can no longer fight over it.

Corrected 2026-11: this section used to say the note "no longer goes through
the resolver at all" and is drawn in the reservation. It never was. An inline
label is centred *on* its wire, and the resolver's first ladder pass has always
run for a reserved note — which is what stands it beside the wire, inside the
gap the label made. That is the behaviour worth having, so it is the stated
one now: the ladder first, the reservation when no rung is clear. What the
ladder lacked was wires as obstacles: its standoff is horizontal, so on a
dog-leg's cross run "16px off the wire" was still on it, and `p99 8ms` in
lookbook 10 covered the corner.

## Node-anchored notes reserve their room on the anchor (2026-11)

`right-of`/`left-of`/`above`/`below` are layout citizens too, by a different
mechanism: the note's room is an invisible **outside label on its anchor's ELK
node** — the trick a card already uses to reserve its stacked sheets, and the
only way ELK learns a node's margins (a value set on `elk.margins` is
discarded). The room is part of the node, so it exists wherever the node is: at
the root, inside an expanded frame, inside a zone. The compound grows to hold
it.

What this replaced, and why it had to go:

- **The resolver could not serve a framed or zoned anchor at all.** Frames and
  zones sat in its obstacle list as filled rects, so no spot inside one was ever
  clear, and ELK packs a compound to its padding, so there was no gap to find
  even with the rect removed. Every such note left its compound: `right-of
  svc.orders` landed 110px up, above the zone and on a wire; `below svc.pay`
  landed to the *right* of the zone. No corpus diagram had a note inside a
  compound, so nothing failed.
- **`above`/`below` layer nodes (2026-08) are gone.** A note node with a
  directed invisible edge only fixed the note's *layer*; within the layer it
  sorted last by model order, so ELK put `above q` 300px to the right of `q`.
  Nobody saw it, because the resolver's first ladder pass ran anyway and
  overrode the reservation — the reserved space inflated the canvas and stayed
  empty, and the note was drawn by the ladder, which ignored wires. Zoned
  anchors took this path too (the guard checked `frame`, never zones), which
  parked the note 4px outside the zone wall.

The mechanics, all in `leafChild` and the resolver's `room` branch:

- **A face no wire uses**: the label is the note plus its 24px gap, centred on
  the face (`OUTSIDE H_RIGHT V_CENTER` and so on). Centred along a face, the
  room is capped at the face's own length — a note 15px wider than its node
  reserved 8px a side, and ELK paid for them by jogging the node's own wire
  rather than moving the next column (lookbook 10). The overhang is at most 40
  a side.
- **A face wires do use** (`above` a node fed from the top): a centred note
  would sit on them. The label runs from the face's start to one note-width
  past its end (`V_TOP H_LEFT`, width `node + 8 + note`), and the resolver
  draws the note 8px past the last port on that face — known only after
  layout, always inside the room.
- **Row-mates share the margin.** ELK sizes a layer to its deepest
  node-plus-margins and clamps each node inside its own, so a node with a note
  below it sat 26px above its row-mates. The mates get an empty label of the
  same depth on the same face. Which nodes are mates is ELK's decision, so a
  first pass reads the layers off the result and `layoutView` runs again with
  the margins in (`shared`). Only a view with a note along the flow, on a node
  that shares its layer, pays for the second run.
- **The room is stored relative to the anchor**, not absolutely: `align` moves
  nodes after ELK.
- **The resolver checks the room before using it.** The one thing the
  reservation cannot see is a coplanar wire — drawn after ELK, straight off the
  face — and an earlier note. Then the ladder below runs as it always did.

Rejected on the way:

| Approach | Why it lost |
|---|---|
| Frames and zones as walls, nothing else | Necessary (it is in the resolver now) but not sufficient: a compound has no spare room inside, so the note still left it. |
| Mirror the margin on the anchor's opposite face | Keeps the row straight, but spends a second empty band — 51px above a node whose note is below it. Sharing the margin with the row-mates spends nothing the note does not use. |
| `elk.alignment` on the row | Aligns tops or bottoms, not both: a row with one `above` note and one `below` note cannot be satisfied, and it re-aligns unequal neighbours that had no note. |
| Full-width room for a centred note | The 8px wire jog above. |

Still on the resolver: corners (canvas chrome), a note anchored to an
**expanded container** (its frame is the anchor; it gets no reservation, so
next to a zone wall it can still be pushed outside the zone — it used to be
dropped silently, which was a lookup that only knew nodes), and any note whose
room turned out to be taken.

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
residual that the layer-note and edge-note conversions have already shrunk
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
than an exact rect, and if that ever bites, the fix is to move annotation
placement into layout so the size fixpoint is explicit (see the plan note in
`docs/ENGINEERING.md` on `Positioned`).

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
