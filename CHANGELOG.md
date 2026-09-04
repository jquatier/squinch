# Changelog

One log for the whole workspace — the engine, the CLI and the VS Code
extension share a single version (see `scripts/version.mjs`), so they share a
history too. Sections are drafted by `pnpm release` from the commits since the
previous tag, then edited by a human before anything is written; the release
workflow lifts the matching section verbatim into the GitHub Release notes.

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
