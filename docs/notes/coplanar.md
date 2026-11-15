# Note — same-rank edges, and why they once needed a router of their own

> **Superseded (2026-11).** This note recorded the "coplanar router": the
> second router that drew same-rank edges beside ELK, the scaffold edges that
> held declared ranks, and seven "approaches" that extended the pair to
> frames, zones and per-container direction. All of that machinery is gone —
> the layout engine is now `weft`, where a rank is a constraint and one router
> draws every wire ([`layout-engine.md`](layout-engine.md)). The body has been
> cut to what is still true. The full text, with every ELK option that was
> measured, is in git: `git show c95ab03~1:docs/notes/coplanar.md`.

## What still holds

**Two connected nodes may share a row, and that is a language feature.**
`rows [a b]` with `a -> b` is the most ordinary hint there is. Neighbours join
straight across the gutter between them; a wire that reaches past a row-mate
goes round under the row; a mutual pair takes two places on the facing walls,
one wire above the other, never one line with two arrowheads. This holds at
the root, inside an expanded container and inside a zone, and the wire always
ends on the leaf it names.

**A wire lands on a table's head, never on a field row.** A leaf drawing its
`fields` is a 64 px head with rows under it; a wire on a row reads as pointing
at that field. The planner tells the engine how much of the side walls may
take a wire (`Box.face`), `checkLayout` asserts it on every wire's own end
("lands on a field row"), and `packages/core/examples/fields-wires.squinch` is
the fixture. A 64 px face holds three wires at 16 px pitch, exactly as a plain
leaf does. In a row that holds a table, boxes are top-aligned so heads line
up and a same-row wire can run head to head.

**A mutual pair nobody pinned is two ranks.** `a -> bus` and `bus ~> a` with
no `rows` anywhere: cycles are broken in declaration order, so the
first-declared edge keeps its direction and the other runs back up
(`lookbook/cases/42-mutual-pair`). A pair the author pins to one row stays on
it.

## Why ELK could not do this — the one-paragraph record

ELK's layered algorithm is Sugiyama layering, in which a layer is by
definition a set of nodes with no edges between them. No option puts two
edge-connected nodes on one rank. Four ways of making it were measured in
2026-08 and all failed: handing it the same-rank edges (ranks collapse; 9 of
117 corpus views went portrait); `elk.partitioning` (a partition is a band,
not a layer); the interactive layerer seeded with coordinates (still one layer
per node of a chain); a synthetic rightward compound around the row (a child's
direction is ignored under `INCLUDE_CHILDREN`). So same-rank edges were hidden
from ELK and drawn afterwards, and every feature since needed a second code
path. The symptoms that followed — wires stopping at a container's wall,
bands ELK split in two, a mutual pair tied on one rank by accident, labels on
crossings — are listed in `layout-engine.md` §1 as the reasons the engine was
replaced.
