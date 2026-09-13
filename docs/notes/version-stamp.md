# Note — the version stamp, and why there is no lockfile

Engineering note, not a requirement. `squinch render` writes
`data-squinch="x.y.z"` on the root `<svg>` of everything it renders, the
interactive HTML export carries the same attribute once on `<html>`, and
`squinch.lock` is gone. This records why, and the one thing a manifest could
still do that a stamp cannot.

## Why it exists

The determinism contract is *same (source, packs, theme, tool version) →
byte-identical SVG*. Three of those four inputs are in the repo beside the
render. The fourth was in `squinch.lock`: a JSON file `--sync` wrote next to
the source with the tool version and a 16-char sha256 per output.

Nothing read it. `--check` re-renders and compares content against the
committed SVG; the action, `diff`, the extension and the playground never
opened it. A write-only file cannot drift *visibly*, and it did not: four of
the five example projects in this repo said `"version": "0.0.0"` through two
releases while the workspace was at 0.3.1, and CI stayed green the whole time.
The one question the file existed to answer — which squinch drew these — it
answered wrongly in the repo that owns the tool.

The hashes bought nothing either. They duplicated the file beside them, and
`--check` is startup-bound (~0.7 s for 2 diagrams, ~1.2 s for 14), so skipping
a render on a hash match would have saved nothing measurable.

Meanwhile the SVG is the artifact that travels — into a wiki, another repo's
README, a slide — and the lockfile stays behind. A reader holding a stale
render had no way to learn which version to re-render with. So the version
belongs *in* the render, which adds nothing to the determinism tuple: the
version was already an input.

## What replaced it

- **Core** takes `toolVersion?: string` (`RenderOpts`, `render`,
  `renderProject`, `exportHTML`) and appends `data-squinch="…"` *last* on the
  root tag, escaped. Last because three scripts read `width="…" height="…"`
  as an adjacent pair off that tag, and appending keeps the unstamped prefix
  byte-identical. Core never reads its own version: it is isomorphic and has
  no manifest, and a guardrail asserts `packages/core/src` never mentions
  `package.json`. Omit the option and the output is what it was before the
  option existed — which is what keeps the 8 goldens, the 92 lookbook
  snapshots, the gif and gallery scripts and the gauntlet scorer unstamped.
- **Every host stamps**: the CLI from its manifest, the playground from a
  Vite `define` of the workspace version, the extension from its own
  `packageJSON.version`. The workspace guardrail pins all of those to one
  number.
- **The HTML export stamps once**, on `<html>`, never on the inline bodies.
  Fourteen copies of one fact is what the shared-defs design exists to avoid,
  and a body lifted out of that file is not a `render -o` artifact anyway.
- **`--check` ignores the stamp.** It strips `data-squinch` from both the
  committed file and the fresh render and compares what is left: is the
  committed *picture* what the source produces? The stamp describes the
  render — which squinch last drew this file — and is not an input to that
  question. So a render from an older squinch that draws the same picture is
  in sync, a render from before the stamp existed is in sync, and a version
  bump makes nothing stale. A core test pins the property this rests on: a
  stamped render with the attribute removed is byte-equal to the unstamped
  render.
- **`--sync` deletes a leftover `squinch.lock`** if it parses as the shape
  this CLI wrote, and says so once. It is squinch-owned on the same footing
  as the SKILL.md that `squinch skill` overwrites; left behind it would
  assert a version forever. Never on `--check` — a CI gate must not write to
  the checkout.

## What a bump does, and does not, do

Nothing, to the committed renders. The workspace version only moves in the
release commit, `--check` does not read the stamp, and a render that says
`0.3.1` in a workspace at `0.3.2` is telling the truth: 0.3.1 last drew it,
and it is still what 0.3.2 draws. The stamp catches up the next time the
picture changes and `--sync` runs — which is the moment the answer to "which
squinch drew this?" actually changes. The core suite never sees a stamp at
all.

## What a manifest could still do

A lockfile could list the *expected output set*, so `--check` could flag an
orphaned SVG whose view was deleted. Today's `--check` never did that either —
it walks the views the source declares and never looks at what else is on
disk — so nothing was lost. If orphan detection is ever wanted, it is a
`--check` feature over the directory listing, not a reason to bring the
manifest back.
