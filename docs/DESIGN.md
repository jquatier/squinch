# Squinch — Diagram Design Language

> How rendered diagrams look, and the rules that keep them looking that way.
> Companion to [SPEC.md](SPEC.md) (the DSL) and [PLAN.md](PLAN.md) (build). Numbers below are the starting point, tuned during Phase 2 against the
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
4. **Nothing almost-aligned.** Every position, size, and gap sits on the base grid.
   Elements share an axis exactly or are clearly apart.
5. **Quiet structure, loud meaning.** Neutrals carry structure; color is spent only on
   semantics (status, `highlight`, flows, async). Provider icons supply the color;
   our chrome stays out of the way.
6. **Deterministic beauty.** Every rule here produces identical pixels from identical
   input — including the sketch theme (see §7).

## 2. Tokens

- **Grid**: base unit `8px`. All node dims, gaps, paddings are multiples; edge stubs
  and port offsets too.
- **Radii**: `2 / 4 / 8` (badges / nodes / containers). One scale, no exceptions.
- **Strokes**: `1 / 1.5 / 2` (hairline dividers / edges & node borders / emphasis).
  Odd widths get half-pixel alignment (§8).
- **Type scale**: `11 / 13 / 15` — tagline & badges / node labels / container titles.
  Weights 450/550 (regular-plus/medium-plus of the bundled font). Labels never bold;
  hierarchy comes from size + color, not weight shouting.
- **Color roles** (every theme defines exactly these): `canvas`, `surface`,
  `surface-1..3` (nesting recession), `border`, `border-strong`, `ink`, `ink-muted`,
  `accent`, `ok/warn/error`, `dim` (highlight backdrop). Diagrams reference roles,
  never hex (already a SPEC rule).

## 3. Node anatomy

- **Leaf node**: fixed height (`64`), width snapped to tiers (`120/160/200/240`).
  Icon plate `40×40` left-aligned; label 13/550 ink; optional tagline 11 ink-muted,
  one line. Padding `12`. Provider icons sit on a neutral plate (radius 4) so
  full-color AWS art never touches the surface color directly.
- **System card** (collapsed container): height `88`; kind silhouette + accent bar,
  title 15/550, tagline 11 muted, glyph badge top-right `20×20` mono, `preview`
  strip = up to 3 icons at `16×16` bottom-right at 60% opacity, owner/status badges
  as `11px` pills. Hatched surface variant for `external`.
- **Labels**: wrap at container width, max 2 lines, then ellipsis; full text on
  hover (SPA/VSCode) and in `<title>` (static SVG). Lint nudges labels > ~40 chars.

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
- **Edge labels**: pill chips (11px, surface bg, radius 2, 1px border) with a canvas
  halo — a label never sits raw on a line, and never collides with another chip.
- **Aggregate edges** (from lifting): medium weight, neutral, count badge as pill.
- **Animation** (`~>`, v1.1): CSS `stroke-dashoffset`, constant speed in px/s (not
  per-edge duration — long edges must not "flow faster"), subtle: motion you notice
  peripherally, not a marquee. `prefers-reduced-motion` always respected.

## 5. Containers, zones, notes

- **Recession**: each nesting level moves surface one step (`surface-1..3`) — light
  theme darkens ~3% per level, dark theme lightens ~4% — with border one step
  lighter and title one size smaller. Depth you can feel, without shadows.
- **Elevation**: none by default (flat + borders). Themes may define one soft shadow
  for the *hover/selected* state only.
- **Zone frames** (v1.1): dashed `1.5` border, radius 8, kind-tinted at low opacity,
  label chip pinned to the top-left corner *outside* the flow of nodes.
- **Notes**: sticky-chip styling — `surface` bg, `warn`-tinted variant, 11px, max
  width `200`, connector leader line (dotted, 1px) to their anchor. In sketch theme
  they render genuinely hand-written.

## 6. Themes

Every theme is the full token set of §2 — never a palette swap on top of light.

- **`light` / `dark`** (v1, flagship): near-neutral surfaces, restrained accent,
  AAA-contrast ink. Dark is designed, not inverted: icon plates lighten, borders
  drop contrast, canvas is near-black not gray.
- **`sketch` / `sketch-dark`** (v1.1): rough.js strokes + a hand-lettered font
  (bundled, metrics-precomputed like everything else). Roughness/jitter is seeded
  from `hash(source)` — **deterministically rough**, so the lockfile model holds.
- **`blueprint`** (v2): white-on-Prussian-blue monoline, mono glyphs only, grid dots.
- **`contrast`** (v1.1): WCAG-first; encodes async/status with dash patterns and
  markers, never color alone (this rule actually applies to *all* themes: color is
  reinforcement, shape/pattern is the encoding).

## 7. Design references

Study: Stripe docs diagrams (restraint, edge craft), AWS official reference
architectures (zone framing, icon discipline), Excalidraw (why sketch charms:
font + jitter + muted palette), Linear (geometry, spacing rhythm), Vercel/Geist
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
  everywhere, buttery zoom/pan (trackpad-native), 200ms view transitions, exact-pixel
  icon alignment, an empty state that renders a beautiful example diagram instead of
  a blank pane.
- shadcn/ui stays as the component base — themed to this language, not its defaults.
