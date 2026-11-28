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
  strategy, and why Lezer and a layout engine of our own.
- `docs/notes/layout-engine.md` — the layout engine (`weft`): why it replaced
  ELK, how it works stage by stage, every decision with its evidence and every
  rejected alternative, how quality is measured and gated, the known weak
  spots, and how to change it safely. `layout-engine-requirements.md` beside it
  holds the rules the engine is held to. Read both before touching layout.
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
  whatever font the machine has. The TTFs keep name ids 16/17 (the typographic
  family): without them Medium and SemiBold were named "Inter Medium" and
  "Inter SemiBold", and resvg drew every weight as Regular — every PNG title a
  weight light for months (`docs/notes/prose.md`).
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
  internal ids, and promote `<style>` class rules onto the shapes as presentation
  attributes — the stylesheet itself cannot be kept, free-text CSS defeats an
  allowlist and Illustrator's `.st0` names collide across icons sharing a
  document, but dropping it leaves Google's icons filled black; values move
  verbatim, and a file with no `<style>` sanitizes byte-identically to before). AWS icons in `packages/pack-aws/icons/` ship **verbatim** under
  CC-BY-ND: never edit, recolour, or "optimize" them — regenerate with
  `npm run fetch`. Theme treatment is render-time only (placement, clipping,
  plates). Renderer note: `clip-path` on a `<use>` stops it instantiating in some
  renderers — always clip a wrapping `<g>`.
- Performance budgets in docs/ENGINEERING.md are CI-enforced acceptance criteria.

## Layout of the workspace

`apps/spa` — the **site** (Vite/React/Tailwind), six HTML entries from one app:
the landing at `/`, `/install/`, `/lookbook/`, `/compare/`, `/privacy/` and the
playground at `/playground/`. Only the playground is React; the rest are hand-set static
documents sharing `src/tokens.css` via `src/site.css`. `/lookbook/` is generated
from `lookbook/README.md` by `scripts/sync-lookbook.ts`. What the documents share
— the head's og block, the header nav, the footer's version line, the rail's
scroll-spy (`src/rail.js`) and the icon and case counts — is written once in
`site-shell.ts` and substituted at build time for placeholders like
`<!--site-header-->`; never paste it back into a page. `/compare/` sets one system beside
five other tools' renders of it; theirs are committed under `compare/` with their
sources, because the build cannot run five toolchains. Everything the site
serves out of `public/` is build output — pack icons (`scripts/sync-packs.ts`),
the demo videos and the brand marks (`scripts/sync-media.ts`) — gitignored, never
committed; only `og.png`, `apple-touch-icon.png`, `robots.txt` and `sitemap.xml`
are real files there. Anything absolute must be anchored to
`import.meta.env.BASE_URL`, or it breaks under a deploy sub-path.

**The brand mark is drawn once**, in `docs/assets/mark.svg`, and nothing else
holds a second copy of it. The site's `favicon.svg` is that file, copied at
build time, and does double duty as tab icon and page logo. `mark-stack.svg` —
the layered mark, for wherever the logo runs large — is *generated* from it by
`scripts/mark-stack.mts`, lifting its paths **and** its gradient stops, so a
recolour propagates by re-running rather than by remembering. The copies that
cannot be derived are the two rasters — `packages/vscode/icon.png` (a VSIX
needs one, 256px) and `packages/skill/.claude-plugin/icon.png` (the plugin
directory's listing icon, 1024px with the mark inset 96px) — so they are asserted instead:
`packages/cli/test/brand.test.ts` rasterises the SVG at each size and demands
pixel equality. Four byte-identical copies of the mark used to live in
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
`packages/pack-logos` — 283 curated Simple Icons marks (CC0) for the non-cloud
half of a stack; `monochrome: true` in its manifest makes the renderer plate and
tint them.
`packages/pack-k8s` — 39 Kubernetes community icons (dual Apache-2.0 /
CC-BY-4.0 — a real redistribution grant, which every pack but `pack-gcp`
has; see its paragraph below). Canonical ids are kubectl's short names (`pod`, `deploy`,
`svc`); the long names alias to them. The fetch pins an upstream commit and
applies two licence-permitted treatments, both recorded in its NOTICE: strip
Inkscape metadata, and promote `style="fill:…"` CSS into presentation
attributes — the upstream files carry all their paint in `style`, which the
sanitizer drops, so without promotion every icon loads unfilled.
`packages/pack-sys` — 200 curated Lucide icons (ISC): the generic set for what no
vendor draws (servers, hardware, network gear, data/ML concepts, and the commerce
row — cart, payment, order, shipping — that round 26 agents reached for and
missed) plus plain shapes as a last resort. Also `monochrome: true`. It is the `sys/*` prefix, and like `builtin` it
resolves with **no `pack` statement** — which is a property of being registered,
not of the DSL: `model.packs` is recorded and never read, so `pack` is a
declaration of intent. Registration is hardcoded in seven places, all one-liners:
`core/src/packs/node-fs.ts`, `apps/spa/scripts/sync-packs.ts` +
`apps/spa/src/squinch.ts`, `packages/vscode/scripts/bundle.mjs` (miss it and
`packExists` is false in the bundled extension), `gauntlet/run.ts` (miss
it and cold agents silently run without the pack), and `SHELF` in
`apps/spa/site-shell.ts` — the landing's icon card, a row per pack with seven
picked marks, where a pick the pack no longer has fails the build — plus the `PUBLIC` allowlist
in `guardrails.test.ts`. The guardrails test asserts all of them agree.
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
`packages/pack-gcp` — 45 Google Cloud icons: the **current** (2025) system
only — 19 core-product marks (4-colour) and 26 category glyphs (2-colour) —
never the 216 legacy per-service icons, which Google's own PDF says "should not
be used as of 2026". Every other product draws as its category glyph by
Google's design, and `pack.json` encodes that as ~280 aliases (`gcp/pubsub` →
`data-analytics`, `gcp/cloud-functions` → `serverless-computing`), so an agent
writing from prose gets the glyph Google would use rather than a dead id; the
label carries the product name. It is the one pack with **no redistribution
grant**: Google publishes the library "for your diagrams, technical
documentation, and more" and says nothing about redistributing it, every
comparable tool (draw.io, `diagrams`, Iconify, PlantUML sprites) has shipped it
for years unchallenged, and its NOTICE states that footing in full — do not
soften it. The fetch pins Google's unversioned ZIPs by SHA-256 and `release` is
the PDF's "Updated" date. Sixteen of the files carry their paint as `<style>`
class rules; they ship verbatim and the sanitizer promotes the rules at load
(the bullet above), never the fetch script.
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
stdio LSP. `packages/skill` — the canonical skill **directory** and **two plugin
manifests off the one `skills/` dir**. `skills/squinch/SKILL.md` is the body
(loop, hand-over, quality bar, language, views, layout hints) and
`skills/squinch/references/` the lookup material it points at one level deep —
`cookbook.md` (symptom → fix) and `icons.md` (ids per pack, in full) — split
(2026-10) because a harness keeps only a skill's first few thousand tokens
after compaction. Round 31 measured the split: no cold agent opened either
file in fifty sessions, the cookbook moved without a trace because the
diagnostics carry their own fixes, and moving the icon lists out cost six
first checks to guessed ids until compact per-pack id runs went back into the
body — for a cold agent the inline lists are *vocabulary*, not lookup
(`gauntlet/README.md`). Every consumer carries the directory, never the file:
`scripts/gen-skill.mjs` bundles every file under it into `SKILL_FILES`,
`squinch skill` writes the set (stamping SKILL.md, replacing `references/`
whole), `--print` streams it under per-file comments, `update.ts` reads the
stamp from SKILL.md alone, and `gauntlet/run.ts` plants the whole directory in
each box and reports which reference files the agents opened. The two
manifests: `.claude-plugin/plugin.json` for Claude
Code, and `plugin.json` (Agent Plugins 1.0, `$schema`-declared, closed key set)
for Codex, Cursor, Copilot and the rest. Each has a marketplace manifest at the
repo root pointing back at `./packages/skill` —
`.claude-plugin/marketplace.json` and `.agents/plugins/marketplace.json` — and
`scripts/version.mjs` moves both plugin manifests with everything else. One
product named in two files is two chances to drift, so the agreement is
asserted (`skill.test.ts`), not remembered; core's guardrails assert both
marketplaces still resolve. `packages/skill` is the plugin directory itself,
so it holds **only what Anthropic's plugin directory accepts from an unverified
publisher** — Markdown, JSON, the PNG icon: no `package.json`, no source, no
tests, no `.svg`. A submission was refused for exactly that, so the folder is no
longer a workspace member and its tests (`skill.test.ts`) live in
`packages/core/test/`, which also asserts the folder stays that way. `examples/` — one directory per project, with
committed SVGs that CI verifies.

## Where things stand

Everything planned for v1 and v1.1 ships: the engine (grammar → model →
visibility/lifting → layout → themed SVG), the CLI (check/render/diff/icons/
init/watch + sync/check model + Actions), the SPA playground, the VS Code
extension + language server, six icon packs, and the light/dark pair. The acceptance
bar — an agent producing clean diagrams from prose using only the skill + CLI —
is certified at **42/42
by independent cold agents** on the committed corpus; the latest full round scored
41/42 with **32/42 answered in one `check` call** (round 40, after the icon
packs grew: no agent hit an unknown icon, where `sys/api` alone had missed 15
times; its one engine finding, an 8px jog where a wire enters a frame, is held
out of the corpus as a follow-up, `gauntlet/README.md`); round 39 before it,
41/42 and 30/42, the third on the legend overhaul (no legend diagnostic fired,
and the two its predecessors surfaced — a key on a highlighted tag, a cadence
the scorer could not see — are fixed; the miss is 20 again); round 36 before it,
41/42 and 31/42, the first with
`about` and formatted prose: prompt 42 asks for a context section above the
diagram without naming the feature, and its agent wrote a formatted `about` in
one call; the round's two engine findings — a chain of four hops or more
cascading into "`fields` on an edge" errors, and two view statements on one
line getting a bare syntax error — are fixed, the first by parsing the chain;
the miss, 20, drew a sync job as an edge and passed two of three re-runs;
round 35 before it, 39/40 and 29/40, the first with
relationship marks: the new schema prompt put every mark on the right end and
the two table prompts that give no counts drew none — prompt 41, added after
it, is the clean control, tables with nothing said between them; the one
miss, 28, was a view that did not narrow, and passed three re-runs — `gauntlet/README.md`;
round 34 before it, 39/39 and 28/39, the first on the
`weft` layout engine; round 33 before it, 38/39 and 29/39, run after the first
outside test of `fields` changed where they draw — `gauntlet/README.md`,
`docs/notes/fields.md`; round 32 before it, 28/39, added a leaf's `fields` and
a schema prompt;
round 31 before it, 20/38, measured the skill becoming a directory; round 30 before it, 18/38, run to check that
moving the quality bar above the language — Claude Code keeps only a skill's
first 5,000 tokens after compaction, and the checklist sat last — left the
hand-over intact: all 38 agents rasterised a view, ran `--sync` and wrote the
HTML. Round 29 had put that hand-over in: the agent looks at a render, draws
nothing the request does not support, and ends with plain bullets — where to
open it, what it guessed, what it saw. Round 30's first failures became two
grammar fixes, a block on top-level `person` and a comma list on
`expand`/`preview`/`detail`, and its confirmation runs surfaced a seam
between the two edge routers layout had then — a label parked on the crossing
of a wire the other router drew — which is one of the reasons there is now
one (`docs/notes/layout-engine.md` §1). 34, the large-system prompt that had varied
since round 26, now says what it is for — "an overview page that fits on one
screen, and then a page for each part of the system" — because six cold runs
on the old wording passed none, every one declaring a single view and calling
the automatic views its altitudes, and six on the new passed all six;
rewording the skill's big-system section was measured first and moved
nobody, as round 26 had also found, so it was not kept). Prompt 38 is the first about real code: a prompt may name a `repo` at
a pinned commit, which `run.ts` checks out into the box, and the scorer's
`labels`/`edges` hold the agent to the call graph the code has. Online
Boutique passed one cold run in three — both misses never opened a service
whose call they then left out. Positional tags work on nodes, container heads and
edges; a comma is optional wherever whitespace already separates. `gauntlet/README.md` writes up the latest round only: every round's
findings land as a code or docs change in the same commit, so the fixes are the
record. The number is never the point — a round that scores full marks and
surfaces a crash beats one that scores full marks and surfaces nothing. Round
34 (2026-11-15) was the first on `weft`: 39/39 deep, 28/39 clean on the first
`check`, and no agent hit a layout error — 01 and 27, which always failed first
on "runs upward", were clean in one call. The count did not move because what is
left was never layout: attributes outside the braces, guessed icon ids, chained
edges, `scope` on a leaf, each fixed in one step from its diagnostic. Every round
before 34 ran on the ELK-based layout.

Two surface rules, both from measuring what cold agents actually write (367
gauntlet check calls plus a 5-agent probe): **a tag may sit in kind position**
(`db = aws/dynamodb "L" datastore #pci` — 5/5 probe agents wrote that and none
reached for `tags:`), and **a comma is optional wherever whitespace already
separates** (`rows [a, b]`, `align a, b`, `{ style: dashed, animate: slow }` — and,
since round 34, attributes on one line with nothing between them at all:
`{ tags: #poll  animate: pulse }` was a bare syntax error two agents hit).
Commas stay *required* in a path list, and stay wrong inside a tag value —
`tags: #a #b` — because after a comma there an LR(1) parser cannot tell another
tag from the next attr key; that one is a check error naming the fix. Both
spellings build the same model and render byte-identically.

**Container layout blocks** (2026-09): a `layout { }` inside a `system`/`container`
body arranges its *direct* interior — `rows`/`cols`/`place`, `direction` and `wrap`,
written by short name — wherever that interior is opened: expanded in any view, or as
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
classes it cosmetic like a view's. A second `rows`/`cols`/`direction` line in one
block is a check error (it used to be read as `[0]`). View-level hints naming leaves
inside an expanded frame (`rows [gw] [app.api]`) take effect by the same rule that
serves the block: the planner projects every hint onto each container's direct
children (`src/layout/plan.ts`), and a zone is a container like any other, so hints
reach inside zones too and may name a zone by its id.
**Per-container direction** rides the same block: `direction right` in a system's
`layout { }` lays its interior out rightward wherever it is opened, inside a view that
still flows down. In the engine a rightward container is a downward one with the axes
exchanged, exactly (`weft/frame.ts` is the only file that knows which axis is x), so
it needs no second layout and a directed frame inside a frame of the other direction
is nothing special; a declared direction equal to the enclosing one is a no-op. Edges
crossing its wall run on to the leaf they name. A wire that has to turn anyway enters
a titled frame clear of the title; one running straight on into the first box may
pass the end of the title, and a frame title a final wire crosses is flagged
`titleCrossed` and drawn last on a canvas halo — the zone-chip rule. A jog to avoid a
title was judged worse than a wire behind it; do not "fix" it by widening padding.
**`wrap N`** (2026-09; any shape since 2026-11) is the one aspect-ratio knob: no row
holds more than N. It folds every row wider than N, in the view and in every
container the view opens; a container's own `wrap` follows it wherever it is opened,
expanded or scoped. A fold is synthesized `rows` (`wrapRows` in `plan.ts`), so it is
exclusive with `rows`/`cols` — a check error — and a container the view arranges by
hand is not folded. One chain folds as a serpentine; anything else keeps its ranks
and splits each wide one into bands that stand in columns, with the wires from one
source into the later bands (and from the earlier bands on to one target) drawn as
one trunk — the engine's ordinary `bundle`, the same thing `channel` is; `via: "bus"`
on a `PEdge` only tells the renderer a wire is a wrap trunk. The one warning left is
"`wrap N` has no effect — no row here is wider than N". `docs/notes/wrap.md` keeps
the picture-level decisions (serpentine over a return wire, the source above its
bands, why `direction right` turns a fold into columns).
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
own and is what a legend's `#tag` key shows. It paints only what is already the element's mark
— a spine on leaves, people and cards, frame stroke, edge + head, zone outline —
so shape and pattern stay the encoding (DESIGN §6). Zones' old role names
(`account`, `network`, …) are gone; kinds still tint by default and the error
for a legacy name writes the replacement line. Leaf and actor spines are
separate elements emitted only when coloured, which is what keeps every
uncoloured render byte-identical.
Deliberately *not* built, with reasons recorded: `route … around`/`via`
(`docs/notes/routing-hints.md` — no wire passes through a node it does not end
on, so there is nothing to steer around) and `grid` (rows and cols compose to
the same thing).
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
**Relationship marks** (2026-11): an edge between two tables may carry `from:`
and `to:`, one of six words per end (`one many exactly-one zero-or-one
one-or-many zero-or-many`), drawn as crow's-foot marks in place of the
arrowhead. Rules that are not negotiable: both ends or neither; only between
two leaves on a plain `->`/`--` edge; any lift drops both marks; a trunk's
shared end carries one mark and refuses edges that disagree; `lines straight`
draws none and says so; nothing is derived from `fields` or `ref`. Plain `one`
and `many` exist because optionality is usually not in the source — a guessed
ring on a reviewed diagram reads as a fact. Wrong spellings that parse
(`zero-or-more`, `cardinality: many-to-one`, `from: east`) get an error that
writes the line; ones that do not (UML ranges, Mermaid operators, marks
outside the braces) are plain syntax errors on purpose — a step that
repaired them before the parse was built, reviewed twice and removed, because
no cold agent writes them once the skill teaches the syntax. The
engine's part is `Wire.tips`: labels keep off a marked end, and a port moved
to straighten its wire keeps 16px from a marked neighbour. A table's head in a
rightward view holds four; from five the view warns, naming the table. `docs/notes/relationship-marks.md` has the two
probes, the rejected shapes and what four reviews changed.
**Prose** (2026-11): a view's `about` — prose set in the header under the title,
the drawing moved down to make room — and a note's text share one closed set of
formatting (`src/prose.ts`): paragraphs, `- ` bullets, `**bold**`, `` `code` ``,
`[text](https://…)`. Anything else is drawn as typed and warns; a non-http(s)
link stays text and warns. A `"""` block string spans lines anywhere a string
goes, dedented; prose keeps its lines, everything drawn on one line reads them as
spaces. Prose is never cut: a note grows past its old three lines, and past six
the check points at `about`. It exists because a user's agent, with nowhere to put
a context paragraph, edited the rendered SVG and `--check` failed from then on.
Layout and renderer read one wrap (`setProse`); runs on one line are measured in
their own face and drawn unkerned. `docs/notes/prose.md` has the rejected shapes.
**The legend** (2026-11): `legend { #money "Payment path"  -> "Request" }` —
a list of what the marks mean, written by the author; squinch draws each swatch
from the picture (the arrow's own dash and heads, the ×n pill, hatched and
dashed cards, a chip in a tag's hue). Keys are the four arrows, `aggregated`,
`external`, `context` and any tag a view colours; every line needs a label and
none is written for you. A view shows the entries it draws and silently leaves
the rest, so one block goes in every view — matched on the *laid-out* view
(`view/legend.ts`), stored theme-free on `Positioned`. One band under the
drawing, wrapping at the canvas width, no title, no wordmark. `legend auto` —
which chose its own entries and labelled them `sync`/`async`/zone kinds —
renders with no legend and warns, naming the keys to write; never an error,
never an automatic migration. Not keys: zones, flows (a flow's name goes in the
view's `title`), colour or style words. `docs/notes/legend.md` has the three
revisions' rejected shapes (automatic entries, default labels, side/corner
placement, exact-mark tag swatches, a "matches nothing" warning).
**The detailed card** (2026-09): `preview <path>` / `preview *` in a view draws a
collapsed card taller, with the children its `preview:` attr names as readable
rows (up to three; `auto` = the first three declared, *direct* children — a
nested container is one row wearing its card face). Still a card: wires land on
it, a dive opens it, `only`/context never see the rows. The list lives on the
container (a fact about the system), the verb in the view (a fact about this
picture) — `docs/notes/preview-card.md` has the rejected shapes (filtered frame,
tile strip, auto top-N). The same work made `preview: [a b]` actually parse; SPEC
had promised it from v0 and the strip silently showed the first three leaf icons.
**Pan and zoom** (2026-09) is one camera shared by the playground and the
interactive export: `view/camera.ts` is the arithmetic, `view/camera-dom.ts` the
controller (browser entry only, unstable), bundled into the export's runtime and
called from a React effect in `Stage.tsx`. Drag and scroll pan, pinch or
Ctrl/⌘+wheel zooms at the cursor. The transform sits on a wrapper around *both*
dive layers, the dive runs unchanged in the camera's local space, and every
view arrives fitted — width-fitted from the top, as it always opened. Not
negotiable without reading `docs/notes/pan-zoom.md`: a press is captured only
once it is a drag (capture-on-down retargets the click), a gesture never
cancels a pending paint, and React holds none of the camera's state.
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
chip, and the legend joined a full-width footer band (the wordmark that rode it
is gone since the legend overhaul, below). New
optional attrs: `icon:`/`domain:` on containers, `detail:` on zones, and the
reserved titleblock keys (`subtitle`, `version`, `commit`, `date`) — none of
them derived, because a render is a pure function of its source. The sketch and
contrast themes were retired in the same work: the anatomy has no hand-drawn or
pure-black translation, and three unreviewed palettes riding every geometry
change cost more than they returned.

**Layout is an engine of our own, `weft`** (2026-11; `src/layout/weft/`,
`docs/notes/layout-engine.md`). Key architecture, still binding:
`layoutView` is plan → solve → dress → annotate. `plan.ts` is the only file that
knows both vocabularies: it turns a view into a `Problem` — a tree of containers
(root ⊃ zones ⊃ expanded frames ⊃ leaves) with the hints projected onto each
container's direct children, sizes, note room and route sides — and raises the
diagnostics. `weft/` solves it knowing nothing about Squinch. `layout.ts` dresses the
`Solution` as `Positioned`; `annotate.ts` and `notes.ts` place badges, chips, crossed
titles and notes on the result. Inside the engine: a rank is a constraint, not a
property of the algorithm, so two connected nodes may share one and a pinned band
never splits; every container gets a *sheet* whose slots (boxes, a lane per passing
wire, a port per wire through a wall) are fixed before anything has a position; the
order of every row in the whole tree is searched as one state against **one exact
count of the crossings that will be drawn**, a container's wall counted on both
sides; and only then is geometry laid, innermost first, once. Nothing later sends
anything back to ranking or ordering, and no layout is drawn to be compared with
another — the two engines that did that were the ones replaced.
Decisions that are not to be relitigated without reading the note, because each
was made on evidence recorded there: **balance and symmetry outrank straightness —
a box is never moved off the middle of its fan to straighten a wire** (the owner
rejected an engine, `braid`, that had better bend counts and did the opposite);
**declaration order is worth a tie, not a crossing**; boxes line up on centres on
one 8px grid and ports slide to meet wires; canvas size is not a goal; **leaves do
not grow to straighten their fans** (tried: corpus bends 707 → 425, no violations,
pictures not better — width reads as importance, and adding a wire would resize a
box; if it returns it is author-asked, never wiring-decided).
What the language gained, all of it things that were errors or warnings only
because the old engine could not draw them: every wire ends on the leaf it names,
also inside containers and zones; an edge running upward between declared rows —
in a view or in a container's own block — is drawn, and no "hint conflict … runs
upward" diagnostic exists at build or layout time; a band is kept whole whatever
unlisted node lies between its members; two members of one expanded container may
share a row with an edge between them; rank hints reach inside zones; `align` and
`cols` are solved as constraints, inside containers too (an aligned set takes one
node of a rank — two row-mates cannot share an axis, so the rest stay side by side
and the check says so; no contradiction among hints can overlap boxes). Hint *contradictions* are
still errors (`place a right-of b` + `place b right-of a`, a `place` against its
band, a second `rows` line, two `route` lines asking one end of an edge for two sides). Layout-time warnings that remain, each naming its hint:
`align`/`cols` on one rank ("cannot share an axis") or across containers ("could not
be put on `x`'s axis"); `route` sides on a same-rank edge ("sides are ignored") or
where the named node's own side cannot be given — one sentence per cause, naming the
node and the side, and a fix line for each (the engine reports them in screen terms,
`Refusal`; the words are not re-derived in `layout.ts`): the edge is in a `channel` or
`wrap` trunk, the node is row-mate to what holds the other end, or the edge leaves the
node's container through what is a side wall in that container's own direction and
the node was asked for the side facing away — whose fix names the sides that work
there ("could not use the east side of `a` — …");
a `route` that names no edge the view draws (it says whether to write the card or the
node inside); a `wrap` that folds nothing; a `channel` not fully visible; and "`a` →
`b` is not drawn — one end is inside the other".
**A `route` side carries through every container wall, and a side holds any number of edges** (2026-11):
`route shop.api -> audit from east` leaves API eastward and leaves Shop's east wall
too, through each frame and zone in turn — past a row-mate as well, the edge going
over or under it from a lane beside the node. The first version carried only while
nothing stood between, and turned the wire down inside the frame when Cache happened
to stand east of the API — the complaint the feature was built to end. One side is
still held back at each end: the one facing back against the edge's own way (`from
north` or `to south` on an edge that runs down; west and east in a rightward view)
carries through a wall only while what the edge has reached stands in the first (last)
row inside it; at the first wall where it does not, the edge turns beside what it has
reached, because carried always it climbed out of every frame and came all the way
round (+330 crossings on 600 generated diagrams). Inside a container that flows the
other way, that side is refused with a warning unless nothing stands beside the node
in its row on that side. An edge that ends at the
expanded container is asked of the frame's wall. A node's side wall is allocated like
its top or bottom (`weft/sides.ts`): wires hooked in from above highest, wires
straight out between, wires hooked out downward lowest, nested so that none crosses
another where they leave it; through a frame's wall they keep the order the wall
outside needs (`comesAt`, read last by `order.ts` for a frame that flows the other
way) — so two edges asked out of one side both get it, and "that side is taken" is
no longer a diagnostic. Limits, each recorded with its reason: toward a row-mate of
the container the side is not carried (the edge leaves toward it); past four edges on
one side of an ordinary node they stand closer than 16px, sharing the side out evenly,
with no warning; honouring sides asked at random costs crossings (the note's table).
Long rows are slow to order whether sides are asked or not (80 wires between two
containers of ten-node rows: about 15 s) — the search, not the hooks. Naming a side per wall was considered
and not built (zones are in no path; frames depend on each view's `expand`) —
`docs/notes/layout-engine.md` §8. The zone errors are unchanged. Notes get room reserved by the engine: beside
the anchor node (`Box.room` — inside its frame or zone, and never part of the box, so
a node is balanced as if it had no note) or beside the wire.
**Not guaranteed**, and written down so nobody assumes otherwise (the note's §8): the
ordering search is a descent with one restart and can stop at a local minimum on
dense diagrams — some random diagrams cross more than ELK's did; a side-routed wire
(`route … from/to`) does not pull its node toward where it is going (which way round
its node a wire out of the top or bottom goes is chosen by the ordering search, for
fewer crossings and then the nearer side — it used to turn east always); canvases are tighter
than ELK's, so corner notes sit closer to content; and a label can still be crossed
by another wire where room cannot be given — wires between two row-mate containers,
whose ports are fixed by their insides (3 labels in one set turned rightward, about
one random Problem in five hundred; counted as `labelOnWire` in the quality baseline
so it cannot grow). What *is* held everywhere — on every corpus view, on four
diagram sets drawn both ways, and on seeded random Problems: no boxes overlap
whatever the hints say, no wire through a box it does not end on, every edge drawn,
no two wires along one line outside a trunk, no label on a box or on another label,
and in the corpus no label on another edge's wire. A label gets there in two steps:
it moves along its own wire to a clear place, and only one with none is given room,
the sheets then laid out again (never re-ordered), at most twice — the single place
a drawing feeds back. Claiming room for every label up front was tried first and
rejected (lopsided +8). Four breaks found after the swap — `align`/`cols` on one
rank overlapping, the same across containers, a `route` side at a container dropped
silently, labels across neighbouring wires — are fixed, and the note's §8 says how.
Decided and not to be reopened without new evidence: a stage that branches stands
between its two successors, in a pipeline too.
**ELK was replaced, not wrapped** (commit `c95ab03`; `elkjs` is gone, and no
dependency took its place). In Sugiyama layering a layer *is* a set of nodes with
no edges between them, so ELK needed a second hand-written router beside it for
same-rank edges, a third for `wrap`, and post-passes for `channel` and `align` — and
every bug class of the last year lived in the seams between them. Four engines were
written to get out (`grid`, `loom`, then two cold rewrites from a requirements
document, `braid` and `weft`); the first three are in git history only. At the swap,
ELK → weft on the corpus: crossings 73 → 22, bends 1,174 → 705, layout time 2.5 s →
0.25 s. The record is `docs/notes/layout-engine.md`, with the round-by-round history
in `layout-engine-spike.md`; `coplanar.md`, `wrap.md`, `edge-labels.md` and
`note-placement.md` are cut down to the policies that survived the engine.

## Commands

- `pnpm -r test` — every package. Core suite covers model diagnostics, golden SVG
  byte-compare, XML validity, determinism, corpus geometry. `UPDATE_GOLDEN=1`
  to rebless goldens after an *intentional* visual change.
- `pnpm -r typecheck` — tsc across packages (CI runs this first).
- `cd packages/core && npx vitest run test/weft/` — the layout engine's own
  suites: module and whole-Problem unit tests, a legality audit over seeded
  random Problems, the language suites (hints drawn as asked), and
  `sets.test.ts`, which draws every view of four diagram sets both ways,
  allows no broken rule, and fails when a quality total (crossings, bends,
  jogs, near-misses, lopsided boxes…) is worse than
  `test/weft/quality.baseline.json`. `UPDATE_QUALITY=1` re-records the
  baseline — same commit as the change that earned it, and only after looking
  at the pictures that moved (`docs/notes/layout-engine.md` §9).
- `pnpm release [x.y.z]` — cut a release from a clean `main` (CONTRIBUTING
  "Cutting a release"). Its draft is the commit list with each new lookbook
  case's and example's SVG embedded under the commit that added it
  (`scripts/release-shots.mjs`); the notes that ship are prose, written by the
  `/release` project skill (`.claude/skills/release/`) and approved by the
  maintainer before it tags. Never run it without `--dry-run` unasked — a tag
  push publishes to npm.
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
  landing at `/`, playground at `/playground/`; one Vite app, six HTML entries.
- `npx tsx scripts/mark-stack.mts` — regenerate the layered mark from
  `docs/assets/mark.svg`. Maintainer-only; its header records the measurements
  the shape was reconstructed from.
- `npx tsx scripts/og.mts` — regenerate `apps/spa/public/og.png`, the social
  card: the landing's h1 lockup (`.hero-brand`) at three times the size — the
  layered mark lifted from `mark-stack.svg` beside the wordmark in the bundled
  Inter 600 and the two eyebrow lines in IBM Plex Mono 600, cut from core's
  `@fontsource` source face at run time — rasterised by resvg with system
  fonts off. Re-run after a recolour or a change to the lockup's copy; the
  numbers in the script are `site.css`'s, scaled, so change them there first.
- VS Code extension: <kbd>F5</kbd> ("Run Squinch extension") bundles core + the
  extension and opens `examples/` in a dev host; or
  `pnpm --filter squinch-vscode build`.

## Layout of @squinch/core

`src/grammar` (Lezer DSL grammar → generated parser) → `src/model` (tree → semantic
model + SPEC §9 diagnostics, did-you-mean) → `src/layout` (`plan.ts`: a view → a
`Problem` of boxes and wires; `weft/`: the engine that solves it, with its own
README mapping modules to rules; `layout.ts`: the solution dressed as `Positioned`;
`annotate.ts`/`notes.ts`: badges, chips, notes; `sizes.ts`: the one source of
sizes) → `src/render` (Positioned + theme → SVG, icons inlined as
deduplicated `<symbol>`/`<use>`) → `src/themes` (DESIGN.md token sets);
`src/packs` holds the pack registry + sanitizer. Grammar note: comments are `//` only — `#` is
reserved for tags.
