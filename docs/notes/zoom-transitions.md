# Moving between altitudes

**Status: settled.** The playground animates every view change as an *anchored
dive*. There is one motion, not a menu of them. Read this before adding another.

## The problem

Zooming from a landscape into a system replaces the whole picture. Five cards
become eight components, the layout is unrelated, and nothing on screen tells
you which of the five you are now inside. A hard cut makes the reader re-orient
from scratch every time — which defeats the point of having altitudes at all.

## The move

Both diagrams animate about **one shared anchor: the card being zoomed through**.
That card is the only element the two altitudes have in common, so it is the only
honest thing to pivot on.

Going down (`apps/spa/src/Stage.tsx`):

- the outgoing diagram scales up about the clicked card's centre, translated so
  that centre lands on the middle of the screen — the card grows to fill the
  viewport while everything else flies off the edges;
- the incoming diagram starts small *at the card's position* and settles to
  identity, so the detail appears to come out of the card you clicked.

Coming back up is the exact inverse, which is why one pair of expressions covers
both directions. The one asymmetry is finding the anchor: on the way down it is
the element you clicked, already measured; on the way up the card you are landing
on does not exist until the new SVG has mounted, so it is located by `data-path`
in the incoming layer.

Numbers that were tuned by eye, not derived:

| | | |
|---|---|---|
| `CAP` | 3.2 | Past ~3× the eye stops tracking and it reads as a jump cut. |
| `TRAVEL` | 0.62 | The incoming layer travels a fraction of the outgoing one. A full mirror overshoots and reads as two animations played back to back. |
| `DIVE.ms` | 460 | Long enough to follow, short enough to click through repeatedly. |
| easing | `cubic-bezier(.32,.72,0,1)` | Front-loaded: most of the distance is covered early, so the move feels fast but lands softly. |

## Mechanics worth knowing

- **Two layers.** The live layer is in flow and holds the current SVG; the ghost
  is an absolutely-positioned clone of the previous one, pinned where it was.
  The ghost is decorative and unmounts when the transition ends.
- **Transforms are applied imperatively.** A React re-render mid-animation would
  restart the transition.
- **Arm, then fire.** The trigger only freezes the current artwork; the animation
  starts when a *different* SVG arrives, because compilation is async. A timer
  clears the ghost if a navigation happens to render byte-identical output.
- **The ghost's ids are namespaced.** Two copies of one diagram are briefly on
  screen and SVG ids are document-global, so the live layer's `<use href="#…">`
  would otherwise resolve against the ghost's `<symbol>`.
- **`prefers-reduced-motion` cuts straight through.** Not a preference we get to
  override with a setting.

## Rejected

- **A motion picker.** Three modes were built and compared side by side: the
  dive; "match", where the outgoing diagram holds still and only the incoming
  one unfolds out of the card; and "push", an anchorless depth cut. The dive won
  outright, and shipping the losers as options would only be a way of avoiding
  the decision. Deleted.
- **Anchoring a lateral hop.** Two views at the same altitude (`orders` and
  `orders-pci`) share no card. There is nothing to fly through, so those get a
  240ms depth cut instead — still in `Stage.tsx`, but as an internal fallback
  rather than a user choice.
- **Animating the ELK layout between altitudes** (morphing each node from its
  landscape position to its detail position). The two layouts are computed
  independently and share almost no nodes; the correspondence that would make a
  morph legible does not exist.
