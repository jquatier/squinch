# CLAUDE.md

Squinch — architecture diagrams as code. LLM-first authoring, human layout control,
deterministic rendering. Pre-alpha, launching at https://squinch.cc: the
engine, CLI, playground and extension all ship (see §Where things stand).

## Constitution (read before designing anything)

- `docs/SPEC.md` — DSL v0: grammar, views, visibility resolution, edge lifting,
  the three layout tiers.
- `docs/DESIGN.md` — diagram design language + app chrome. These are renderer
  **requirements**, not decoration.
- `docs/ENGINEERING.md` — performance budgets (CI-enforced), the verification
  strategy, and why ELK/Lezer.
- `docs/notes/` — engineering notes on decisions that got relitigated once too
  often (e.g. `edge-labels.md` and `note-placement.md`: the placement policies,
  every rejected approach and why, and how to diagnose the next odd label).
  Read before redesigning anything they cover.

## Non-negotiables

- **Determinism**: same (source, packs, theme, tool version) → byte-identical SVG,
  **across platforms, not just across runs** — CI byte-compares the goldens on
  macOS, Linux and Windows. No `Date.now`/`Math.random` in the render path;
  emitted SVG always uses LF; exported SVG never contains JS (animations are CSS
  keyframes at constant px/s). The tool version travels *in* the SVG: hosts
  stamp `data-squinch` on the root by passing `toolVersion` (CLI, playground,
  extension); core never reads its own version; goldens and the lookbook stay
  unstamped because nothing hands them one. The stamp describes the render and
  is not a gate input — `render --check` strips it from both sides and compares
  the picture, so a version bump makes nothing stale
  (`docs/notes/version-stamp.md`). There is no lockfile — `squinch.lock` was
  write-only and drifted for two releases, and `--sync` deletes one it finds.
- **LF is an *input* invariant too.** A `.squinch` file checked out on Windows
  arrives CRLF, and source text reaches the SVG verbatim through labels,
  descriptions and titleblock values. (The first victim was the sketch theme,
  whose jitter hashed the source; it is gone, the rule is not.) Line endings are
  normalized in exactly
  one place — `normalizeSource` in `src/model/source.ts`, applied at the top of
  `buildProject` *and* `renderProject` (the second because the seed is computed
  there, past the first). Do not normalize anywhere else. A host that maps core's
  `Loc` offsets back into its own buffer must normalize that buffer first —
  `packages/vscode/src/server.ts` is the one that does, and its `offsetAt` must
  be measured against the same string. Line and character are unaffected by the
  transform; only the offset moves. `.gitattributes` holds the same invariant for
  the checkout, and `render --check` compares content rather than bytes on disk
  so a user's CRLF repo is not permanently "stale".
- **The interactive HTML export is the one artifact that carries a script**, and
  it is a separate class rather than a loophole (`src/render/html.ts`,
  `docs/notes/html-export.md`). The rule above is unchanged and covers the SVGs
  inside it: each is what `render -o x.svg` produces minus the defs the document
  shares, and the viewer is their *sibling*, never their content. The file
  fetches nothing, and its entry view is inline so a reader with script disabled
  still sees a diagram. `test/interactive.test.ts` asserts all three
  mechanically — two `<script>` elements, and nothing executable once they are
  removed.
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
- Performance budgets in docs/ENGINEERING.md are CI-enforced acceptance criteria.

## Layout of the workspace

`apps/spa` — the **site** (Vite/React/Tailwind), four HTML entries from one app:
the landing at `/`, `/install/`, `/lookbook/` and the playground at
`/playground/`. Only the playground is React; the rest are hand-set static
documents sharing `src/tokens.css` via `src/site.css`. `/lookbook/` is generated
from `lookbook/README.md` by `scripts/sync-lookbook.ts`. Everything the site
serves out of `public/` is build output — pack icons (`scripts/sync-packs.ts`),
the demo GIFs and the brand marks (`scripts/sync-media.ts`) — gitignored, never
committed; only `og.png`, `apple-touch-icon.png`, `robots.txt` and `sitemap.xml`
are real files there. Anything absolute must be anchored to
`import.meta.env.BASE_URL`, or it breaks under a deploy sub-path.

**The brand mark is drawn once**, in `docs/assets/mark.svg`, and nothing else
holds a second copy of it. The site's `favicon.svg` is that file, copied at
build time, and does double duty as tab icon and page logo. `mark-stack.svg` —
the layered mark, for wherever the logo runs large — is *generated* from it by
`scripts/mark-stack.mts`, lifting its paths **and** its gradient stops, so a
recolour propagates by re-running rather than by remembering. The one copy that
cannot be derived is `packages/vscode/icon.png` (a VSIX needs a raster), so it
is asserted instead: `packages/cli/test/brand.test.ts` rasterises the SVG and
demands pixel equality. Four byte-identical copies of the mark used to live in
the tree, which was four chances for the brand to drift; two of them disagreed
with the vector for three weeks.
`packages/core` — the engine (see below).
`packages/pack-aws` — 316 AWS icons
(303 services + 13 group/boundary marks), verbatim + dual-licensed (see its NOTICE).
`packages/pack-azure` — 636 Azure icons, verbatim under Microsoft's icon terms,
which permit copying and distributing them **for architecture diagrams, training
and documentation only** — narrower than an open-source licence (see its NOTICE).
Nearly all of them are gradient artwork, which is the one thing that
distinguishes them from the other packs.
`packages/pack-logos` — 147 curated Simple Icons marks (CC0) for the non-cloud
half of a stack; `monochrome: true` in its manifest makes the renderer plate and
tint them.
`packages/pack-k8s` — 39 Kubernetes community icons (dual Apache-2.0 /
CC-BY-4.0 — a real redistribution grant, which is the bar; see the GCP
paragraph below). Canonical ids are kubectl's short names (`pod`, `deploy`,
`svc`); the long names alias to them. The fetch pins an upstream commit and
applies two licence-permitted treatments, both recorded in its NOTICE: strip
Inkscape metadata, and promote `style="fill:…"` CSS into presentation
attributes — the upstream files carry all their paint in `style`, which the
sanitizer drops, so without promotion every icon loads unfilled.
`packages/pack-sys` — 175 curated Lucide icons (ISC): the generic set for what no
vendor draws (servers, hardware, network gear, data/ML concepts) plus plain
shapes as a last resort. Also `monochrome: true`. It is the `sys/*` prefix, and like `builtin` it
resolves with **no `pack` statement** — which is a property of being registered,
not of the DSL: `model.packs` is recorded and never read, so `pack` is a
declaration of intent. Registration is hardcoded in five places, all one-liners:
`core/src/packs/node-fs.ts`, `apps/spa/scripts/sync-packs.ts` +
`apps/spa/src/squinch.ts`, `packages/vscode/scripts/bundle.mjs` (miss it and
`packExists` is false in the bundled extension), and `gauntlet/run.ts` (miss
it and cold agents silently run without the pack). The guardrails test
asserts all five agree.
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
sync/check model (`--sync` writes stamped renders, `--check` re-renders and compares).
It is also the one place that reads the clock, the environment and the network:
`src/update.ts` prints `update:` / `skill:` notices after a successful command
(a once-a-day registry lookup cached under `~/.cache/squinch`, plus the skill's
install stamp against the running version) — never TTY-gated because the reader
is an agent, never on stdout, never beside a failure, off under `CI`;
`docs/notes/update-check.md` records the rejected alternatives. `packages/vscode` — the editor extension:
`src/features.ts` is every piece of editor intelligence as pure functions (unit
tested), `src/server.ts` a thin LSP shell over it, `src/extension.ts` the client
plus preview webview; `test/server.test.ts` drives the *bundled* server over real
stdio LSP. `packages/skill` — the canonical `SKILL.md` and **two plugin
manifests off the one `skills/` dir**: `.claude-plugin/plugin.json` for Claude
Code, and `plugin.json` (Agent Plugins 1.0, `$schema`-declared, closed key set)
for Codex, Cursor, Copilot and the rest. Each has a marketplace manifest at the
repo root pointing back at `./packages/skill` —
`.claude-plugin/marketplace.json` and `.agents/plugins/marketplace.json` — and
`scripts/version.mjs` moves both plugin manifests with everything else. One
product named in two files is two chances to drift, so the agreement is
asserted (`skill.test.ts`), not remembered; core's guardrails assert both
marketplaces still resolve. `examples/` — one directory per project, with
committed SVGs that CI verifies.

## Where things stand

Everything planned for v1 and v1.1 ships: the engine (grammar → model →
visibility/lifting → layout → themed SVG), the CLI (check/render/diff/icons/
init/watch + sync/check model + Actions), the SPA playground, the VS Code
extension + language server, five icon packs, and the light/dark pair. The acceptance
bar — an agent producing clean diagrams from prose using only the skill + CLI —
is certified at **33/33
by independent cold agents**, most recently at **25/33 clean on the first
`check`** (round 25, run on round 24's fixes; fourteen of thirty-three agents
wrote `subtitle:` unprompted in each). Positional tags work on nodes, container heads and
edges; a comma is optional wherever whitespace already separates. `gauntlet/README.md` writes up the latest round only: every round's
findings land as a code or docs change in the same commit, so the fixes are the
record. The number is never the point — a round that scores full marks and
surfaces a crash beats one that scores full marks and surfaces nothing.

Two surface rules, both from measuring what cold agents actually write (367
gauntlet check calls plus a 5-agent probe): **a tag may sit in kind position**
(`db = aws/dynamodb "L" datastore #pci` — 5/5 probe agents wrote that and none
reached for `tags:`), and **a comma is optional wherever whitespace already
separates** (`rows [a, b]`, `align a, b`, `{ style: dashed, animate: slow }`).
Commas stay *required* in a path list, and stay wrong inside a tag value —
`tags: #a #b` — because after a comma there an LR(1) parser cannot tell another
tag from the next attr key; that one is a check error naming the fix. Both
spellings build the same model and render byte-identically.

**Container layout blocks** (2026-09): a `layout { }` inside a `system`/`container`
body arranges its *direct* interior — `rows`/`cols`/`place` and `direction`, written
by short name — wherever that interior is opened: expanded in any view, or as
the root of a view scoped to it (its auto view included). It was "the most common
authoring mistake" for a year, refused with a special-case error; cold agents kept
writing it because that is where the fact lives, and restating one interior in every
view that opens it was a DRY violation the language created. Rules that are not
negotiable: direct children only (a deeper path names the child's own block, an
outside path names the view-level band); the view's own hints replace the block **per
container, all or nothing** — never merged — when they relate two or more of its
members, or, for a scoped view, when it declares any hint at all (SPEC §5's "declaring
`view <path>` *is* the customization" rule); a collapsed container's block is dormant
with no warning; diagnostics point at the block, not the view; the semantic diff
classes it cosmetic like a view's. View-level hints naming leaves inside an expanded
frame (`rows [gw] [app.api]`) now take effect too — they used to render byte-identical
to no hint, silently — via per-frame `semiInteractive` crossing minimisation plus
`elk.position` and interior scaffold edges; `docs/notes/coplanar.md` carries the table
of ELK levers that do and do not reach inside a compound. A second `rows`/`cols`/
`direction` line in one block is a check error (it used to be read as `[0]`).
**Per-container direction** rides the same block: `direction right` in a system's
`layout { }` makes its expanded frame its *own ELK call* — laid out first, deepest
first, with its wall ports as external ports on fixed sides; the root call then sees a
fixed-size leaf with `FIXED_POS` ports (under `INCLUDE_CHILDREN` a compound's own
direction is ignored outright, coplanar.md attempt 4). Every edge crossing a wall is
cut into one segment per call at an ELK *hierarchical port*, then stitched back into
one polyline after layout — the step attempt 4 never tried (approach #7). No directed
frame means one root segment per edge, one ELK call, and the graph built before this
existed. Three ELK behaviours shaped the mechanism, all measured and recorded in the
note: `SEPARATE_CHILDREN` inside the single root call lets the parent drag a port to
the wrong wall; `forceNodeModelOrder` does the same to a `FIXED_POS` port, so a view
holding a directed frame swaps it for semi-interactive ordering with explicit
positions; and a ported compound crashes elkjs when included directly, so the frame
runs `INCLUDE_CHILDREN` beneath a `SEPARATE_CHILDREN` wrapper. Wall ports are
registered as ports so the router's free-port probe and the ports-never-stack
invariant see them; a declared direction equal to the enclosing one is a no-op. A wire
reaching a nested directed frame's wall runs through the enclosing frame's title strip
by geometry (widening the padding only moves the letter it crosses), so a frame title a
final wire crosses is flagged `titleCrossed` and drawn last on a canvas halo — the
zone-chip rule, and it fixed three shipped views that already had a wire through a title.
**`wrap N`** (2026-09) is the one aspect-ratio knob: a Tier-0 statement that folds a
single chain into a serpentine or a single-source fan-out into bands under its
source, as synthesized `rows` (so it is exclusive with `rows`/`cols`, and every
other graph shape warns with the hand-written line to use). The fan's band-skipping
edges are hidden from ELK exactly as coplanar edges are — the engine's own
co-ranking trick — and drawn afterwards as a bus (spine, trunks, drops) by the
router, which is why a hand-written `rows` fold cannot be fixed by routing alone:
ELK's long-edge dummies push the second band outward and no option moves them.
`docs/notes/wrap.md` records the measured negatives (hub-in-the-middle, SIMPLE
placement on chains, left-to-right with a return wire). Fan views alone use SIMPLE
node placement and a FIXED_ORDER source face with a reserved spine slot.
v1.1's DSL is done: zones, flows, tags, channels, cols, align, legend/titleblock,
plus `only`/`detail` (below) and `badge:` — a vendor mark composited onto a leaf's
icon plate at render time (SPEC §nodes, DESIGN §3). It exists because vendors like
Databricks publish no redistributable icons, so a pack for them cannot legally
exist; composing a `sys/*` concept with a CC0 `logos/*` mark ships nothing new and
gives that whole platform a vocabulary. The mark is drawn from the pack manifest's
own brand colour on a quiet plate — never recoloured, never baked into an asset. `color:` (2026-08) is the one colour vocabulary: nine words (`red amber green teal
blue violet pink gray accent`, never hex — `HUES` in `model/types.ts`, one
designed light/dark pair per theme token `hue*`), accepted on leaves, containers,
edges and zones, plus the view lens `color #tag hue` which wins over an element's
own and earns a legend entry. It paints only what is already the element's mark
— a spine on leaves, people and cards, frame stroke, edge + head, zone outline —
so shape and pattern stay the encoding (DESIGN §6). Zones' old role names
(`account`, `network`, …) are gone; kinds still tint by default and the error
for a legacy name writes the replacement line. Leaf and actor spines are
separate elements emitted only when coloured, which is what keeps every
uncoloured render byte-identical.
Deliberately *not* built, with reasons recorded: `route … around`/`via`
(`docs/notes/routing-hints.md` — ELK already avoids nodes) and `grid` (rows and
cols compose to the same thing).
`expand *` is the one deliberate depth ladder (2026-08): it opens every visible
container to leaf depth with frames nesting (fill at depth 0 only — the zones
no-compounding rule), while explicit nested expands stay a check error;
`docs/notes/full-detail.md` records the rejected alternatives (auto-synthesized
full view, viewer toggle, new verb).
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

The **docs/design restyle** (2026-08) is the current visual language, and
`docs/design/README.md` is its source of truth — DESIGN.md §§2-5 were rewritten
to match and the reference render lives beside it. What it changed, in one
place: cards are a gradient surface with a contact shadow, a 3px brand spine, a
40px icon tile, a bordered glyph chip and a 30px shelf (child icons, `+N`, an
optional `domain:` tag); two stacked sheets sit behind every container, drawn
outside its group and bleeding into gaps an invariant proves are empty;
`person` became a real render kind (a filled, borderless actor tile); zones
lost their fill so nesting cannot compound, and their chips gained a segmented
grammar with an optional mono `detail:`; notes lost the amber and gained an
info/warning glyph; the title block moved top-left as a header with a meta
chip, and the legend joined a full-width footer band with the wordmark. New
optional attrs: `icon:`/`domain:` on containers, `detail:` on zones, and the
reserved titleblock keys (`subtitle`, `version`, `commit`, `date`) — none of
them derived, because a render is a pure function of its source. The sketch and
contrast themes were retired in the same work: the anatomy has no hand-drawn or
pure-black translation, and three unreviewed palettes riding every geometry
change cost more than they returned.

Key architecture, still binding: same-rank edges bypass ELK and use
our coplanar router; declared ranks are enforced via invisible scaffold edges; an
expanded container is one "entity" for ranking, and ELK layers freely inside it.
`docs/notes/coplanar.md` records why the router cannot be handed to ELK — four
measured attempts, all closed. In Sugiyama layering a layer *is* a set of nodes
with no edges between them, so no option puts two edge-connected nodes on one
rank; the router is what makes `rows` a feature rather than a suggestion.
Approach #5 (2026-08) extended it to expanded frames: same-rank cross-frame
edges route wall-to-wall through reserved gutters (straight, mid-gutter jog,
or below-row shelf over *unit* rects), which is what lets a full-detail view
lay out wide — hiding the edge from ELK is the entire co-ranking mechanism,
and the router's wires carry `coplanar: true` so the invariant sweep can hold
them to crossing nothing. Approach #6 (2026-09) admitted zones as units on
the same terms — the old "cannot cross a zone boundary" warning is gone, not
reworded, because nothing is unroutable any more — and let each end continue
past the wall to the leaf itself when the corridor between them is provably
empty (never turning inside a compound; that interior is still ELK's).
The hand-built spike harness that proved this is retired, and its canonical
oracle followed (2026-08): label-space reservation legitimately moves node
positions, so second-implementation parity stopped being a meaningful claim.
The architecture it certified is still enforced by the corpus invariant sweep.

## Commands

- `pnpm -r test` — every package. Core suite covers model diagnostics, golden SVG
  byte-compare, XML validity, determinism, corpus geometry. `UPDATE_GOLDEN=1`
  to rebless goldens after an *intentional* visual change.
- `pnpm -r typecheck` — tsc across packages (CI runs this first).
- `node scripts/version.mjs [x.y.z]` — print, or set, the **one** version the
  whole workspace shares (root `package.json` is the truth; a guardrail asserts
  every member matches). The engine, CLI and extension are one product cut
  three ways, so a VSIX, an npm package and the `data-squinch` stamp on a
  render must all answer "which squinch is this?" the same way. Not named
  `version` in the scripts block on purpose — that collides with npm's own
  lifecycle hook.
- Pre-commit hook (husky; `.husky/pre-commit`, wired by the root `prepare`
  script on `pnpm install`): when their sources are staged, regenerates
  `apps/spa/src/examples.ts`, `runtime.generated.ts` and
  `packages/cli/src/skill.generated.ts` (the bundled skill `squinch skill`
  installs — canonical file is `packages/skill/skills/squinch/SKILL.md`,
  generator `scripts/gen-skill.mjs`) and fails until the
  result is staged — the sub-second slice of CI's drift gates. Bypass with
  `--no-verify`, or `HUSKY=0` to disable husky including its install step; the
  slow gates (lookbook, `--check`, tests) stay CI-only. `.husky/_` is generated
  and self-ignoring; never commit it. Note pnpm skips *all* lifecycle scripts
  when an install is a no-op ("Already up to date"), so hooks arrive on the
  next real install rather than on the pull that added them — that is a pnpm
  behaviour, not a husky one.
- `pnpm -r build` — everything, in dependency order. `--filter @squinch/core`
  alone does *not* make the CLI binary runnable: `bin/` runs `packages/cli/dist`,
  which only the CLI's own build writes.
- `node packages/cli/bin/squinch.js <cmd>` — the CLI (check/render/icons/init/watch).
  `render -o x.png` rasterizes via resvg (`src/raster.ts`); rebuild the CLI
  (`pnpm --filter squinch build`) before testing the binary — `bin/` runs `dist/`.
- `node packages/cli/bin/squinch.js render examples/orders --check` — dogfood gate;
  after any intentional renderer change, re-run `--sync` on every example
  project and commit the SVGs, or CI fails. A version bump is not a renderer
  change: `--check` ignores the stamp, so the committed renders keep saying
  which version last drew them until a picture actually changes.
- `cd packages/core && npm run grammar` — regenerate Lezer parser from
  `src/grammar/squinch.grammar`.
- `pnpm --filter @squinch/core bench` — PLAN §2 budgets, plus drift against
  `scripts/bench.baseline.json`: medians recorded **per machine** (timings do not
  compare across them), >25% over your own recorded number fails, sub-5ms
  measurements report but never gate. `npx tsx scripts/bench.ts
  --update-baseline` re-records — do it in the same commit as the change that
  earned the cost. CI has no baseline, so there it is budgets only.
- `pnpm --filter @squinch/spa dev` — the site on :5180 (`.claude/launch.json`):
  landing at `/`, playground at `/playground/`; one Vite app, four HTML entries.
- `npx tsx scripts/mark-stack.mts` — regenerate the layered mark from
  `docs/assets/mark.svg`. Maintainer-only; its header records the measurements
  the shape was reconstructed from.
- `npx tsx scripts/og.mts` — regenerate `apps/spa/public/og.png`, the social
  card: the layered mark lifted from `mark-stack.svg` beside the wordmark in
  the bundled Inter 600, rasterised by resvg with system fonts off. Re-run
  after a recolour; the lockup is the whole card, there is no tagline.
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
