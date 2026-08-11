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

**Deliberately not built: interior routing** (the wire navigating from the
leaf through the frame's inside). The interior is ELK's territory on both
axes — every interior spacing constant was tuned for ELK's own edges, and a
foreign wire through them re-opens the stub violations that took a gate cycle
to close. Wall-to-wall with leaf-height entries gets the read ("orders calls
catalog, at this row") for a fraction of the machinery; most frame interiors
are one column wide, so the entry visually sits beside its leaf anyway. No
revisit trigger while ELK owns interiors. Same-rank **zone** pairs keep the
warning (a dashed zone boundary is not a wall a wire can enter); the router's
unit-rect shape accepts zone rects if a real diagram ever needs it.

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
