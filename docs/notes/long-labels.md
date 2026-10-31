# Note — long leaf names

Engineering note, not a requirement. Agent-written diagrams use short names, so
the corpus never felt this: 4 of its 744 leaf labels were cut. A real data
pipeline names things after its tables, and 8 of 74 labels in one such diagram
were cut, with no warning and no way to read the rest. `DESIGN.md` promised
two-line wrapping and a `<title>`, and the code had neither.

## What a long label does now, in order

1. **It earns a wider leaf**, `280` then `320`, on one line.
2. **Past `320` it takes a second line**, broken at a space or `_ - . / :`, or
   before `(`.
3. **Past two lines, or with nowhere to break, it is cut**, the check warns, and
   the full text is in a `<title>`.

A label that fits renders as it always did. A card's name stays one line.

## Decisions

- **Only a label earns the room past 240.** A subtitle alone stops at `240`.
  In that same diagram 24 of 50 subtitles were past it, so letting them count
  would have widened nearly every leaf in the largest views, and fitted views
  draw everything smaller as they widen.
- **A column in a rightward flow keeps one left edge**, by `elk.alignment: LEFT`
  on each node, including inside a frame directed right. ELK centres a narrower
  node in its layer, which beside a wider one reads as a mistake. A downward view
  still centres, because its rows are not columns.
- **The warning is measured.** A count of 40 characters missed a card cut at 27
  and warned on leaves that fit two lines whole. `WIDEST_TITLE_ROOM` holds the
  numbers, and `test/long-labels.test.ts` holds them to what the renderer cuts.
- **`<title>` only on a node that was cut**, as the group's last child. Everything
  else stays byte-identical, and the first rect is still the surface.
- **A card's name now counts the 4px the renderer spends beside it.** The tier
  allowed 114px of chrome and the renderer used 118, so a name in that band was
  cut with a wider tier free. The tooltip exposed it. The 4 applies to the name
  only: on the tagline too, which has the chip's column to run under, it moved 15
  views that had nothing cut.

## Rejected

- **Two lines before wider tiers.** It keeps every box the same width, but the
  owner judged wider tiers to look better, and two lines reads as the exception
  it is once only very long names reach it.
- **Middle ellipsis.** `materials_la…ey (pre-agg)` is harder to read, still loses
  text, and hides whatever differs mid-name.
- **Shrinking the text, or free widths.** They break "uniformity beats fit".
- **A width setting in the DSL.** More language for agents to misuse, for a
  problem the renderer should solve.
- **Widening every leaf in a column to match.** One long name would widen all its
  neighbours.

## Not covered

- A subtitle is still one line, so a long one on a short-named leaf is cut.
- Playwright cannot read a native tooltip, so the tests assert the markup. That it
  appears on hover is a hand check.
