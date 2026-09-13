# Note — `wrap N`, and why a hand-written fold cannot be fixed by routing

Engineering note, not a requirement. `wrap N` (SPEC §6, Tier 0) folds the two
graph shapes that have no aspect-ratio control of their own: a single chain, and a
single source fanning out to leaves. This records what was measured (2026-09) so
the alternatives are not rebuilt from memory.

## The problem it answers

A 15-step chain renders 224×1808 flowing down, or 2848×128 flowing right. A
12-way fan-out renders 2512 wide. Folding the fan by hand with `rows [gw] [w1 …
w6] [w7 … w12]` gives 1662×442 — and the second band's six edges detour around
the first band's cards with long horizontal runs, so the fold reads worse than
the wide version. **The routing of the folded band is the problem, not the
syntax**, and it is structural: with `forceNodeModelOrder`, ELK places the
long-edge dummies for band 2 at the *ends* of layer 1, and node placement then
pushes band 2's cards outward around band 1. No routing option moves those
dummies. The fix is to hide the band-skipping edges from ELK entirely — the
engine's own co-ranking mechanism, coplanar.md — and draw them afterwards. That
is only safe when the engine knows the shape, which is what `wrap` declares.

## What it does

- **Shape detection** runs on the *view's* graph (the model never sees
  scope/only/expand). Exactly two shapes fold; anything else warns with the
  `rows` line to write by hand — a knob that silently does nothing is the defect
  `routing-hints.md` records reverting `around` for. A fold that would leave a
  single band warns too.
- **Chain → serpentine.** Bands alternate direction; each folded node gets a
  *column-mate* scaffold feeder (the node above it in the previous band) rather
  than "the first node of the rank above", which is what makes the bands a grid
  and right-aligns a short reversed last band. The hop between bands is a
  one-column vertical. In-band edges are the existing coplanar router.
- **Fan → bus.** The edges from the source into band ≥ 2 are hidden from ELK;
  the column-mate scaffold ranks their targets. The router then draws one spine
  down band 1's middle gap, one trunk per band in the inter-band gutter, and a
  drop into each target. "Inside" is a proven property, not a hope: the spine
  must sit in the gap, on the source's face, ≥ 12px from every port on that
  face, with a corridor clear of nodes and no ELK segment crossing it; otherwise
  the bus takes an outside lane past the widest band. Odd band widths (the gap
  is off the face), `direction right` (the band-side face is the card's 64px
  height) and labelled band-1 edges (ELK's label dummies bend a stub across the
  spine) all land on the lane, cleanly.
- Two ELK options are wrap-scoped: fan views use `nodePlacement.strategy:
  SIMPLE` (NETWORK_SIMPLEX parks a 6-way source over the third target, since any
  position between the two median targets costs the same; SIMPLE centres each
  layer), and the source goes `FIXED_ORDER` with an `elk.port.index` per port so a
  reserved slot for the spine sits in the middle of its face — an unconnected
  port under `FIXED_SIDE` sorts to the end of the face (measured).

## What was tried and rejected

| Approach | Result |
|---|---|
| Hub-in-the-middle for the fan (`rows [w1..w6] [gw] [w7..w12]`) | ELK's cycle breaker reversed five of six upward edges the right way and sent one worker to the bottom band with a wraparound wire. A fold that depends on cycle-breaking choices is not one to ship. |
| Left-to-right bands with a return wire, for the chain | Same canvas as the serpentine, but the hop runs the diagram's width, and three-plus bands stack parallel return wires in every gutter. Arrows are directional, so a reversed band is unambiguous. |
| SIMPLE node placement on chains | Centres the short last band and turns the last hop into a long wire; column-mate scaffolds under NETWORK_SIMPLEX keep it column-aligned. Fans only. |
| DESIGN §4's 16px port spacing for the spine | Not reachable on a 120px face with seven stubs — ELK's own six already sit 15 apart there. The router's bar for the spine is 12. |

## Not built

An opt-in for hand-written `rows` folds. The bus needs to know which edges skip
a band and where a spine may run; applying that to every existing two-band fan
would move shipped renders. The natural spelling if it is ever wanted is the
mirror of `channel` — `channel gw -> w7, w8, w9` — reusing the bus router.
