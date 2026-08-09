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
uses. The docs/design restyle (2026-08) hit the first three at once and the
regeneration surfaced two things a static render never would: the script's own
breadcrumb caption sat exactly where the renderer now draws a diagram's title
(moved to the bottom-left, opposite the logo), and its `›` separator drew as a
blank because that character was outside the font subset — the same class of
bug the new check-time lint exists to name. A third only showed up on the
finished clip: the pointer pressed a card's width above every card, because
the renderer wraps the diagram body in a translate once a header exists and
this script reads node coordinates straight out of the markup, which are
*pre*-transform. `bodyShift` parses the transform back out rather than
recomputing it — one source, and it cannot drift.

Frames are drawn at 2× and resolved down with lanczos. resvg rasterizes glyphs
with grayscale AA and no hinting, so 15px and 11px type at 1:1 comes out
ragged — invisible in the diagrams themselves, where a reader can zoom the SVG,
but a GIF is pixels forever. It costs about 330ms a frame against 85ms, and
roughly 45% more bytes: smoother edges mean more distinct tones for the palette
to carry. Both were weighed. Dropping the palette to 160 colours recovers
150 KB and keeps the text, but takes a dark card's ramp from 11 tones to 8,
which is the banding the sRGB filter fix had just removed — so 256 it stays.

The encode settings are tuned to this artwork rather than to general advice:
256 colours, `stats_mode=full`, and no dithering at all. These frames are flat
vector art from a small palette, so the full palette represents them almost
exactly and a dither has nothing to approximate — the ordered dither that used
to be here laid a regular speckle over every card, which read as striping the
moment the restyle gave cards a gradient. `KEEP_FRAMES=1` leaves the PNGs
behind so the next person can compare encodes on one fixed set of frames
instead of re-rendering between attempts. Commit the GIFs in the same commit as the change that staled them —
they are large binaries, and a separate "refresh the gifs" commit is how the
last two went missing.
