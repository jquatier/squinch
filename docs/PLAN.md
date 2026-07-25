# Squinch — Implementation Plan

> Naming: `.squinch` files, CLI published as bare `squinch` on npm, packages
> `@squinch/*`. See [SPEC.md](SPEC.md) for the DSL, [DESIGN.md](DESIGN.md) for the
> design language.

## 1. Repo shape

New monorepo (pnpm workspaces + turborepo), **Apache-2.0** (explicit patent grant for
enterprise comfort; icon assets carry their own licenses per pack — see each pack's NOTICE):

```
packages/
  core/        # the whole pipeline, pure & deterministic:
               #   parse (Lezer) → model → layout (ELK.js) → <Diagram/> React SVG renderer
               #   also: themes, diagnostics, pack resolution, system-card rendering,
               #   built-in `sys` + `builtin` glyph packs (first-party, theme-tintable)
  pack-aws/    # AWS icon pack: verbatim SVGs, dual-licensed (see NOTICE)
               # (pack-logos/ from Simple Icons follows in v1.1)
  cli/         # squinch check | render | watch | icons search/vendor | fmt  (uses core headlessly)
  skill/       # the agent skill: grammar guide, examples, layout cookbook, loop instructions
apps/
  spa/         # playground (Vite + React + shadcn/ui + CodeMirror)
  vscode/      # [v1.1] preview webview (reuses core renderer) + LSP
```

## 2. Tech choices & rationale

| Choice | Why |
|---|---|
| TypeScript everywhere | one language across core/CLI/SPA/VSCode; core stays DOM-free except the renderer entry |
| **Lezer** for the parser | one grammar drives parsing, CodeMirror syntax highlighting, error recovery, and LSP tokens; incremental reparse for live preview |
| **ELK.js** for layout | the only OSS engine with layered layout + ports + hierarchy + orthogonal routing — needed for Tier 1/2 hints (rank pinning → `layerConstraint`/partitions, sides → ports) |
| React + plain SVG renderer | shared verbatim by SPA, VSCode webview, and CLI (render via headless React → SVG string; PNG via resvg/sharp) |
| Vite + shadcn/ui, "precision instrument" chrome (DESIGN.md §10) | professional, canvas-as-hero; light + dark from day one |
| CodeMirror 6 editor pane | native Lezer integration; diagnostics gutter from `squinch check` |
| PNG export via `@resvg/resvg-js` in CLI | deterministic server-side raster without a browser |

Determinism contract: same (source, packs, theme) → byte-identical SVG **per tool
version** (upgrades = one atomic regenerate commit; the Action and `squinch.lock` pin the
version). ELK options fixed, no randomness, sorted iteration everywhere, LF line
endings in emitted SVG regardless of platform. Enforced by snapshot tests.

**Text metrics (design-in from day 0 — the #2 technical risk after ELK fidelity):**
layout must never ask the environment how wide text is. Bundle one font with
precomputed metrics tables; measure labels against those. Exported SVGs embed a
subsetted woff2 data-URI so GitHub `<img>` rendering (no external font loads) matches
the layout exactly. Non-Latin/emoji labels measured via the same bundled-metrics path
(fallback metrics per script), never via canvas/DOM measurement.

**Pack security:** all pack SVGs are sanitized at load (allowlist elements/attrs;
strip `<script>`, event handlers, `<foreignObject>`) — they render into SPA, VSCode
webviews, and committed files.

**Renderer visual bar:** [DESIGN.md](DESIGN.md) is a requirements document for the
renderer, not decoration — fixed node heights + snapped width tiers, grid-quantized
positions, perpendicular edge stubs, deterministic port distribution, crossing hops,
label chips with halos, container recession, half-pixel stroke alignment. The sketch
theme's rough.js jitter is seeded from `hash(source)` so it stays byte-deterministic.

Performance budgets (acceptance criteria, not aspirations — enforced by benchmarks in
CI): incremental reparse < 10ms per keystroke (Lezer); full parse < 50ms and
layout+render < 500ms for a 200-node model; SPA keystroke-to-preview < 250ms for
typical (< 50 node) views via debounce + memoized layout per unchanged container.
Landscape-scale models (500+ nodes) may degrade gracefully (spinner, virtualized
rendering) but must never hang the editor pane.

## 3. Build phases (v1)

**Phase 0 — spike (goal: kill risk early; timebox ~3 days).** Hand-build the model
for the canonical example (no parser), push it through ELK with rank pinning + port
sides, render SVG with AWS icons. *Proves the layout-control thesis before any
grammar work.*

Exit criteria (pass/fail, no vibes):
1. `rows` pinning: the three declared ranks land exactly as declared, stable under
   adding one extra node.
2. `place sync right-of db` holds without wrecking the surrounding layout.
3. `route db ~> sync from east to west` exits/enters the declared sides.
4. Fan-in stress: 3+ edges into one side of `db` render with spread ports + stubs
   (post-processing on ELK output is allowed — the question is whether we can polish
   ELK, not whether ELK does it natively).
5. Text-heavy labels laid out via bundled font metrics; output byte-identical across
   two runs and two machines (macOS + Linux CI).

All five pass → proceed to Phase 1. Any fail → decision gate, in order of preference:
different ELK options/algorithms, post-processing workaround, relax the specific hint's
contract, or (last resort, big scope) custom layered layout.

**Phase 1 — core pipeline.** Lezer grammar for SPEC §8 (minus [v1.1]/[v2] marks) →
model builder with multi-file project merge + diagnostics (did-you-mean via
levenshtein against ids/icons) →
layout mapping (Tier 0/1 + `route from/to` sides) → themed SVG renderer (light/dark),
including **system cards** for collapsed containers (needed by the nesting demo; a
starter `sys` glyph set of ~10 covers v1, growing to ~30), descriptions/tags with
`highlight` dimming, and anchored notes. Golden-file tests: `.squinch` in, SVG snapshot
out, for every SPEC example.

**Phase 2 — surfaces.** CLI (`init` scaffolder, `check` with `--format json`,
`render`, `icons search`, `watch`, plus the lockfile model: `render --sync` emitting
dual-theme SVGs + `<picture>` snippet, and `render --check` for CI staleness —
shipped with a ready-made GitHub Action) and SPA two-pane playground (editor +
last-good live preview, view navigation/breadcrumb, theme toggle, export SVG/PNG,
share-by-URL with source compressed in the fragment). DX metric to watch:
minutes-to-first-rendered-diagram via `npx squinch init`. AWS pack built per the licensing plan (verbatim bundle, dual-licensed). Phase 2 also builds the
**lookbook** (DESIGN.md §9): ~15 curated reference diagrams rendered in every theme,
snapshot-locked — the beauty bar alongside the gauntlet's correctness bar, doubling
as the repo's example gallery.

**Phase 3 — the loop.** Write the skill (grammar guide, layout cookbook, the
drift-defense recipe: read Terraform/CDK → query model via MCP → PR the update, and
the diagram-Q&A recipe: explain a system over MCP queries + descriptions); run the
acceptance gauntlet: 10 natural-language
architecture prompts (the canonical one plus 9 varied) driven by a coding agent using
only the skill + CLI. **v1 ships when ≥8/10 reach a clean diagram with zero human layout
fixes.** Iterate on error messages and the layout cookbook until that bar is met — this
gauntlet is the product's actual test suite.

**v1.1:** VSCode extension + LSP, sketch theme (rough.js), animated `~>` edges
(implemented as CSS `stroke-dashoffset` keyframes so animation survives GitHub README
`<img>` embeds — no JS in exported SVG, ever),
Tier 2 channels/`around`, semantic diff (`squinch diff`), zones (ELK cross-hierarchy
frames — needs its own mini-spike), numbered flows, legend/title block, Cmd-K search,
`pack-logos`. **v2:** federation/imports, drag-to-hint writeback, flow stories, more
packs.

## 4. Key risks

1. **ELK hint fidelity** — Tier 1/2 semantics must map cleanly onto ELK options; hence
   Phase 0. Plan B is a purpose-built layered layout (significant scope add).
2. **AWS icon licensing — resolved**: bundle verbatim SVGs, dual-licensed
   (pack code under the repo license / icons CC-BY-ND 2.0 + attribution + trademark
   NOTICE), regenerate from
   the official zip via a build script. Constraint to engineer around: **no modifying
   the SVG files** — dark-mode/sketch treatment must be render-time (CSS filter,
   backdrop plate), not asset edits.
3. **Grammar churn** — expect breaking DSL changes pre-1.0; mitigate with `squinch fmt`
   auto-migrations and a version pragma if needed.
4. **Scope gravity** — the SPA can eat infinite polish; Phase 3's gauntlet, not UI
   features, is the release gate.
5. **Text-metrics determinism** (see §2) — if label measurement leaks to the
   environment, byte-identical rendering and the lockfile model both collapse.
   Phase 0 spike must include text-heavy labels to validate the bundled-metrics
   approach.

## 5. Verification strategy

- Unit: grammar (parse fixtures + error fixtures), model builder, hint→ELK mapping.
- Golden SVG snapshots for all SPEC examples across both themes (determinism + regression).
- Lookbook review each release: diffs must be intentional, named improvements — never
  drift (DESIGN.md §9 checklist: no near-misses, label collisions, or port pile-ups).
- Benchmark suite in CI enforcing the §2 performance budgets (fails on regression
  beyond threshold; includes a generated 200-node and 500-node fixture model).
- The Phase 3 agent gauntlet as the end-to-end acceptance suite, run in CI weekly with a
  pinned model.
