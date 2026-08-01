# CLAUDE.md

Squinch — architecture diagrams as code. LLM-first authoring, human layout control,
deterministic rendering. Pre-alpha; Phase 2 (see docs/PLAN.md §3).

## Constitution (read before designing anything)

- `docs/SPEC.md` — DSL v0: grammar, views, visibility resolution, edge lifting,
  the three layout tiers.
- `docs/DESIGN.md` — diagram design language + app chrome. These are renderer
  **requirements**, not decoration.
- `docs/PLAN.md` — build phases. Phase-0 spike exit criteria are pass/fail gates.
- `docs/notes/` — engineering notes on decisions that got relitigated once too
  often (e.g. `edge-labels.md` and `note-placement.md`: the placement policies,
  every rejected approach and why, and how to diagnose the next odd label).
  Read before redesigning anything they cover.

## Non-negotiables

- **Determinism**: same (source, packs, theme, tool version) → byte-identical SVG.
  No `Date.now`/`Math.random` in the render path; sketch-theme roughness is seeded
  from `hash(source)`; emitted SVG always uses LF; exported SVG never contains JS
  (animations are CSS keyframes at constant px/s).
- **Text metrics never come from the environment** — bundled font + precomputed
  metrics tables only (`src/metrics.generated.ts`). No canvas/DOM measurement.
  Rendered SVGs embed the subsetted Inter faces as `@font-face` data-URIs
  (`src/fonts.generated.ts`, family `SquinchInter`) so viewers draw the exact
  font the metrics were measured from; regenerate both with `npm run
  gen-metrics` / `npm run gen-fonts` in core. `gen-fonts` emits the same subset
  twice — woff2 for the SVG, and `packages/core/fonts/*.ttf` for rasterizers
  that can't read `@font-face`. **resvg is one of them**, so PNG export hands it
  those files with `loadSystemFonts: false`; drop that and PNGs silently pick up
  whatever font the machine has.
- **Core is isomorphic**: shared code imports no `node:` builtins. Node registers
  disk packs via `src/index.ts`; browsers call `registerPack` + `preloadIcons`
  (`src/browser.ts`). Tests boot packs through `test/setup.ts`.
- **The DSL has no pixel coordinates, ever.** Layout control is relative only.
- **Structure/layout separation**: deleting every `layout` block must still render
  well; conflicting hints are check-time errors, never silently dropped.
- **Errors serve the agent loop**: location + problem + likely fix (did-you-mean).
  `check --format json` and the human format carry identical information.
- **Every rendered SVG is validated** with a real XML parser
  (`src/render/validate.ts`, fast-xml-parser) in tests and tools — never assume
  emitted markup is well-formed; browsers are lenient, strict parsers are not.
  Label pills are collision-resolved; the golden suite asserts no two overlap.
- **Pack SVGs are sanitized at load** (`src/packs/sanitize.ts`: allowlist elements
  and attributes, strip scripts/handlers/foreignObject/external refs, namespace
  internal ids). AWS icons in `packages/pack-aws/icons/` ship **verbatim** under
  CC-BY-ND: never edit, recolour, or "optimize" them — regenerate with
  `npm run fetch`. Theme treatment is render-time only (placement, clipping,
  plates). Renderer note: `clip-path` on a `<use>` stops it instantiating in some
  renderers — always clip a wrapping `<g>`.
- Performance budgets in docs/PLAN.md §2 are CI-enforced acceptance criteria.

## Layout of the workspace

`apps/spa` — the playground (Vite/React/Tailwind; imports `@squinch/core/browser`
and fetches pack icons from `public/`, which `scripts/sync-packs.ts` generates —
those assets are build output, gitignored, never committed).
`packages/core` — the engine (see below).
`packages/pack-aws` — 316 AWS icons
(303 services + 13 group/boundary marks), verbatim + dual-licensed (see its NOTICE).
`packages/pack-azure` — 636 Azure icons, verbatim under Microsoft's icon terms,
which permit copying and distributing them **for architecture diagrams, training
and documentation only** — narrower than an open-source licence (see its NOTICE).
Nearly all of them are gradient artwork, which is the one thing that
distinguishes them from the other packs.
`packages/pack-logos` — 124 curated Simple Icons marks (CC0) for the non-cloud
half of a stack; `monochrome: true` in its manifest makes the renderer plate and
tint them.
`packages/pack-sys` — 147 curated Lucide icons (ISC): the generic set for what no
vendor draws (servers, hardware, network gear) plus plain shapes as a last
resort. Also `monochrome: true`. It is the `sys/*` prefix, and like `builtin` it
resolves with **no `pack` statement** — which is a property of being registered,
not of the DSL: `model.packs` is recorded and never read, so `pack` is a
declaration of intent. Registration is hardcoded in four places, all one-liners:
`core/src/packs/node-fs.ts`, `apps/spa/scripts/sync-packs.ts` +
`apps/spa/src/squinch.ts`, and `packages/vscode/scripts/bundle.mjs` (miss the
last and `packExists` is false in the bundled extension).
A pack name must never appear in **both** `BUILTIN_GLYPHS` and the pack registry:
`iconIds` short-circuits on the former, so the disk icons would vanish from
search, completions and `squinch icons` while `hasIcon` still accepted them.
Every pack regenerates with `npm run fetch`; never hand-edit icons.
Icon **ids must satisfy the grammar's `Ident`** — both cloud vendors ship names
that don't (`&`, parentheses, a trailing space), so the fetch scripts slug them
and `packs.test.ts` asserts it across every installed pack.
The sanitizer **hoists the source `<svg>`'s inherited presentation attributes
onto a wrapping `<g>`** (`packs/sanitize.ts`): the body is lifted out of its root
into a `<symbol>`, and stroke-only sets like Lucide put `fill="none"
stroke="currentColor"` on the root and nothing on the paths — drop those and
every icon renders as a solid black blob.
Deliberately absent: GCP. Google grants permission to *use* its Cloud icons in
diagrams but publishes no redistribution grant, so we don't ship them.
`packages/cli` — the `squinch` binary,
thin wrapper over core: arg parsing, project loading (file *or* directory), and the
lockfile model (`--sync`/`--check`). `packages/vscode` — the editor extension:
`src/features.ts` is every piece of editor intelligence as pure functions (unit
tested), `src/server.ts` a thin LSP shell over it, `src/extension.ts` the client
plus preview webview; `test/server.test.ts` drives the *bundled* server over real
stdio LSP. `examples/` — one directory per project, with
committed SVGs that CI verifies.

## Current phase

Phases 0–3 are complete. The engine (grammar → model → visibility/lifting →
layout → themed SVG), the CLI (check/render/diff/icons/init/watch + lockfile
model + Actions), the SPA playground, the VS Code extension + language server,
four icon packs, and five themes all ship. Phase 3's bar — an agent producing
clean diagrams from prose using only the skill + CLI — is certified at **20/20
by independent cold agents**, most recently at **18/20 clean on the first
`check`**. `gauntlet/README.md` writes up the latest round only: every round's
findings land as a code or docs change in the same commit, so the fixes are the
record. The number is never the point — a round that scores 20/20 and surfaces
a crash beats one that scores 20/20 and surfaces nothing.

v1.1's DSL is done: zones, flows, tags, channels, cols, align, legend/titleblock,
plus `only`/`detail` (below). Deliberately *not* built, with reasons recorded: `route … around`/`via`
(`docs/notes/routing-hints.md` — ELK already avoids nodes) and `grid` (rows and
cols compose to the same thing).
A view has **two** selection axes, and conflating them was a real bug: `scope` is
*where* you stand, `only` is *which* of that you keep. Tags are cross-cutting, so
no scope can ever name "the PCI parts" — before `only`, `include #pci` silently
no-opped and auditors enumerated the complement by id. `only` runs after `expand`
and *before* context, so a narrowed view narrows its periphery with it; a sibling
it drops never returns as a context card, because context shows connections
outward and a view must not draw a muted card of itself. `detail <path>` carries
what `include` used to smuggle — draw an outside node at its own depth rather
than as its system card — and splitting that out is what made `only` possible at
all: a verb that also controls altitude cannot be redefined to control
membership. Rule stack: SPEC §5.
Other work since then is in the playground, not the language: altitude changes animate as an anchored dive through the card you
clicked (`docs/notes/zoom-transitions.md`, DESIGN §11), presentation mode turns
the declared views into a full-bleed deck, and a `show flow` view can be walked
one hop at a time (`flowStep` render option — counted over hops *visible in that
view*, never the flow's declared numbering). PNG export ships in both surfaces.
`--adaptive` emits one SVG carrying both palettes behind
`prefers-color-scheme` (`src/render/adaptive.ts`): the pair is rendered off one
shared layout and merged by walking their attributes **positionally**, never by
substituting colour literals — pack artwork shares hexes with the theme, so a
search-and-replace would recolour someone else's trademark. Only themes with the
same font can pair (`Theme.pairsWith`); type metrics drive layout.

Key architecture from Phase 0, still binding: same-rank edges bypass ELK and use
our coplanar router; declared ranks are enforced via invisible scaffold edges; an
expanded container is one "entity" for ranking, and ELK layers freely inside it.
The Phase-0 hand-built harness that proved this is retired, and its canonical
oracle followed (2026-08): label-space reservation legitimately moves node
positions, so second-implementation parity stopped being a meaningful claim.
The architecture it certified is still enforced by the corpus invariant sweep.

## Commands

- `pnpm -r test` — every package. Core suite covers model diagnostics, golden SVG
  byte-compare, XML validity, determinism, Phase-0 layout parity. `UPDATE_GOLDEN=1`
  to rebless goldens after an *intentional* visual change.
- `pnpm -r typecheck` — tsc across packages (CI runs this first).
- `pnpm --filter @squinch/core build` — required before using the CLI binary.
- `node packages/cli/bin/squinch.js <cmd>` — the CLI (check/render/icons/init/watch).
  `render -o x.png` rasterizes via resvg (`src/raster.ts`); rebuild the CLI
  (`pnpm --filter squinch build`) before testing the binary — `bin/` runs `dist/`.
- `node packages/cli/bin/squinch.js render examples/orders --check` — dogfood gate;
  after any intentional renderer change, re-run `--sync` on both example projects
  and commit the SVGs, or CI fails.
- `cd packages/core && npm run grammar` — regenerate Lezer parser from
  `src/grammar/squinch.grammar`.
- `pnpm --filter @squinch/core bench` — PLAN §2 budgets, plus drift against
  `scripts/bench.baseline.json`: medians recorded **per machine** (timings do not
  compare across them), >25% over your own recorded number fails, sub-5ms
  measurements report but never gate. `npx tsx scripts/bench.ts
  --update-baseline` re-records — do it in the same commit as the change that
  earned the cost. CI has no baseline, so there it is budgets only.
- `pnpm --filter @squinch/spa dev` — playground on :5180 (`.claude/launch.json`).
- VS Code extension: <kbd>F5</kbd> ("Run Squinch extension") bundles core + the
  extension and opens `examples/` in a dev host; or
  `pnpm --filter squinch-vscode build`.

## Layout of @squinch/core

`src/grammar` (Lezer DSL grammar → generated parser) → `src/model` (tree → semantic
model + SPEC §9 diagnostics, did-you-mean) → `src/layout` (hints → ELK + scaffold
edges + coplanar router) → `src/render` (Positioned + theme → SVG, icons inlined as
deduplicated `<symbol>`/`<use>`) → `src/themes` (DESIGN.md token sets);
`src/packs` holds the pack registry + sanitizer. Grammar note: comments are `//` only — `#` is
reserved for tags.
