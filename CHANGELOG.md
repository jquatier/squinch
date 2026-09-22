# Changelog

One log for the whole workspace — the engine, the CLI and the VS Code
extension share a single version (see `scripts/version.mjs`), so they share a
history too. Sections are drafted by `pnpm release` from the commits since the
previous tag, then edited by a human before anything is written; the release
workflow lifts the matching section verbatim into the GitHub Release notes.

## 0.9.0 — 2026-09-22

- A Google Cloud icon pack. `@squinch/pack-gcp` ships the 45 icons of Google's 2025 product icon system: 19 core products with their own four-colour mark (Cloud Run, GKE, Compute Engine, BigQuery, Spanner, Cloud SQL, AlloyDB, Cloud Storage, Vertex AI, Looker, Apigee, …) and 26 two-colour category glyphs. Every other product draws as its category's glyph, which is how Google draws them now, and 276 aliases make that resolve by the name you know: `gcp/pubsub` and `gcp/dataflow` draw the Data Analytics mark, `gcp/cloud-functions` the Serverless one, `gcp/firestore` and `gcp/memorystore` the Databases one, `gcp/iam` and `gcp/secret-manager` the Security one. Put the product name in the label; the icon says the category. The 216 legacy per-service icons are deliberately absent — Google's own guidance says they should not be used as of 2026. Google publishes the library for diagrams and documentation and grants nothing further, which the pack's NOTICE states in full: use it for Google Cloud architecture diagrams and documentation and nothing else. `squinch icons search --pack gcp <term>` scopes a search, the skill gains a Google Cloud section, the playground's icon credits list the pack, and a lookbook case shows both tiers in both themes.
- The pack sanitizer promotes `<style>` class rules onto the shapes as presentation attributes before it drops the stylesheet. Sixteen of Google's files carry all their paint that way and rendered as black shapes without it; so did one Azure icon, `azure/intune-trends`, which is painted for the first time. Bare class selectors and paint properties only, a CSS value beating a same-name attribute, `url(#…)` values namespaced exactly as an attribute's are. A file with no `<style>` sanitizes byte-identically to before, and every committed render is unchanged.
- The site: `/compare/` sets the microservices example beside Mermaid, D2, Structurizr, Python `diagrams` and Archify, each drawn by its own agent under the same rules — every render as the tool produced it, every source committed beside it with the command that drew it, and one switch flipping every panel between the landscape and full detail. The landing gains a light/dark comparison slider for `--adaptive`, a native range input so pointer, touch, keyboard and screen readers all get it, and its title and heading now say "architecture diagrams as code".

## 0.8.0 — 2026-09-20

- Pan and zoom, in the playground and in the interactive HTML export. Drag or scroll to pan; pinch, or Ctrl/⌘+scroll, zooms about the cursor; `+` `−` `0` `1` and Shift+arrows do it from the keyboard; on a phone one finger pans and two pinch. The playground used to zoom only from a button pill — 25% a step, about the centre, with the left and top overflow unreachable at high zoom — and the export could neither zoom nor pan. Both now run one camera, the same controller bundled into the export and called from the playground, so they cannot drift into two feels. A view opens as it always did, width-fitted and from the top when it is tall; every view arrives fitted after a dive, whatever was done to the one before; and the dive starts from exactly what was on screen. `docs/notes/pan-zoom.md` records the decisions and what was rejected.
- What that changes for a reader: a tall diagram no longer shows scrollbars (the wheel pans the same way); diagram text is no longer selectable, because a drag must pan; Ctrl/⌘+scroll and a trackpad pinch zoom the diagram instead of the browser page; and in the playground the zoom no longer carries from one view to the next. The zoom pill steps ×1.25 up to 400%, its readout is the live percentage (click it for 100%), and zooming out always reaches the whole diagram.
- The interactive export gains `−`, `%` and `+` in its bar, and three fixes found on the way. Clicking the margin *around* the artwork now climbs a view — only the artwork's own background did, and the test that claimed otherwise passed without climbing. Space and Enter on a focused button activate it: the key handler used to swallow them and step the deck, so every button in the file was dead to the keyboard. Shift+arrow pans where it used to step, and Present scales a small diagram up to fill the screen as the playground's does. A reader without script sees the same static, width-fitted diagram as before, and no dead controls. The bundled viewer goes from 7.3 KB to 13.6 KB, in every export.
- On iOS the playground and the export size to the dynamic viewport. `100vh` there is the height with the browser's toolbars hidden, so the zoom pill and the export's view tabs sat underneath the bottom bar.
- In Present, a held ⌘, Ctrl or Alt belongs to the browser again: ⌘− zooms the page and ⌘← goes back, where the deck used to step and swallow them.
- For hosts: the camera's arithmetic (`fitCamera`, `zoomAt`, `wheelPan`, `toLocal`, …) is exported from `@squinch/core`, and `attachCamera` from `@squinch/core/browser` — the latter unstable, and not part of the engine's API. The pre-commit hook regenerates the export's runtime for edits under `src/view/`, which it has always bundled from.

## 0.7.0 — 2026-09-19

- The skill knows what to do with a large system. Pointed at a whole repo, an agent used to draw one enormous page, or a landscape with every backend in a single row. A new section, "When the system is big", and a step at the top of the loop tell it to decide the *areas* before writing a node: group by the folders, teams or domains the code already has, keep what a service owns inside it and what everyone shares top-level, hold that at every altitude, and hand over a landscape plus a view per area rather than one page. It carries no numbers — no box limits, no aspect ratios. Measured with cold agents it helps most where the repo already has structure, and only partly where it does not.
- A band the layouter could not keep is a check error. `rows [identity catalog commerce …]` with an unlisted bus on the path between them (`identity ~> kafka ~> catalog`) used to come back as two tiers with nothing said, and the router drew a stub wire into empty canvas. `check` now names what sits between them and writes the `rows` line to paste, trying the wedge in a band of its own, then beside the lower tier, then the upper, and offering the first with no upward edge. Files that relied on the silent split will now fail `check`; none of the 67 views in the corpus that use `rows` did.
- An edge written from a container itself (`checkout ~> fulfilment`, with `checkout` expanded) no longer stops in mid-air beside a shorter neighbour: a container endpoint jogs through the gutter like any other unit. No existing render changed.
- A container's `icon:` is validated like its `glyph:` and a zone's `icon:`. A made-up id used to pass `check` and draw a `?` tile; it is now an error with a did-you-mean or the search command.
- Gauntlet: two large-system prompts bring the corpus to thirty-five, certified 35/35 on the deep scorer. Round 26 is written up in `gauntlet/README.md`, including what the runs before it showed about where guidance does and does not move an agent.
- Site: the landing's trust band claims only what the render path guarantees. Release: npm publishing runs as a deployment to the `npm` environment.

## 0.6.0 — 2026-09-15

- `squinch` says when a newer version is on npm: after a successful command, one `update:` line on stderr names the version and the upgrade command (`npx squinch@latest skill` when run through npx). The lookup is one registry request a day, cached under `~/.cache/squinch` and never awaited — a slow or offline registry costs nothing and the notice arrives on the next run — and it is off under `CI`, `GITHUB_ACTIONS` or `SQUINCH_NO_UPDATE_CHECK`. It is never gated on a terminal, because the reader is usually an agent; `check --format json` carries it as an `update` field instead of a line. `docs/notes/update-check.md` records the rejected shapes.
- A skill installed by a different squinch is named: `skill: <file> was installed by squinch 0.5.0, this is 0.6.0 — re-run squinch skill`, one line per `.agents/skills` or `.claude/skills` copy in the project or under `$HOME` whose install stamp differs ("upgrade squinch" when the stamp is the newer one). Offline and deterministic; a copy with no stamp stays silent. The skill's own rule 4 tells the agent both lines are information, not diagnostics, and never to upgrade or reinstall unasked — an upgrade can change render bytes.
- Core's guardrails now ban `fetch`, `AbortController` and `process.env` beside the clock and the RNG: the CLI's update module is the one place in the product that reads the environment or the network.
- Lookbook: every case describes the feature it shows rather than the history behind it, and the landing carries a fourth quote.

## 0.5.0 — 2026-09-14

- `subtitle:` on a leaf — a short second line under the label, always drawn, for what a few words can say: runtime, owner, region. The card's tier widens for it as it does for a container's description; past 24 characters it warns and points at `description:`; `tech:`, `stack:` or `caption:` on a leaf name it as the fix, and on a person or a container the check says where that line comes from instead.
- Async wires are beaded: `~>` edges and their legend sample draw `4 7` round-capped dashes in place of the `6 5` butt dashes. The drift period is unchanged, so every animation timing stands.
- An expanded frame's header echoes its collapsed card — the 24px icon chip (the authored `icon:`, else the first leaf's) and the label in ink rather than muted text — so a reader diving into a container lands on the thing they clicked.
- `show descriptions` is retired: a description is prose, and the line under a leaf belongs to `subtitle:`. The flag now warns and draws nothing; collapsed cards keep their description as the tagline, and people carry their label alone.
- Unknown attribute keys warn on leaves, containers, zones and notes with a did-you-mean (`owner` → `domain`, `tech` → `subtitle`, a zone `description:` names `detail:`), as do unknown note styles. A chained edge — `a -> b -> c` — is an error naming the two lines to write and the `flow` where hops do chain.
- Examples: the microservices, storefront and products API projects carry subtitles, and the hero and prompt GIFs are re-recorded with the new anatomy, looping the dash drift over one whole period so the wire no longer jumps at the seam.
- `pnpm release <version>` reads the version from the command line again; without `--notes` it had fallen through to the prompt.
- Gauntlet rounds 24 and 25: 33/33 on the deep scorer, 25 of 33 clean on the first `check`; fourteen cold agents wrote `subtitle:` unprompted. The scorer counts containers among the nodes drawn and reads a container's own `icon:`, and the runner resolves resvg's Linux build and scans only tool inputs for sandbox escapes.

## 0.4.0 — 2026-09-13

- A container carries its own layout: a `layout { }` block inside a `system` or `container` body arranges its direct interior — `rows`, `cols`, `place`, written by short name — wherever that interior is opened, as an expanded frame in any view or as the root of a view scoped to it, its auto view included. A view's own hints replace the block per container, all or nothing; a second `rows`, `cols`, `direction` or `wrap` line in one block is now an error instead of a silent drop; and a block whose bands run against the interior's own edges is a check error whether or not a view opens the container. View-level `rows`/`cols`/`place` naming leaves inside an expanded container take effect too — they used to render byte-identical to no hint at all.
- A container's own direction: `direction right` in that block lays its interior out as a row wherever it is opened, inside a view that still flows down. The frame is laid out by an ELK call of its own with its wall ports as hierarchical ports, edges crossing the wall are cut and stitched back into one polyline, a stage that goes on somewhere keeps its row while a dead-end branch hangs beside it, and a frame title a wire runs through is drawn last on a halo — which also fixed three shipped views that already had a wire through a title.
- `wrap N` is the one aspect-ratio knob: it folds a single chain into a serpentine, or a single source's fan-out into bands under it with the band-skipping edges drawn as one bus. Any other shape warns and names the `rows` line to write by hand; `wrap` beside `rows` or `cols` is an error.
- The interactive HTML export bundles a flat project — no `view`, no container — through the implicit view the SVG path always used, instead of refusing it; `rows` bands continued on a second line get one error naming the fix; `expand` inside a container's own view says so and names the landscape spelling; and the VS Code highlighter learned `channel`, `color`, `to` and `wrap`.
- Every render carries the tool version as a `data-squinch` stamp on the SVG root — once on `<html>` for the interactive export — and `render --check` compares the picture with the stamp stripped, so a version bump makes nothing stale. `squinch.lock` is gone: it was write-only and had drifted to 0.0.0 in four of five example projects; `--sync` deletes one it finds.
- Gauntlet rounds 22 and 23: thirty-three prompts now, four of them asking in plain language for the shapes above, and a scorer that reads the answer off the laid-out picture. 33/33 on the deep scorer, 19 of 33 clean on the first `check`; twelve cold agents wrote a container layout block unprompted.

## 0.3.1 — 2026-09-10

- The skill hands over both themes and the interactive HTML by default. The loop shows `--sync` (every view, light and dark) and `-o diagram.html`, a new "What to hand over" section names that as the deliverable unless the user asks for a format or theme, PNG is on-request rather than the docs default, and the contradictory light/dark default line is gone. The quality bar asks for the renders to be delivered, not merely to succeed.

## 0.3.0 — 2026-09-09

- `rows` can band two zones with edges running between them: a same-rank edge across zone boundaries now routes through the gutter like one between expanded containers, so `rows [batch orders]` on two namespaces holds. The "involves a zone — the router cannot cross a zone boundary" warning is gone; nothing is unroutable any more.
- Same-rank wires reach the card. A wire between expanded containers or zones continues past the boundary to the node itself whenever the way in is clear, and parallel calls into one card land on distinct points of its face instead of converging after the wall. Where the way in is blocked it stops at the boundary as before, and it never turns inside a container or zone (docs/notes/coplanar.md, approach #6).
- Lookbook: the k8s case bands its two namespaces on one row with the cross-namespace read landing on the service; the 21-logos deploy edge no longer crosses its own stack. The hero animation is regenerated from the new renders.
- Landing: the mascot signs the demo panel's corner and is smaller on phones, the GitHub button wears its own mark instead of a star count, the mobile hero is centered with the tagline left-set under the lockup, and the Pre-alpha chip is gone.

## 0.2.0 — 2026-09-04

- `squinch icons search` answers in one pass: results are ranked (an exact id or alias first, substrings last), a query nothing fully matches returns the closest partial hits under a `no exact match — closest:` header instead of nothing, and commas batch several queries into one call — `icons search "queue, vector search, llm"`.
- Eleven `sys/*` icons for AI workloads — gpu, brain, brain-cog, bot-message-square, database-search, file-search, memory-stick, target, scan-text, audio-lines, image — with the aliases an architect reaches for: `llm`, `rag`, `retrieval`, `training`, `chatbot`, `eval`, `ocr`, `tts`, `vision` and friends. 1,313 icons across five packs.
- The installed SKILL.md is stamped with the CLI version that wrote it, and teaches the batched icon search.
- Dark is the default render theme; the interactive HTML export opens dark, bundles light, and follows the reader's system preference in both directions.
- Legend: zone swatches take the colour the boundary was drawn in, tag colours are solid swatches, and the dive-in/actor/style-name entries are gone — the legend carries meanings. A dashed sync edge beside dashed async edges is now a warning; `dotted` is the fix.

## 0.1.1 — 2026-08-23

- Dark is the default render theme: a bare `squinch render` (and the API with no theme) now produces the dark palette. `--theme`, a view's `theme` and a file-level `theme` are unchanged; `--adaptive` still starts from light, its base.
- The interactive HTML export opens dark, bundles light, and follows the reader's system preference in both directions.
- Legend: zone swatches take the colour the boundary was drawn in; tag colours are solid swatches; the "dive in", "actor", "dashed" and "dotted" entries are gone — the legend carries meanings, and a style beside its own pattern said nothing. Wire samples take a hue when every edge of that kind agrees.
- Check: a dashed sync edge beside dashed async edges now warns — dashes are the async convention; `dotted` is the fix.
- Site: the landing footer prints the version; the animated mark no longer clips on iOS after a scroll; the Pages build includes its dependencies.
- Release: the workflow grants `id-token` for npm trusted publishing.

## 0.1.0 — 2026-08-23

Initial release.
