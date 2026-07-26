# Note — why `around` and `via` are not implemented

Engineering note, not a requirement. SPEC §6 Tier 2 lists three routing
constructs. `channel` shipped. `around` and `via` did not, and this records why
so the next person does not implement them twice.

## What `around` was supposed to fix

```squinch
route search -> idx around files      // "stop cutting through the S3 lane"
```

A hint for when the router drags an edge through, or uncomfortably close to,
something unrelated.

## Why it isn't there

It was implemented — grammar, model, and a post-layout detour that sends the
edge down a lane beside the avoided box — and then measured against real
diagrams before shipping:

| lookbook case | edges crossing an unrelated node | edges within 20px of one |
|---|---|---|
| `06-dense-mesh` (17 edges, 10 nodes) | 0 | 0 |
| `17-zones` (nested zones, frames) | 0 | 1 |
| `14-sidecar-routes` | 0 | 0 |

ELK's `ORTHOGONAL` routing avoids nodes reliably, with clearance. Deliberate
attempts to force a crossing all failed: a rank-skipping edge with a node
directly in line, a target directly below the obstacle, and a widened obstacle
box were each routed cleanly around.

So the hint would parse, appear in the docs and the agent skill, and then do
nothing on essentially every real diagram. That is the same defect `align` and
`cols` had for months — a construct the grammar accepts and the engine ignores —
and adding a fresh one to fix a problem the layouter does not have is a bad
trade. The implementation was reverted rather than shipped as a documented
no-op.

## When to revisit

Implement it the day a routed edge actually collides with something. Likely
triggers, none of which exist yet:

- a router of our own that does not do obstacle avoidance (the coplanar router
  keeps to lanes between bands, and `channel` trunks likewise — but a future
  Tier-2 addition might not),
- much denser graphs than the lookbook covers, where ELK runs out of room,
- `grid`, the fixed-placement escape hatch, which by definition overrides the
  layouter's spacing and can put a node on top of a wire.

The measurement above is one command, and it is the right first step next time:

```js
// for each edge, for each node that is not one of its endpoints,
// does any segment's bounding box overlap the node's (optionally inflated)?
```

`via <region>` is untouched for a related reason: it is the coarse-waypoint
version of the same idea, and there is no evidence yet of a route bad enough to
need steering.
