# Note — what the README shows, and which parts CI keeps honest

The front page is four kinds of artefact, and only three of them are gated. The
ungated one has gone stale twice, both times unnoticed until someone looked at
the page. This is the checklist for "I changed how diagrams render — what on the
README is now a lie?"

## Gated automatically

| Artefact | Gate |
| --- | --- |
| `examples/*/**.svg` — every committed render, including the pair under **From source to diagram** | `squinch render examples/<p> --check` in CI, per project. Fails if the SVG does not match what the source renders today. |
| The fenced source block under **From source to diagram** | `packages/cli/test/readme.test.ts` — asserts it is `examples/products-api/products-api.squinch` verbatim, and that the section points at that view's own light/dark renders. The block had drifted to four nodes while the picture showed nine, which is worse than a stale picture: the reader's first impression of the language is a file that would not produce what they see. |
| `lookbook/` | `git diff --exit-code lookbook/` after a render sweep. |

The fence on that block says `kotlin`, not `squinch`, and that is deliberate —
Linguist has no Squinch grammar, so a ```squinch fence renders flat grey, and
Kotlin's tokeniser happens to fit this DSL almost exactly. The test accepts
either fence, so swapping back when Linguist ships a grammar is a one-line
change. `packages/vscode/syntaxes/squinch.tmLanguage.json` is the grammar to
submit.

## Not gated: `docs/assets/zoom-{light,dark}.gif`

The hero animation is **generated, never screen-recorded** — the frames are the
real renderer's output, so it *can* be regenerated after any visual change:

```bash
npx tsx scripts/hero-gif.mts
```

Requires `ffmpeg`, which is why it is a maintainer-machine step and never runs
in CI: a gate that cannot run in CI is a gate that does not exist, so this stays
a ritual rather than a check. It is also the only README artefact that reads the
SPA's motion constants (`apps/spa/src/lib/dive.ts`) rather than just the
renderer — a change to the dive can stale the GIF without touching a single SVG.

**Regenerate it when any of these move:** node or card styling, the wordmark,
the theme palettes, the dive constants or easing, or the example the animation
uses. Commit the GIFs in the same commit as the change that staled them —
they are large binaries, and a separate "refresh the gifs" commit is how the
last two went missing.
