# Squinch — Diagram Design Language

> How rendered diagrams look, and the rules that keep them looking that way.
> Companion to [SPEC.md](SPEC.md) (the DSL) and [ENGINEERING.md](ENGINEERING.md)
> (budgets, verification). Numbers below were tuned against the
> lookbook — but the *rules* are non-negotiable.

## 1. Principles

1. **The default theme is the brand.** Most people will only ever see a screenshot of
   the default render. `light`/`dark` are the flagship product surface, not a base to
   customize away from.
2. **The app is the frame; the diagram is the art.** App chrome recedes so the canvas
   owns the screen (see §10). Diagram themes have their own language, independent of
   the app skin.
3. **Uniformity beats fit.** Nodes have fixed heights and snapped width tiers; text
   adapts to the box (wrap → ellipsis → hover for full), never the reverse. No
   ransom-note diagrams.
4. **Nothing almost-aligned.** Elements share an axis *exactly* or are clearly
   apart — a 3px offset reads as a mistake, 40px reads as a decision. Exactness is
   enforced where the author asks for it (`align`, `cols`), and positions are
   whole pixels everywhere (§8). Note this is deliberately **not** "every position
   sits on the 8px grid": node widths step by 40, so half-widths alternate on and
   off the grid, and equalising two centres therefore *must* put one of the pair
   at a multiple of 4. Exact alignment and gridded positions cannot both hold, and
   exactness is the one that matters — snapping to 8 would turn a straight edge
   into a 4px dogleg, which is the artefact this rule exists to forbid.
5. **Quiet structure, loud meaning.** Neutrals carry structure; color is spent only on
   semantics (status, `highlight`, flows, async). Provider icons supply the color;
   our chrome stays out of the way.
6. **Deterministic beauty.** Every rule here produces identical pixels from identical
   input.

## 2. Tokens

- **Grid**: base unit `8px`, and it governs the numbers *we* choose: node
  dimensions (tiers `120/160/200/240` and `200/240/280/320`, heights `64` leaf,
  `96` card, `56` actor), padding, radii, stroke widths, and the `16` minimum
  edge stub. Positions are ELK's and are whole pixels rather than multiples of
  8 — see §1.4.
  Two deliberate exceptions, both container paddings, both holding a label
  against a border: zone padding is `28` top / `20` sides, and frame padding is
  `44` top. Each is tuned to seat its label, and rounding them onto the grid only
  adds slack — 32/16 doubles the zone's top-to-side gap and the boundary reads
  top-heavy; 48 pushes a frame's contents down without moving its title. Where
  the grid and a proportion disagree, the proportion wins; the grid exists to
  serve the drawing, not the reverse.
- **Radii**: `2 / 3 / 4 / 6 / 8` — label pill / chips / notes & leaf plate /
  icon tile / nodes, cards and zones. A shape's radius says how big it is,
  which is why a chip and a card never share one.
- **Strokes**: `1 / 1.5 / 2` (hairline dividers / edges & node borders / emphasis).
  Odd widths get half-pixel alignment (§8).
- **Type scale**: `10.5 / 11 / 11.5 / 13 / 15 / 19` — chip segments & wordmark /
  taglines, pills, shelf / header subtitle / node labels / card titles / the
  header's diagram name. Weights 400/500, plus 600 for the header name alone.
  Labels never bold; hierarchy comes from size and colour, not weight shouting.
  One mono face (IBM Plex Mono 400) exists for exactly two jobs — a commit hash
  and a zone's `detail:` — where digits have to line up between diagrams.
- **Depth**: a 4% top-to-bottom gradient on every lit surface, over a 1px
  contact shadow. It is the whole of the depth system: no elevation ladder, no
  blur beyond `stdDeviation="1"`. Two details are load-bearing rather than
  incidental. The alpha lives in the shadow's `flood-color` rather than an
  opacity, because the adaptive merge only rewrites colour-valued attributes
  (§6). And the filter carries `color-interpolation-filters="sRGB"`: SVG
  filters default to linearRGB, so a filtered element round-trips through
  linear space at 8 bits — near white that costs nothing, near black it
  flattens a 4% ramp into a handful of wide steps with a visible cliff. A
  subtle gradient and a drop shadow on the same element is exactly the
  combination that exposes it.
- **Colour roles**: see `themes/index.ts`, which is the list — every theme
  defines every role, and the doc comment on each says what it is for. Diagrams
  reference roles, never hex (already a SPEC rule). One role is deliberately
  not theme-relative: the brand ramp `#C441FE → #15B6FF`, identical in both
  themes as the logo is.
- **Author hues**: the eight `hue*` tokens are the whole vocabulary an author's
  `color:` can reach (plus `accent`, the ninth word), each designed as a pair —
  darker and more saturated on paper, lifted on the dark canvas — and spaced so
  no two collapse at 1.5px. Four of them are the zone tints the kinds default
  to; the other four were set beside them. They are a palette, not a
  picker: adding a hue is a design decision against both canvases.

## 3. Node anatomy

Every node is the same surface — a rounded rect with the 4% ramp, a hairline
border and the contact shadow — and the parts hung on it say what kind of thing
it is. Nothing carries an affordance it cannot honour: a leaf has no inside, so
it gets none of the marks that imply one.

- **Icon tile**: `40×40`, radius 6, in the neutral `plate` tone, holding the
  artwork at `26` — one shell for every kind of mark. The ring of tile is the
  point: vendor art is drawn against white in its own guidelines and reads as
  pasted on when it touches a gradient. A single-colour mark becomes a
  **knockout chip** in the same inset — the chip filled with the mark's own
  colour (a trademark keeps its hue; `sys`/`builtin` take the theme's muted
  ink) and the mark knocked out of it. The knockout ink follows the chip's
  lightness: white on a dark chip, near-black on a light one (JavaScript's
  yellow, React's cyan — which is those brands' own usage), by one
  deterministic integer threshold. This is what makes the chip legible in both
  themes with no per-theme machinery, and it is the same treatment at every
  size — tile, shelf chip, and badge are one drawing routine.
- **Leaf node**: height `64`, width snapped to tiers. Tile left-aligned at
  padding `12`, label 13/500, optional description line 11 muted. An optional
  **node badge** (`badge:`) sits on the tile's bottom-right corner: `22×22`,
  radius 5, surface fill + border stroke, holding a `14×14` mark in its own
  brand colour, inset so it clears the card edge by 5.
- **Actor tile** (`person`): height `56`, filled rather than outlined and with
  no border at all, holding a `34` round avatar. The human who starts the story
  should read as a different sort of thing before the icon is read, and shape
  is the fastest way to say so.
- **System card** (collapsed container): height `96`. A `3px` spine down the
  left edge in the brand ramp, clipped to the card's own radius — it is the
  "divable" mark, containers only. The tile, then title 15/500 and tagline 11
  muted, their baselines hung off the tile's centre line. A `26×26` bordered
  chip top-right holds the kind glyph, whose column is reserved whether or not
  one is drawn. Along the bottom, a `30` **shelf** continuing the gradient's
  lower tone under a hairline: child icons at `16`, a `+N` overflow count, and
  an optional `domain:` chip right-aligned. The shelf is drawn only when it has
  something to hold, and a card without one centres its header rather than
  leaving the bottom half empty.
- **Stacked sheets**: two outline rects behind every container, offset `4` and
  `8` back and down at opacity .8 and .5. "There is more inside", said by the
  shape before anyone clicks. They bleed past the card rather than being sized
  into it — inflating the node would put ELK's ports on the inflated face and
  every edge would stop short of the card it points at — so a corpus invariant
  asserts the bleed lands in empty space (`test/invariants.ts`). They are
  emitted *outside* the node's own group, because the playground styles the
  group's first rect on hover and measures its bounding box for the dive.
- **Context** cards and leaves keep the flat surface and a dashed border: they
  are scenery, and scenery is not lit, lifted, or advertised as divable. A
  context card keeps a muted spine, so subject and scenery never read alike.
- **`external`** — someone else's — takes a hatched overlay across the whole
  card, shelf included: a texture rather than a colour, since colour is already
  spoken for, and it has to survive print and a colour-blind reader.
- Three things here are called badges and they are distinct: a **card glyph**
  is the identity of a collapsed system, a **flow badge** is a step number on
  an edge, a **node badge** is whose platform a leaf belongs to.
- **Labels**: wrap at container width, max 2 lines, then ellipsis; full text on
  hover (SPA/VSCode) and in `<title>` (static SVG). Lint nudges labels > ~40
  chars, and a second lint names any character the bundled font subset cannot
  draw — it renders as a gap rather than a glyph, and nothing else would catch
  it (the SVG stays valid and deterministic either way).

## 4. Edge craft (where diagrams are won)

- **Orthogonal, rounded** (radius `8`) by default; `curved`/`straight` per view.
- **Stubs**: an edge leaves and enters perpendicular to the node side, running ≥ `16`
  before its first turn. No diagonal escapes from a box edge.
- **Port distribution**: multiple edges on one side spread at even offsets on the
  grid — never stacked into a single point. Order chosen to minimize crossings,
  deterministically.
- **Crossing hops**: where two edges cross, the minor edge takes a small gap (`6`)
  — the strongest "drawn by a person who cared" signal there is.
- **Arrowheads**: filled chevron `8×6`, matched to stroke color; open chevron for
  `~>` async. Small, sharp, consistent — never SVG default markers.
- **Async dashes** are `6 5`. The drift animation's offset must then be a whole
  number of dash periods or the pattern jumps each time it loops, so one shared
  keyframe uses the LCM of the periods it serves (dashed 11, dotted 5 → 55) and
  the durations are derived from the px/s the vocabulary promises. Adding a
  pattern means revisiting that number.
- **Edge labels**: pill chips (11px, surface bg, radius 2, 1px border) with a canvas
  halo — a label never sits raw on a line, and never collides with another chip.
  Placement: space is **reserved at layout** — ELK inline labels on cross-rank
  edges, sized gutters and lanes on coplanar ones — and the pill draws in its
  reservation. A label can never collide or detach; the corpus invariant sweep
  enforces it geometrically. History of the placement-search era:
  `docs/notes/edge-labels.md`.
- **Aggregate edges** (from lifting): medium weight, neutral, count badge as pill.
- **Animation** (`~>`, and opted-in sync edges): CSS `stroke-dashoffset`,
  constant speed in px/s (not per-edge duration — long edges must not "flow
  faster"), subtle: motion you notice peripherally, not a marquee.
  `prefers-reduced-motion` always respected. The vocabulary stays inside that
  bar: `reverse` (a response flowing against the arrow), `slow`/`fast`
  (cadence as meaning), `packets` (sparse dashes — discrete messages, not a
  stream), `pulse` (the whole edge breathes; a heartbeat or healthcheck), and
  `comet` (a `3.5`px dot in the edge colour rides the route — a single request
  making its way through, and the only motion available to a plain solid call).
  The comet travels at the same constant `150`px/s the dash values hold to, but
  it cannot get that from a shared keyframe: duration is length ÷ speed, per
  edge. Below roughly `60`px a floor of `0.4`s takes over and a very short edge
  runs slightly fast — the one place motion here is not constant-speed, taken
  deliberately because the alternative was silently drawing nothing where the
  author asked for a comet. One value per edge; anything marquee-like stays
  out.

## 5. Containers, zones, notes, chrome

- **Expanded frames**: a recessed surface behind their children, radius `8`,
  with the container's name at their top-left. Depth is one step, not a ladder —
  except `expand *`, the one deliberate ladder (SPEC §5), where frames do nest.
  Nested frames carry **no fill**, only the 1px border and the label: the zones
  argument applies verbatim — surfaceAlt compounds where frames nest, and the
  recession must say "opened" once rather than encode depth as darkness
  (docs/notes/full-detail.md).
- **Zones** (deployment boundaries): a dashed outline, radius `8`, in the kind's
  hue (`account` red, the network kinds blue, `cloud` violet, the rest gray —
  or the author's `color:`) — and **no fill, ever**. A tint compounds where zones nest, so a subnet
  inside a VPC read darker than either and the boundary's weight encoded depth
  rather than kind.
- **Zone chips** straddle their boundary's border and are built from one hue at
  three strengths: a square icon tab on a quiet plate, a label bed at 12%, an
  optional mono `detail:` segment at 20%, and a 35% border. Segments are flush —
  a gap between them shows the canvas through and reads as a mistake. The
  `detail:` segment is all-or-nothing: a clipped `10.0.0.0/16` is not a
  shortened label, it is a different network, so on a boundary too narrow for
  both the segment goes and the name keeps its room. Placement slides along the
  border to the spot clear of edges and pills (`docs/notes/note-placement.md`).
- **Flow badges**: a numbered disc in the accent, its ink chosen so the number
  reads on it in both themes — the dark theme's bead is a pale lavender, and
  white on lavender is unreadable at 10px.
- **Notes**: the same neutral plate as everything else, radius `4`, with a
  contact shadow and a dotted leader to their anchor. They open with an 11px
  glyph — a circle-i, or a triangle for `style: warning`. The glyph is what
  carries "this is commentary, not a diagram object"; an amber fill used to,
  and it was the only third hue in a two-hue palette, reading as a sticky note
  stuck onto the drawing rather than part of it. Max width `200`, three lines.
  Placement: the anchor's own side, sliding past every obstacle (nodes, pills,
  chips, badges, the footer band, notes already placed) before standing further
  off; a corner note hugs its corner and grows the canvas rather than
  overlapping (`docs/notes/note-placement.md`).

### Chrome — what frames the drawing

- **Header**, top-left: the diagram's name at 19/600, an optional subtitle at
  11.5, and a meta chip whose segments alternate tints. `version`, `commit` and
  `date` are reserved and their values speak for themselves; any other key an
  author writes keeps its key beside its value, because `platform` alone says
  nothing. Nothing is derived — no git, no clock — because a render is a pure
  function of its source (§1.6).
- **Footer**, full width under a hairline: the legend on the left, the `squinch`
  wordmark on the right. The legend shows only what the diagram earned — a
  drawing with no async edge never explains dashes.
- Both are drawn in canvas coordinates, never inside the body's transform. A
  note can push the diagram right and down, and chrome that rode along would
  slide with it.
- A diagram with no title, no legend and no titleblock gets no chrome at all.

## 6. Themes

Every theme is the full token set of §2 — never a palette swap on top of light.

- **`light` / `dark`** — the shipping pair, and the whole set. Near-neutral
  surfaces, restrained accent, AAA-contrast ink. Dark is designed, not inverted:
  icon plates lighten, borders drop contrast, canvas is near-black not gray.
- Meaning never rests on hue: async is dashed with an open chevron, context is
  dashed, zones are dashed and kind-tinted, boundary crossings change colour
  *and* keep their pattern. Colour is reinforcement; shape and pattern are the
  encoding. That rule is what made a dedicated high-contrast theme redundant.
  An author's `color:` (SPEC §3) lives inside the same rule: it paints the part
  of an element that is already its mark — a plate ring, a card spine, an edge
  stroke, a zone outline — and never replaces a shape or a pattern, so a
  coloured diagram read in greyscale still says everything it said in colour,
  minus the emphasis.
- Retired with the docs/design restyle (2026-08): `sketch` / `sketch-dark`
  (rough.js + hand-lettered Caveat) and `contrast` (WCAG-first). The restyle's
  card anatomy — gradient ramps, contact shadows, stacked sheets, the segmented
  chip grammar — has no hand-drawn or pure-black translation, and three
  unreviewed palettes riding every geometry change cost more than they returned.
  A new theme is a design exercise against docs/design, not a token swap.

## 7. Design references

Study: Stripe docs diagrams (restraint, edge craft), AWS official reference
architectures (zone framing, icon discipline), Linear (geometry, spacing rhythm), Vercel/Geist
docs (typography in technical drawings), Railway's canvas (dark-theme depth).
Failure modes to design against, wherever they appear: auto-fit box sizing (the
ransom-note effect), unmanaged edge crossings and spline chaos, container soup at
deep nesting, gradient-era chrome.

## 8. Rendering crispness

- Odd stroke widths on half-pixel offsets; positions and sizes integer after layout.
- `shape-rendering: geometricPrecision`; consistent join/cap (`round`).
- Text: bundled font, `text-rendering: optimizeLegibility`; no synthetic bold.
  Exports embed the subsetted faces via `@font-face` data-URIs, so text renders
  identically in sandboxed viewers (GitHub `<img>`) and on machines without the
  font installed — what layout measured is what every viewer draws.
- Export parity: SVG and PNG (resvg) must be visually identical; PNG at 2x default.
- **The interactive export carries the altitudes, not just one of them.** A
  single self-contained HTML file with every view pre-rendered and the same
  anchored dive between them (§11) — because a diagram you can only zoom in the
  playground makes the view system unshareable. Shared defs are hoisted once, so
  the file is the drawings plus one font, not one font per drawing.

## 9. Quality gates (how "very good" stays true)

- **The lookbook**: ~15 curated reference diagrams (small, dense, deep-nested,
  zone-heavy, flow-heavy, worst-case labels) rendered in every theme. Each release is
  eyeballed against it; snapshots lock it. The lookbook is the beauty bar the same
  way the agent gauntlet is the correctness bar — and it ships in the repo as the
  example gallery, so the marketing *is* the test suite.
- **Beauty checklist** for renderer PRs: no near-misses, no label collisions, no
  port pile-ups, no raw label-on-line, stubs respected, recession correct at 3 deep.
- **Anti-regression**: any lookbook diff must be an intentional, named improvement
  (`label: "tighter-ports"`), never drift.

## 10. App chrome (SPA / VSCode webview)

Direction: **precision instrument** — Linear/Geist-grade professional, not playful,
not loud. The bar: a staff engineer screenshots the whole app and it looks like a
product that costs money.

- Near-neutral chrome (grays with one restrained accent), crisp 1px borders, subtle
  depth, no decoration that competes with the canvas. Dark and light both first-class,
  each matched to the diagram theme in view.
- The canvas is the hero: chrome occupies edges only (slim toolbar, collapsible
  editor pane, floating breadcrumb + tag chips); every panel is dismissible to a
  pure-canvas mode. Canvas gets a barely-there dot grid.
- Typography: same bundled sans as the diagrams for wordmark/UI labels, mono for the
  editor — the app and its output visibly share one type system.
- Details that read "expensive": real keyboard shortcuts surfaced in tooltips, Cmd-K
  everywhere, buttery zoom/pan (trackpad-native), exact-pixel icon alignment, an
  empty state that renders a beautiful example diagram instead of a blank pane.
- shadcn/ui stays as the component base — themed to this language, not its defaults.

## 11. Altitudes on screen

Views are altitudes over one model, so moving between them is navigation, not a
slide change — and the chrome has to say so.

- **Changing altitude is animated about the card you moved through**, the one
  element the two views share, so the reader never has to re-find their place.
  One motion, no picker; `prefers-reduced-motion` cuts straight through. The
  geometry and everything rejected on the way: `docs/notes/zoom-transitions.md`.
- **The way back is always on screen.** A breadcrumb of the ancestor trail, every
  hop clickable, in the editor and in presentation alike.
- **Presentation mode is the same views, full-bleed**: the declared views become
  the deck in declaration order, arrows step, clicking a card still zooms in and
  the deck follows. Nothing is authored twice. Chrome auto-hides while idle and
  returns on the first movement.
- **A flow is a story, and stepping tells it**: one arrow key walks the current
  view's flow hop by hop before moving to the next view, and unwinds the same
  way in reverse. The live hop takes the accent and the heavier stroke, hops
  already told recede, and anything the request has not reached is dimmed.
  Hops are counted **as seen in this view**, never by the flow's declared
  numbering — a flow that begins two systems away has its opening steps lifted
  out of a scoped view, and counting declared numbers there spends the first
  presses on frames where nothing happens. Badges still read their declared
  number: that is the flow's real shape, and it is what the reader is being
  told about.
