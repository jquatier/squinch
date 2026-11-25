# The legend

**A legend is a list of what the marks mean, written by the author. Squinch
draws each swatch from the picture, and a view shows the entries it draws.**

```squinch
legend {
  #money:  "Payment path"
  ->       "Request"
  ~>       "Event"
  external "Third-party service"
}
```

SPEC §5 Legend has the rules. This note keeps the decisions that got there —
three design revisions, each reviewed adversarially — so the next redesign
starts from them instead of rediscovering them.

## Where it lives

| Piece | File |
|---|---|
| Grammar (`LegendStmt`, `LegendBlock`, `LegendItem`) | `src/grammar/squinch.grammar` |
| Model + every check-time diagnostic | `src/model/build.ts` (`readLegend`, the tag pass after the views) |
| Which entries a view draws, and each swatch | `src/view/legend.ts` |
| Matched entries on the layout; the `legend auto` warning | `src/layout/layout.ts` |
| The band | `src/render/svg.ts` (`legendBand`, `swatch`) |

## Decisions

**The author writes every entry, and every entry needs a label.** The legend
it replaced (`legend auto`, 2026-07 → 2026-11) earned its own entries from
what was drawn and labelled them `sync`, `async`, a zone's kind, `#tag`. Every
review of an automatic design found the same failure: the legend stated
things the author never said. A dashed sync edge sat beside an `async` key; a
hue keyed as a tag's name told the reader nothing the chip did not; a flow's
id stood in for what it meant. A legend is a claim about meaning, and only
the author has it.

**No default labels, not even in a fix.** The `legend auto` warning lists the
keys a view draws and asks for a label for each; it never offers "Request" or
"Event". Agents paste fixes verbatim — a placeholder becomes a claim nobody
made, which is the default-labels design coming back through the diagnostic.

**A view shows the entries it draws, silently.** One block is meant to be
pasted into every view of a diagram (lookbook 16 does exactly that). A
"matches nothing" warning was in the design until review: on the corpus's own
two-view case it fired three times, and the gauntlet scores any warning as a
failure. What it would have caught — keying `~>` where `->` was meant — is
rare and visible in the render. The one mistake nothing else catches, a block
none of whose entries ever match, is held by a corpus test, not a diagnostic.

**Matched on the laid-out view, not the resolved one.** Layout can leave an
edge undrawn (one end inside the other), the lens skips context cards, and
only open frames exist in the picture. An entry has to match what the reader
sees.

**A tag's swatch is a chip in its hue.** Revision 3 drew "the exact mark the
tag painted" — that arrow in the hue, a spine card, a frame outline, or a
card-plus-arrow — in five cases. It needed a record of which tag painted what,
still missed people and context cards, and a red chip beside "Payment path"
says the same thing. The chip is never a plain line: that is the `--` mark.

**Colour means something only through a tag.** An element's own `color:` is
decoration (SPEC §3) and is never keyed. Revision 2 keyed hue words and style
words with selectors; that is two colour systems to teach, and the tag already
carries the meaning. `red` as a key is an error that says to tag the elements.

**Arrows sample the drawing, in the theme's colour.** An arrow's swatch takes
the dash its edges share (every `~>` dotted: a dotted sample) and otherwise the
arrow's own. It never takes an element `color:` — the old legend did when every
edge agreed, which keyed a decoration.

**Not keys: zones, flows, highlight, relationship marks.** A zone's chip names
it; a flow's badges number it, and its name belongs in the view's `title`
(lookbook 18 moved it there). Each was an entry in the old legend that repeated
what the drawing already said.

**One band under the drawing, no title, no wordmark.** Side-column and corner
placements were designed and dropped: the layout reserves no room for them,
and a legend is read after the drawing. The band wraps at the canvas width and
widens the canvas only for an entry wider than the drawing — labels are never
cut. The `squinch` wordmark rode the old band; a signature in someone else's
diagram was the wrong default. A legend title is the view's title.

**`legend auto` warns and draws nothing.** Not an error: an upgrade must not
break anyone's `render` or `--sync` over a line that holds no content of its
own, and a warning that names what was dropped is the existing pattern (`a → b
is not drawn`, `wrap N has no effect`). Not a deprecation release that kept the
old legend drawing: that ships two renderers, and agents fix a warning exactly
as fast as an error. Not an automatic migration: it would write the generic
labels into people's files as if they had. A bare `legend` warns the same way,
and `legend off` warns that there is nothing to turn off.

**Merged edges keep their members' tags for the lens** (`view/resolve.ts`), so
a ×n trunk hiding a `#money` edge shows `#money`. That is intended — a lens
over a tag must find the trunk that hides a tagged edge — and SPEC's lifting
rule 4 covers members' own styling, not the lens. It was briefly mistaken for
a bug during review; it is not one.

## Diagnosing an odd legend

- **An entry is missing.** The view does not draw that mark. For a tag: is
  there a `color #tag` line in *this* view, and is anything tagged visible here
  (not a context card, not lost to another tag's hue on the same element)?
- **No band at all.** No entry matched, or the view still says `legend auto`
  (check prints the warning).
- **A sample looks different from an edge.** The sample shows the dash every
  edge of that arrow shares, in the theme's colour; edges that disagree get the
  arrow's default.
