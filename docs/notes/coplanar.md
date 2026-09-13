# Note — why same-rank edges bypass ELK

The coplanar router (96 code lines in `layout.ts`, of ~1500) is the one place
the engine does its own edge geometry, and it is the reason "ELK owns the
layout" is not quite true — every annotation feature since has needed a second
code path for it. That is a real tax, so the question "could ELK just do this?"
is worth asking. It has now been asked and measured, four ways.

**It cannot, and the reason is structural.** In Sugiyama layering — which is
what `elk.algorithm: layered` implements — a *layer* is by definition a set of
nodes with no edges between them. Any edge whose endpoints you want on one rank
is a contradiction in terms, and no option resolves it.

## What was measured (2026-08)

| Approach | Result |
|---|---|
| **Hand every same-rank edge to ELK** (delete the router) | Ranks collapse. 9 of 117 corpus views contain a coplanar edge; every one goes portrait. `09-coplanar-row` 1102×180 → 336×808. `products-api` — the README hero — 850×570 → 411×922. The `rows` hint is silently discarded, and worse than the shape: `rows [catalog orders accounts]` redraws three peer services as Order Service *above* the other two, asserting a dependency the model does not have. Geometry stays legal (one invariant violation corpus-wide), so nothing would have caught this but looking. |
| **`elk.partitioning`**, partition = rank index | A partition is a *band*, not a layer. An edge inside one splits it into several layers, so peers stack exactly as above. |
| **`layering.strategy: INTERACTIVE`** seeded with coordinates | Six chained nodes seeded all-x-equal, all-y-equal, and all-at-origin each produced six layers. The interactive layerer derives layer *order* from coordinates; it still refuses to put edge-connected nodes together. |
| **Wrap the row in a synthetic compound laid out `RIGHT`** | The most promising, and the closest to working. Under `hierarchyHandling: INCLUDE_CHILDREN` — which the rest of the engine needs — a child's `elk.direction` is ignored outright and the row lays out downward anyway. Forcing `SEPARATE_CHILDREN` on that compound does produce a horizontal row (1060×106), but two things break: members land on **four** different baselines (up to 42px of jitter, because node placement staggers them to route the skips) where our router puts them on one, and an edge from outside can no longer address a row member — it must attach to the compound's border. Most edges in a real diagram cross ranks, so that trade is worse than the router. |

## Approach #5: wall-to-wall between expanded frames (2026-08, adopted)

`expand *` made a new collision inevitable: `rows [catalog orders accounts]`
with all three expanded and orders *calling* the other two. The cross-frame
edge could not be classified coplanar (the router only knew bare leaves), so
it stayed in ELK's graph and ELK re-layered the frames apart — the row broke
with a warning whose only advice was to stop asking.

The fix is the same mechanism the router has always been: **classifying an
edge coplanar (hiding it from `elkEdges`) is the entire co-ranking machinery**
— there is no same-layer constraint anywhere else; scaffold edges are lower
bounds only. Hide the edge and the frames co-layer naturally. The router then
draws the wire between the two *outermost frame rects*, wall-to-wall:

- **straight** through the gutter when both wall entries agree (the entry sits
  at the interior leaf's height, clamped into the pair's shared cross-overlap
  band — frames on one layer are top-aligned with unequal heights);
- a **4-point jog** at mid-gutter when they don't (each stub ≥ gutter/2 ≥ 24);
- the **shelf** below the row when another unit sits between (bandEdge measured
  over unit rects — frame borders, not the leaves inside them).

Labelled gutters are reserved pre-ELK exactly as leaf gutters are — spiked:
`elk.spacing.individual` **is honoured on a compound under
`INCLUDE_CHILDREN`** (48 → 140 on request; `elk.margins` is not). Wires carry
`coplanar: true` and the invariant sweep asserts a router wire crosses no node
or non-endpoint frame rect — strict interior penetration, walls are legal.

**Deliberately not built: interior routing** (the wire *navigating* from the
leaf through the frame's inside). The interior is ELK's territory on both
axes — every interior spacing constant was tuned for ELK's own edges, and a
foreign wire jogging through them re-opens the stub violations that took a
gate cycle to close. Approach #5 stopped at the wall on the grounds that most
frame interiors are one column wide, so the entry visually sits beside its
leaf anyway. Approach #6 below keeps the "never navigate" half of that and
drops the "stop at the wall" half.

## Approach #6: zones are units too (2026-09, adopted)

Approach #5 turned same-rank **zone** pairs away with a warning, on the
grounds that a dashed zone boundary is not a wall a wire can enter. That
reason did not survive the first real diagram: ELK's own wires enter zones
constantly (every cross-rank edge into a namespace does), and lookbook
`27-k8s` — two namespaces, `rows [batch orders]`, one `reads` edge between
them — silently stacked the zones with a warning whose only advice was to
stop asking. SPEC §zones had promised `rows` could pin a zone all along.

The first half is the four lines the sentence above predicted: the coplanar
filter no longer excludes zoned endpoints, `routeRect` resolves a zoned leaf
to its *outermost* zone's rect, and the zone compound carries the same
labelled gutter reservation a frame does. The warning is deleted rather than
reworded — after the change no same-rank pair is unroutable, so there is
nothing left for it to say. Measured against the whole gallery corpus (162
views): zero renders change, because the only edges whose classification
moves are the ones that used to warn, and none of the shipped diagrams
carried one.

That alone was rejected on sight. A zone wrapping an expanded frame stacks
two paddings plus the frame's own column, so the `reads` arrow ended on the
namespace boundary some 160px from the service it named — the wall-stop
compromise that was tolerable for a one-column frame is not tolerable
through two boundaries. So the second half is **the inward corridor**: after
the gutter geometry is fixed (entry heights, straight or jog, pill on the
gutter run between the two unit walls), each end walks from its unit wall to
the leaf's own wall **when the straight corridor between them is provably
empty** — no node but the leaf, no frame that does not enclose it, ±16 on
the cross axis; zone rects are not obstacles, ELK's wires cross them too.
Otherwise the wall stays the end, exactly as #5 drew it. The wire never jogs
inside a compound: that is the line between "extend through space proven
empty" and the interior navigation still deliberately unbuilt.

Two consequences, both measured before adoption. The port moves with the
end: a wire that reaches the leaf registers on the leaf's face, so parallel
wires into one leaf spread *there* (the prototype that spread them at the
wall had two Catalog API arrivals converge on one point after it). And the
entry height is the leaf's own, clamped into its unit rather than into the
pair's shared band — #5's shared clamp is what would park a low leaf's entry
at the wrong height and stop the corridor from ever reaching it; the jog
handles any pair of heights. Corpus impact: 2 of 162 views, both the #5
frame cases (`examples/microservices` full and lookbook `32-coplanar-frames`
row), and in both the before had arrowheads stopping in frame padding beside
the wrong card. The invariant sweep gained a rule with it: a router wire's
ends sit on a boundary — the leaf's, an enclosing frame's, or a zone's.

Still unbuilt, with the same reasoning: the shelf (a unit *between* the
pair) keeps exiting from the unit's far wall, because reaching a leaf from
below would cross interiors vertically.

## What this means for the router

It is not polish, and it is not there because ELK's routing is inadequate — it
is what makes `rows` a language feature rather than a suggestion. The
prerequisite for deleting it is dropping or redefining `rows`; that is the
decision, and the router is downstream of it.

Its scope is also narrower than it feels. Coplanar edges exist **only** because
a rank was declared: without `rows`/`place`, an edge always puts its endpoints
on different ranks naturally, so there is nothing for the router to do. Nine
corpus views out of 117 exercise it at all.

The cost to keep honest is the second code path. When adding anything that
attaches to an edge — labels, notes, flow badges — the coplanar case needs its
own answer, and it is the one most likely to be forgotten because most views
never hit it. The pattern that has worked is to make the router *report the same
shape* ELK does (`labelRect`) rather than to special-case it downstream.

## Levers inside a compound (2026-09, measured against elkjs 0.12)

Interior hints (`rows`/`cols`/`place` naming leaves inside an expanded frame, and a
container's own `layout { }`) needed ELK to honour an order *inside* a compound under
`hierarchyHandling: INCLUDE_CHILDREN`. What was tried, so it is not tried again:

| Lever | Result |
|---|---|
| Child model order (the order `framedChildren` hands ELK) | **Not** the in-layer order inside a compound. Four permutations of a compound's children produced identical output; the row followed the feeding node's *port* order. `considerModelOrder`/`forceNodeModelOrder` are read per graph and never inherited into a child graph. |
| `considerModelOrder` / `forceNodeModelOrder` set on the compound itself | **Crashes** ELK's model-order comparator on the border-port dummies (`Cannot read properties of undefined (reading 'a')`) — every variant, `PREFER_NODES` included; `PREFER_EDGES` survived a toy and crashed on anything with two layers. `crossingMinimization.strategy: NONE` throws `UnsupportedGraphException`. |
| `crossingMinimization.semiInteractive: true` on the compound + `elk.position` on its children | **Works**: honoured for fans, disconnected leaves, two feeders, two layers at once, `direction right` (transpose the position axis) and nested compounds. One exception: a frame's *entry* layer (members fed only from outside it, via the border-port dummies) ignores positions and follows the compound's child model order instead — so the engine pulls both levers. |
| Invisible scaffold edge between two interior leaves | A rank lower bound inside the compound, exactly as at the root; no side effects in the corpus. Carries the frame-interior spacer under the label scheme. |

The engine engages these only for a frame that carries a hint relating two or more of
its members (`frameOrder`), which is what keeps every unhinted render byte-identical —
switching a frame to semi-interactive replaces ELK's interior order with declaration
order, and that must never happen uninvited. Naming a single member is how you rank
the whole frame from the root, and stays exactly that.

## Approach #7: per-container direction on hierarchical ports (2026-09, adopted)

Attempt 4 in the table above stopped one step short. Under `INCLUDE_CHILDREN` a
compound's own `elk.direction` is ignored outright (re-measured: byte-identical
geometry with and without it), and `SEPARATE_CHILDREN` on that compound does give
it a direction of its own — at the cost that an edge from outside can no longer
address a member inside, because a run cannot see ports inside another run
(`UnsupportedGraphException`). Re-targeting the edge at the compound was the
recorded dead end: it attaches at the compound's centre, over the wrong leaf.

What nobody tried was ELK's own answer, the **hierarchical port**: a `FIXED_SIDE`
port *on* the compound's wall, the outside edge ending there, and a second edge
declared *inside* the compound continuing from that port to the leaf. ELK lays the
interior out on one baseline in the frame's own direction and routes wall → leaf
itself. The engine cuts every ELK edge into one segment per call it crosses
(`segments`), the segment in the pair's common container keeping the id, pill and
notes and the others carrying the invisible spacer; after layout the segments are
stitched back into one polyline (the join point appears twice, a straight run
through the wall as three collinear points; both dropped). With no directed frame
there is exactly one root segment per edge, one ELK call, and the graph built
before this existed — 165 of 165 corpus views byte-identical.

**Two ELK calls, not one.** The POC put the directed frame inside the single root
call as a `SEPARATE_CHILDREN` compound, and its probes passed. The first scoped
view with a `rows` line broke it: whenever the edge's other end lands *earlier* in
the next layer, the parent run drags the frame's EAST wall port to the west wall
(measured: `[0, 291]` for a port declared EAST at `[752, 291]`), and the interior
segment runs straight through the row. No port-constraint mode changes that
(`FIXED_ORDER`, `FIXED_RATIO`, `FIXED_POS` all measured). So each directed frame is
laid out first by a call of its own, deepest first — the frame as the one child
of a padding-less `SEPARATE_CHILDREN` wrapper carrying its direction, the frame
itself `INCLUDE_CHILDREN` with `FIXED_SIDE` external ports — and the root call is
handed a fixed-size leaf with `FIXED_POS` ports at the positions that produced.
Three more measurements fixed the shape of that: a root graph *with* ports crashes
elkjs 0.12's JSON import (`null.o`), hence the wrapper; a ported compound that is
itself included in the wrapper crashes the crossing-minimisation comparator when it
holds a nested compound (`undefined.a`), and run `SEPARATE_CHILDREN` instead it
drops every edge into that nested compound — `INCLUDE_CHILDREN` beneath a
`SEPARATE_CHILDREN` wrapper is the one combination that both routes and lands the
ports. And in the root call `forceNodeModelOrder` moves a `FIXED_POS` port off its
wall in exactly the target-to-the-left case (no per-node or per-port option
escapes it), so a view holding a directed frame swaps that option for
`semiInteractive` crossing minimisation with each root child's `elk.position` set
from the model order it would have been forced to — the interior pass's lever,
applied at the root, and only there, only then.

Two rules came out of measurement. **The wall port's side is per edge**: an edge
into the head of the frame's own interior (a leaf nothing inside feeds) enters on
the frame's flow side, and one out of its tail leaves on the flow side; anything
reaching a mid-chain leaf takes the outer side, so the enclosing run routes it as
it routes every other edge. Outer-only parked the entry at the top-left corner
with 80px of dead interior (a NORTH port on a RIGHT run becomes a layer of its
own at the far left); flow-only looped a mid-chain exit up and over the frame.
**The leaf-side port of an interior segment is on the frame's flow side** too —
carrying the outer side through made the interior 48px taller and ran the wire
along the title band.

One thing the layout cannot fix: a directed frame flush-left inside an undirected
one takes its entry through the enclosing frame's 16px left padding, which is the
strip the title sits in, so the wire crosses the title. Widening that padding only
moved the letter (the title moves with the frame); the outer side moved the
crossing one level in. The title cannot be an ELK obstacle, so it does what zone
chips do: a frame title any final wire segment crosses is flagged (`PFrame.titleCrossed`)
and the renderer draws it after the edges on a surface halo. Emitted only when it
happens, which is what keeps every other render byte-identical — and it turned out
three shipped views already had a wire through a frame title.

Still open: skip-edge baseline jitter is larger inside a directed frame (46px on
the probe) than at the root (11px) — ELK node placement on a skip edge, not the
compound; and a scoped view's own `direction` is the only override, an expanded
frame's direction is the container's.
