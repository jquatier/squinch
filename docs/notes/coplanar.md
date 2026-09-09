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
