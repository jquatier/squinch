# Note — the interactive HTML export

`squinch render <project> -o diagram.html` puts every view of a project in one
self-contained file with a viewer that dives between them. This records why it
exists, the one rule it bends and how, and the decisions that are settled.

## Why it exists

Views are altitudes over one model, and moving between them is navigation
(DESIGN §11). That experience lived in exactly one place: the playground.
Everything shareable — a committed SVG, a PNG, an adaptive dual-palette SVG —
was a single frozen altitude, so the feature the whole view system exists for
could not leave the machine it was authored on.

## The rule it bends, and how

CLAUDE.md: *"exported **SVG** never contains JS."* That is unchanged, and it
covers the SVGs inside this file too. The exception is narrow and mechanical:

- **The script is a sibling of the SVGs, never their content.** Each embedded
  SVG is what `render -o x.svg` produces, minus the defs the document shares.
- **Exactly two `<script>` elements**: a JSON payload and the viewer. Remove
  both and nothing executable is left — no handler attributes, no
  `javascript:`, no `<script src>`.
- **It fetches nothing.** Every reference is a fragment or a `data:` URI. The
  only absolute URL in the file is the SVG namespace.
- **The entry view is inline**, not in a `<template>`, so a reader with script
  disabled — or a wiki that strips it — still sees a correct diagram.

`packages/core/test/interactive.test.ts` asserts all four. If someone later
wants a second script, that test is where the argument has to be won.

## Why HTML and not a cleverer SVG

A `:target`-driven SVG was designed and measured against this. Its one real
advantage is being an *image* type — and that advantage dies exactly where
images get used, because `<img>`-embedded SVG runs non-interactively: links,
`:target` and hover are all inert there. That is precisely why the `~>` edge
animation survives a GitHub `<img>` embed (a passive CSS keyframe) and a link
would not. So "interactive when opened directly" is the same reach an HTML file
has, and the SVG additionally cannot do presentation mode or keyboard stepping
(Fullscreen API and key listeners are script), while needing per-view-pair CSS
transform machinery that would be ours alone to debug.

## Hoisting: the decision the file size rests on

Measured on the six committed `examples/microservices` light SVGs:

| per view | |
|---|---|
| embedded font `<style>` | **32 KB, identical in every view** |
| icon `<symbol>` defs | 17–26 KB, largely repeated |
| the actual drawing | **3–9 KB** |

Six views concatenated naively: **362 KB**. Fonts and symbols hoisted once:
**≈ 98 KB**. Real output for that project at two palettes is **148 KB**.

The instinct is that identical ids across views are a *problem* to be solved by
prefixing each view's copy. It is the opposite: fragment references resolve
document-wide in HTML, so one `<symbol id="sq-aws-lambda">` serves every view
and no reference needs rewriting at all. Prefixing would have cost 3.4× the
bytes and kept a regex pass over the emitter's output.

Two consequences worth knowing:

- **The export needs no `isolateIds`.** The playground still does — it compiles
  per view and hoists nothing, so its two transition layers would otherwise
  resolve each other's artwork. That is why `isolate.ts` stayed in the SPA.
- **`sq-hatch` is the only theme-dependent def**, because it bakes `t.border`
  into its pattern. Symbols, clip paths and `sq-accent` are theme-free by
  construction (`iconDefs` takes only `Positioned`, never a `Theme`). So the
  hoist needs exactly one scoped exception, `defsScope`, rather than a general
  scheme — and `collectDefs` **throws** if an id is ever recorded twice with
  different markup, which turns "these defs are theme-free" into a build-time
  assertion that fires the day someone themes one.

## `--adaptive` is refused here, deliberately

`mergeAdaptive` folds two palettes into one SVG using document-global class
names (`sq-t0 … sq-tN`) whose colour meaning is derived per diagram. Inline
several of those in one document and the second view's `.sq-t3` repaints
elements in the first. The export carries real palettes and a real switch, which
is strictly more than adaptive buys here. The CLI says so rather than producing
a file that quietly ignores the flag.

## What the runtime is, and what got simpler

`src/render/html/runtime.ts` imports `view/dive.ts` and `view/navigate.ts`
**directly** and is bundled into a committed `runtime.generated.ts` — the same
pattern as `fonts.generated.ts`, so rendering never invokes a bundler and the
output cannot drift with an esbuild upgrade. That import is what makes "the
export moves exactly like the playground" a fact about the build rather than a
comment.

Because every body is already in the document, a view swap is **synchronous**,
and most of `Stage.tsx` disappears:

- **the arm/fire split** — its only reason was that compiling the next view is
  async (`docs/notes/zoom-transitions.md` says so outright)
- **`Intent.rect`** — the clicked card's measured rect had to be plumbed through
  React because the outgoing DOM was gone by the time the animation started.
  With both layers co-resident, one `querySelector([data-path])` covers both
  directions.
- **`token` / `seen` / the stale-swap timer** — no async race, no re-entrancy
  bookkeeping.

## Settled

- **Declared views by default**, `--views all` opts into the auto view every
  container gets. Same call `--sync` makes, and here it is a file-size cost.
- **Not part of `--sync`.** That is the committed-artifact + lockfile model; this
  is a share artifact, ~150–230 KB per project, and byte-gating it in CI before
  the format has settled would freeze it early.
- **One body per (view × palette × flow hop).** A `show flow` view bakes one
  frame per hop *visible at that altitude* — `RenderResult.flow.steps` is
  already that number, and it is exactly what a presenter can walk to.
  `--no-flow-steps` drops them: `examples/microservices` is 230 KB with the
  five-hop story and 151 KB without.

## Presentation mode

`p` enters, and the declared views in declaration order are the deck — nothing
authored twice (DESIGN §11). Two things differ from the playground, both because
a file opens as a document rather than as a mode of an app:

- **Fullscreen is requested on the gesture that turns presenting on**, not on
  mount. It is the only moment a browser will grant it, and leaving fullscreen
  by the browser's own affordance leaves the deck too.
- **Stepping and climbing stay different moves.** `→`/`←` walk one axis —
  hops of the current flow first, then the next view — while `↑`/`Backspace`
  climbs an altitude. Merging them would make "back" ambiguous the moment a
  flow view sits inside a system.

## Not automated

Nothing in the test suite proves the *interaction* works. The mechanism that
cannot be checked headlessly is `<use href="#…">` resolving across `<svg>`
element boundaries — neither happy-dom nor jsdom lays out or resolves SVG
references, so the whole hoisting strategy is only verified by opening the file.
It was verified that way — dive, breadcrumb, climb, palette toggle, deck
stepping, flow walking 1→5 and back, `Home`/`End`, and the deep link. Now that
there is a presenter, this should grow a Playwright smoke test: chromium and
**webkit**, since Safari has the longest history of `<use>`/`clipPath`
cross-reference quirks and this artifact will be opened from `file://` on Macs.

One note for whoever writes it: the browser-automation harness in use here sent
`Right` rather than `ArrowRight`, so the first attempt looked like broken
stepping and was not. Dispatch real `KeyboardEvent`s with the DOM key names.
