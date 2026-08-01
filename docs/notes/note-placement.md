# Note — note placement

Engineering notes, not requirements (the *rules* live in DESIGN §5). Sibling of
`edge-labels.md`, which covers the pills on edges; this one covers `note`.

Notes were the last annotation layer with no obstacle avoidance at all. They are
drawn last, so a collision was maximally visible — the note painted over the
thing it collided with. Three shipped examples were broken when this was written,
including the golden: a `right-of db` note sat on a context card in
`microservices`, `storefront` and `landscape` alike.

## The policy

Per note, in declaration order:

1. Obstacles are all nodes, frames, zones, every edge-label pill, every zone
   chip, every flow badge, a reserved band for the legend/titleblock, and every
   note already placed.
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
3. If nothing on the ladder is clear, keep travelling in the authored direction,
   bounded at 50 steps. A note may leave the cluster entirely: the dotted leader
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

## Known residual

The legend and titleblock are drawn *after* notes but positioned from the final
canvas height, which is circular. The reserved band is computed from the
pre-note height. A note that then grows the canvas pushes the footer down with
it, so the two do not collide — but the reservation is an approximation rather
than an exact rect, and if that ever bites, the fix is to move annotation
placement into layout so the size fixpoint is explicit (see the plan note in
`docs/PLAN.md` on `Positioned`).

## Diagnosing the next odd note

Dump the geometry before touching the policy — the candidate list, and which
obstacle rejected each candidate. Every wrong turn above came from changing the
policy on a hunch and looking at one picture.

`packages/core/test/notes.test.ts` sweeps every diagram in the repo and asserts
no note overlaps a node, a pill or another note. It keys on the `data-note`
attribute rather than on the note's shape, deliberately: the pill check in
`golden.test.ts` infers pills from `height="18" rx="2"` and would have silently
stopped asserting if that shape ever changed.
