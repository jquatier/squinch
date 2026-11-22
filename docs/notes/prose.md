# Note — prose: `about`, block strings, formatted notes

Engineering notes, not requirements (the rules are SPEC §5 and DESIGN §5).
Read before widening the formatting set or changing how prose wraps.

## Why it exists (2026-11)

A user wanted a paragraph of context above a diagram — what it shows, what is
about to change, where the runbook is — with some formatting in it. Squinch
had nowhere to put it. The header held a title, one `subtitle:` line and the
meta chip; a corner note was a 200px chip that stopped at three lines with an
ellipsis, and `check` said `OK` while the rest of the text vanished. A string
could not span lines, and `**bold**` was drawn with its asterisks. So their
agent edited the rendered SVG — and `render --check` then reported the file
stale on every run, which is the error they hit later.

Every part of that is a broken contract, not a missing nicety: text the author
wrote was dropped without a diagnostic (errors serve the agent loop), and the
only way to say what they meant was to stop using the tool.

## What was built

- **`about`** — a view statement whose prose is set in the header, under the
  title and subtitle, the drawing moved down to make room. Chrome, like the
  rest of the header: layout never sees it, and it is drawn in canvas
  coordinates. One per view.
- **Block strings** — `"""` to `"""`, across lines, dedented. Accepted wherever
  a string is; prose keeps the lines, everything drawn on one line reads them as
  spaces (`ctx.prose` / `ctx.str` in `model/build.ts`).
- **A closed formatting set** (`src/prose.ts`) — paragraphs, `- ` bullets,
  `**bold**`, `` `code` ``, `[text](https://…)`. Shared by `about` and notes.
- **Notes drawn whole** — wrapped at their column and grown; past six lines a
  warning points at `about`, and the note is still drawn in full.

## Decisions, and what lost

| Choice | Rejected | Why |
|---|---|---|
| A closed set of five | CommonMark | Headings would compete with the title, tables and images with the diagram, and raw HTML cannot be allowed in an SVG that must carry no script. A parser dependency for a fraction of its grammar is owned code with a long tail. The set is what a context paragraph uses. |
| No italics | `*emphasis*` | There is no italic face in the bundle; synthesizing one (skew) draws a face the metrics were not measured from. Bundling one is ~15 KB more embedded in every SVG that uses it. The check warns instead, so nobody finds asterisks. |
| Warn on what falls outside | Strip it silently | A stripped `#` changes what the author wrote without a word — the class of failure this work exists to end. |
| Block strings | `\n` escapes | Prose written as `"a\n\n- b"` is unreadable source, and an agent writing a paragraph writes it as a paragraph. |
| `about` on the view | `description` on the view; a key in `titleblock`; a model-level `about` | `description` means a short tagline everywhere else. A titleblock is key/value metadata on one line each. A view is a page, and each page needs its own context. |
| Notes grow, then warn | A `size: wide` attr; a raised line cap | No pixel sizes in the DSL; any cap reintroduces silent loss. A long note is usually context in the wrong place, and the warning says where it goes. |
| Measure 360–560px, following the canvas | Full canvas width | A 1,400px line is unreadable; a fixed 560 on a 300px diagram looks pinned on. |

## How it is set — the details that bit

- **One wrap, two users.** `noteBox` (layout) and the renderer both read
  `setProse`; layout sizes the box from the same lines the renderer draws, the
  rule `noteBox` was written to keep.
- **A space is measured in its run's face.** A bold space is narrower than a
  regular one; measuring every space at 400 put a run a pixel long per space,
  which showed as a gap before the next run.
- **Lines of several runs are unkerned.** The metrics carry advances only, so
  a kerned run drew short of the next run's measured start — a gap before every
  full stop after a bold word. A line of one run is drawn as text always was,
  which is why no existing note changed a byte.
- **A word wider than the column stands alone** on its line and the box
  widens: never cut.
- **Code chips are bordered.** `plate` is within a shade of the canvas, so a
  plate alone vanished in the header; the meta chip's surface-and-hairline
  treatment reads in both themes.

## PNG export drew every weight as Regular (fixed with this work)

Bold prose was the first thing to make it obvious. `gen-fonts` subsets the
faces with harfbuzz, which drops the typographic family name (name id 16) by
default, so the Medium and SemiBold TTFs were left named "Inter Medium" and
"Inter SemiBold". resvg, asked for Inter at 600, found one face called Inter —
the Regular. Every PNG title had been drawn a weight light. The sfnt subset now
keeps ids 16 and 17; the embedded woff2 is untouched (CSS names it), so no SVG
changed. `packages/cli/test/raster.test.ts` holds it.
