# Handoff: Squinch Diagram Restyle

## Overview
Enterprise-ready visual restyle of Squinch's SVG diagram renderer, covering container cards, nodes, edges, zones, and canvas depth. Explored against the microservices landscape example, in light and dark themes. Locked decisions are ready to implement in the renderer.

## About the design files
The bundled `.dc.html` file is a **design reference built in HTML** — it renders the same absolutely-positioned divs/SVG the target output needs, but it is not production code. The task is to recreate this visual language inside Squinch's actual rendering pipeline:
- `packages/core/src/render/svg.ts` — node/card/badge/pill/legend/edge geometry
- `packages/core/src/themes/index.ts` — light/dark theme tokens

Recreate the values below in those files' existing patterns; don't copy HTML/CSS wholesale.

## Fidelity
**High-fidelity.** Every value below (colors, radii, stroke widths, gradients, spacing) is final. Implement pixel-for-pixel where the renderer's coordinate system allows.

## Locked design decisions

### Container cards
- Rounded rect, 8px radius, 1px border (`#EAE9E5` light / `#3B3B40` dark), background is a top-to-bottom gradient rather than a flat fill:
  - Light: `linear-gradient(#FFFFFF, #F2F1ED)`
  - Dark: `linear-gradient(#26262A, #1D1D20)`
- 1px contact shadow under every card: `0 1px 2px rgba(28,28,26,.06)` light, `0 1px 2px rgba(0,0,0,.5)` dark.
- Left edge: 3px gradient spine, `linear-gradient(#C441FE, #15B6FF)` (magenta → cyan), signaling "divable" — present on containers only, never on leaf nodes.
- Corner glyph plate: 38–40px rounded-rect icon tile inside the card header, tinted background (`#EFEFEC` light / `#2A2A2E` dark) so the pack icon sits on a neutral chip, not the card background directly.
- Footer "shelf": a 30px strip along the bottom, 1px top hairline, holding child-type icons + an overflow `+N` chip — only rendered when the container actually has more children than fit. Shelf background is the gradient's *bottom* tone (`#F1F0EC` light / `#1D1D20` dark) so it reads as one continuous surface with the card above it, not a separate block.
- **Expand affordance: stacked sheets**, not a folded corner. Two offset outline rects sit behind each container, 4px and 8px back, opacity .8 and .5 respectively, same border/fill tone as the card. This replaces an earlier folded-corner concept — do not implement a dog-ear/fold. Reserve +8px of bounding box to the right and below every container for the sheets; at tight layouts they must not touch neighboring shapes.
- No fold, no dog-ear, no clipped corner — that treatment was explicitly rejected.

### Nodes (leaf shapes)
- Same rounded-rect card shell as containers minus the spine, the shelf, and the stacked sheets — nodes have no "inside," so they get none of the affordances that imply one.
- Neutral fill/border by default. Color is reserved for: (a) edges that cross a zone boundary, (b) actor tiles.
- Actor node (e.g. "Customer"): filled solid rather than outlined, to visually separate the initiating actor from services.

### Edges
- Sync edges: solid line, 1.5px stroke, `#57564F` light / `#9C9B94` dark, round caps/joins, arrow marker.
- Async edges: dashed, `6 5` dasharray, `#7C74D9` light / `#968EE8` dark.
- Boundary-crossing edges: solid, `#B5544C` light / `#D08078` dark (the one deliberate warm/red accent in the palette, reserved exclusively for this meaning).
- **Do not** draw a perpendicular tick/hop mark where an edge crosses into a zone outline — this was tried and explicitly removed for looking wrong. Edges should cross zone boundaries with no interruption mark.
- Flow beads: numbered circles (19px, `#5A57C9` fill, white text) sequence a specific flow (e.g. "checkout") across multiple edges. Only number edges that are part of the highlighted sequence — partial numbering across a diagram is fine and intentional, it scopes the sequence rather than covering every edge.
- Edge labels: plain rect chip — white/dark plate, 1px hairline border (`#EAE9E5` / `#3B3B40`), 2px radius, `11px Inter`, text colored `#57564F` / `#9C9B94`. (Nine alternative treatments were explored — icon-tab chips, tinted-by-meaning chips, mono pills, halo knockouts, router-gapped labels — and the plain baseline was the one kept. Do not "upgrade" edge labels to the zone-chip grammar; that was tried and rejected as too heavy at high repeat counts.)

### Zones (VPC / namespace boundaries)
- Dashed outline only, **no fill** — critical: nesting zones must never compound opacity/darkness. A zone inside a zone should look identical in tone to a zone alone.
- Zone label: a chip in the same "chip" grammar as boundary labels — icon tab in a tinted step + label segment on the plate, hairline border, 3px radius. Positioned clear of any edge routing (do not let horizontal edge runs pass under a zone chip — this was a real bug: chips must sit at coordinates with no edge crossing beneath them).

### Annotation notes (freeform commentary on the diagram)
- Neutral plate (`#FFFFFF`/`#212124`), 1px hairline border, 4px radius, same 1px contact shadow as cards.
- An 11×11 "info" glyph (circle + i) sits left of the text, carrying the "this is commentary, not a diagram object" meaning that a distinct fill color used to carry.
- **Do not use a warm/amber fill for notes** — this was the original approach and was explicitly reverted; amber was the only third hue in an otherwise two-hue (neutral + magenta→cyan spine) palette and read as a sticky note rather than part of the diagram.

### Diagram title block (top-left of a rendered diagram)
- Diagram name (19px, weight 600) + view-type subtitle (11.5px) stacked, then a three-segment meta chip: version / short commit hash (mono) / date. Same chip grammar (segments in alternating tints, hairline border, 3px radius) as zone/boundary chips.

### Footer wordmark
- Bottom-right corner of the canvas: small `squinch` wordmark, 10.5px Inter, letter-spacing .02em, dimmed tone (`#A5A199` light / `#6E6D67` dark). Replaces an earlier "microservices · landscape" text — the wordmark goes in the footer; diagram name/type goes in the title block instead.

### Dark theme
Mirrors light exactly in structure. Every light token above has a listed dark equivalent — implement as paired values in `themes/index.ts`, not as a separate visual system.

## Open / explored but not decided
- Depth ramp beyond the 1px contact shadow (turn 23–24 explored gradient strength 2%–7% on card fills; 4% ramp + contact shadow, `linear-gradient` top-lighter in dark, was the version taken into the full render — confirm this is still the desired final strength before shipping, it was accepted but not separately re-confirmed after the note/fold follow-up changes).
- The two purples (`#7C74D9` async vs `#5A57C9` flow beads) were flagged as too similar and not yet resolved — pick one before implementing if this matters to you; currently both values above are correct as last rendered, but a designer follow-up was pending.
- Storefront-orders and nested-frames example diagrams have not yet been restyled — this package only covers the microservices landscape.

## Assets
Icons referenced above come from `packages/pack-aws/icons/*.svg` and `packages/pack-sys/icons/*.svg`, already in the repo — no new assets needed.

## Files in this bundle
- `Squinch Diagram Restyle - Final Render.dc.html` — the final locked landscape render only (light + dark), for visual cross-checking during implementation.
