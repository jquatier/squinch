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
