# Relationship marks: crow's feet on an edge between two tables

**Status: settled (2026-11).** How an edge between two tables says how many
rows take part, where the marks draw and where they do not, what the engine
had to learn, and every shape that was tried and dropped on the way. SPEC §4
"Relationship marks" is the language; DESIGN §4 is the drawing.

## The problem

`fields` (see `fields.md`) made a database page: tables with their columns,
`ref` as text on a row, an edge between two tables as the relationship. What
the page could not say was the one thing a schema reviewer looks for first:
one-to-many or many-to-many, required or optional. Agents asked for it wrote
it into the label ("1:N"), which no two wrote the same way.

## What shipped

- **Two attributes on the edge, one per end**: `from:` and `to:`, each one of
  six words — `one`, `many`, `exactly-one`, `zero-or-one`, `one-or-many`,
  `zero-or-many`. `from:` counts the rows at the source as written, `to:` at
  the target. Both ends or neither.
- **They draw as crow's-foot marks in place of the arrowhead**, read from the
  table outward: bar, foot, then a second bar or a ring for the four that
  state optionality. `->` keeps its meaning for layout direction.
- **Only between two tables, on a plain edge.** Both ends leaves, `->` or
  `--`, no `style:` or `animate:`. Everything else is a check error that
  writes the line to use.
- **Only where both tables are drawn.** An edge with either end lifted draws
  as it always did. A `channel` or `wrap` trunk carries one mark per shared
  end and refuses edges that disagree. `lines straight` draws none and says so.
- **Nothing is inferred.** Two warnings compare the marks with the column the
  label names (ends swapped; a `nullable` key marked required). The marks stay
  what the author wrote.
- **A changed mark is structural** in the semantic diff.

## How it was decided

1. **A spelling probe** (five cold agents, the skill, a prose schema, no CLI,
   told the marks exist): attribute block 5/5, keys `from:`/`to:` 5/5,
   hyphenated words 4/5 (one wrote `zero-or-more`, one UML ranges), a single
   `cardinality:` attribute 0/5, Mermaid operators 0/5, `->` child to parent
   labelled with the key 5/5, many-to-many as a direct `--` 5/5.
2. **Three reviews of a first draft** that required one of the four explicit
   states at both ends. All three found the same fault: the parent end is the
   column's `nullable`, already on the row, and the child end ("at least one
   item") is not in a schema at all, so it gets guessed — and a guessed ring
   on a reviewed diagram reads as a fact. Plain `one` and `many` are the
   answer; the four explicit states stay for when the source states them.
3. **A placement probe** before any syntax was built: five cold agents with a
   CLI that accepted the two keys and six words and drew nothing, on a library
   schema (a NOT NULL key, a nullable key, a many-to-many, one relationship
   with no optionality stated).

   | Question | Result |
   | --- | --- |
   | "many" on the right end | 5/5 |
   | `zero-or-one` at the parent of the nullable key | 5/5 |
   | The unstated relationship left plain (`many` / `one`) | 5/5 |
   | First `check` clean | 5/5 |
   | Many-to-many as `books -- authors { from: many to: many }` | 5/5 |

   One model, one leading prompt. All five then copied the cardinality into
   the edge label after rendering and seeing no marks — an artefact of a CLI
   that drew none; the skill now says the marks are the whole statement, and
   the gauntlet scorer fails a label that repeats them (it is run against the
   five probe labels' shapes: "many to exactly one", "many : one", "0..* … :
   1 …", "N:1").
4. **Mock-ups on real geometry**, then a design canvas for the one question
   they raised (below).
5. **Four gates, each reviewed by an agent given the diff and not the
   conclusions.** What the reviews changed is under "Things the code taught";
   what the owner then cut is under "Rejected shapes".

## The corner question

A wire runs 16px straight out of a box before it may turn, and an 8px corner
starts its curve 8px from the wall. A two-part mark drawn 14px long puts its
outer bar or ring on the curve. Three ways out were drawn at five times size:

- **As mocked**, 14px long: ring and outer bar up to 3px off the wire on a
  tight turn.
- **A 24px straight run on marked ends**: clear, but it is a layout change
  carried through container walls, and tables stand further apart.
- **Tighter marks**, 12px at most: about 1px off the wire at worst, no layout
  change. **Chosen.**

A squared or tighter corner on marked wires was proposed first and rejected by
the owner in one line: the wires should match every other wire.

## Rejected shapes

- **One attribute** (`cardinality: many-to-one`). Nobody wrote it; it cannot
  say optionality per end without a second vocabulary. It is an error that
  writes the two-ended line.
- **UML ranges** (`0..*`) **and Mermaid operators** (`}o--||`) accepted as
  spellings. Two notations for one fact, and neither tokenises.
- **Requiring an explicit state at both ends.** See the reviews above.
- **Repairing unparseable spellings before the parse.** Built, reviewed twice
  and removed. `from: 0..*`, `orders -> customers from many to one`, a
  Mermaid line and `route a -> b from: north` have no parse, and the parser's
  recovery then reads the following lines into whatever it thinks it is in —
  one Mermaid line inside a container body gave thirteen errors. Deleting the
  syntax errors near the line afterwards could not reach those. So a step
  rewrote the four spellings, before Lezer saw the file, to text of the same
  length that parses, and reported one error with the corrected line. It
  worked, and it was the wrong trade: nothing else in the language corrects
  around a foreign notation, the step ran on every file, its first form broke
  valid `fields` lines (`to: numeric(10,2)`) until a review caught it — and
  the evidence it answered was one agent in five, in a probe with no syntax
  to follow. With the skill teaching the syntax, no agent in the placement
  probe or in round 35 wrote any of them. They are ordinary syntax errors.
  What stayed is what needs no parser trick: a wrong word, one attribute for
  both ends, a side where a word goes.
- **Answers for spellings nobody wrote.** The first build also recognised
  `multiplicity:`, `relationship:` and `relation:`, the words `only-one` and
  `optional`, bare `1` and `n`, and `1:N`, `one_to_many`, `OneToMany` as
  values. None has a probe or gauntlet session behind it. What has: one agent
  wrote `zero-or-more`, and the brief named `cardinality: many-to-one`. Those
  two keep their own answer; the rest get the ordinary unknown-attribute or
  unknown-mark diagnostic, which lists the six words.
- **Deriving marks from `ref` and `nullable`.** A render is a function of what
  was written; and the child end is not in the columns.
- **Wires to columns.** Never (`preview-card.md`): a wire that may land on a
  row makes a hand-picked subset a lie about the rest.
- **A filled ring** hiding the wire behind it. It has to know whether it
  stands on the canvas or on a depth-0 frame's fill. The open ring knows
  nothing: the wire starts at its far edge.
- **Rotated marks on `lines straight`.** Non-integer geometry is the
  cross-platform determinism risk; a straight line has no stub. Not drawn,
  with a warning.
- **A legend for the marks, an ERD mode, a drawn self-reference, schema
  import.** Non-goals; crow's feet make some readers expect an ERD tool, and
  this is a diagram of a system that happens to show its tables.
- **Marks on dashed, animated, async or bidirectional edges.** The mark
  replaces the head and needs a solid stub; each is an error naming the line.

## Things the code taught

- **One mistake, one diagnostic, and the fix must check clean.** Two wrong
  ends were two errors; a fix that kept `~>` or `style: dashed` produced the
  next error when pasted. Every fix line is tested by pasting it back where
  the mistake stood, in the middle of a file and inside a container body —
  the first tests put every mistake on a file's last line, where nothing
  follows to cascade into.
- **Labels: the engine keeps off a marked end** (`Wire.tips`). A label could
  stand 8px from a wire's end, which clears an arrowhead and not a mark. Label
  bands in a channel now start clear of a tipped end, a moved label may not
  land on one, and a label still stuck after the room passes takes the place
  it would have had (on the mark, which is then said) rather than stay under
  another wire, which is not.
- **Ports: a port moved level with its wire keeps 16px from a marked
  neighbour.** It could stand 8px away, and a mark is 10 across. On a
  reviewer's 1,280 views of random schemas (scratch, not in the tree) the
  "crowded" warning fired on 166 before this and 2 after — and on 28 once the
  warning counted marks half a pixel apart as touching, every one a rightward
  view with five or more wires on one table's head.
- **The crowded warning's advice was wrong three ways out of four.** Wider
  spacing does not lengthen a table's head, dropping the marks on one edge
  leaves its wire on the same port, and `route … from <side>` moves the other
  end. What clears it is a side named at the crowded table's end — `route a
  -> hub to <side>` (a lone `to` was read as a `from` in 0.21.0 and before, so the
  advice once said to name both) — or a view that flows down; the message
  says those, and a test applies them.
- **A hop right beside a ring is dropped.** The stretch between ring and hop
  was all gap, and the ring sat detached on the crossing wire.
- **A ring at both ends of one run is the same path drawn from each end**,
  each a little past half-way. Splitting the run in two left a seam at
  non-integer scales and recomputed the corners from a shortened stretch.
- **A trunk's shared mark goes with the wire that stands out**: the flow's
  current step, else one that is not dimmed.

## What was measured

- **Random Problems, each solved with and without tips** (4,000 seeds in each
  of three configurations; 77,669 tipped wires, 32,325 labels): 37 with a
  broken rule against 35, and 3 labels on a mark against 8,135 that stand
  where a mark would be when the engine is not told. The three Problems newly
  broken are each a label under another wire on a side-routed wire — the
  engine's known weak spot (`layout-engine.md` §8). `test/weft/tips.test.ts`
  holds the first 900.
- **Gauntlet round 35** (40 cold agents; `gauntlet/README.md`): prompt 40, a
  schema that states a NOT NULL key, a nullable key, a many-to-many, a "none
  or many" and one relationship with no optionality, got every mark on the
  right end with the right word, in a pilot and in the round; the
  relationship with nothing stated was left `many` / `one`. Prompts 36 and
  37, which name tables and no counts, drew no marks. On a later re-run 36's
  agent marked its four "belongs to" edges `many` / `one`: a fair reading,
  with no optionality guessed, so 36 now forbids only the four explicit
  words, and prompt 41 (tables that jobs read and write, nothing said
  between them) is the clean control — no marks in three cold runs. No mark diagnostic
  fired in any session and no label repeated the cardinality.
- **No existing output changed**: every golden, every example's `render
  --check` and the lookbook are byte-identical; the three new goldens are
  `packages/core/examples/relationships.squinch`.

## Not guaranteed

- **Five or more relationships on one side of a table in a rightward view.** A
  table takes side wires only on its 64px head: four stand 16 apart, five
  stand 12 apart with half a pixel between their marks. From five the view
  warns, naming the table; it does not grow the side.
- **A label on a short wire between two marks is close**: 4px from each, not
  overlapping.
- **The open ring in a browser** was checked through resvg and by the SVG dash
  rules, not by eye in each engine.

## Diagnosing the next odd mark

- Marks written, an arrowhead drawn: an end lifted (a table inside a collapsed
  card, or the other end a context card), or the view's lines are `straight`.
- A mark where the wire bends: it is within 12px of the wall on a 16px stub;
  the curve has moved the wire about a pixel there by design.
- "crowded" on a table with room: something other than a mark stands on it —
  the message says which — or the view flows rightward and five or more of
  its wires share the table's head. `route a -> hub to <side>` moves one
  (`from <side>` where the edge leaves the table).
- A check error on a `channel` or `wrap` line about marks: edges that share a
  drawn end mark it differently, or one of them carries none.
