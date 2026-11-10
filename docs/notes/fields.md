# Fields: a leaf's schema, shown where you stand beside it

**Status: settled (2026-11).** How a table, collection, topic or message carries
its schema, where the schema draws, and every shape that was tried and dropped
on the way. SPEC §3 "Fields" is the language; §5 is where it draws.

## The problem

A database was one node, or a container of `sys/table` leaves, and the skill
said outright "nothing draws columns, so leave them out". People wanted to
drill into a table and see its schema — across Postgres, DynamoDB, Kafka,
MongoDB — without the language growing a vocabulary per store, and with enough
control to choose what shows.

## What shipped

- **One block on a leaf: `fields { }`**, one field per line — a name, a type,
  then free words. Markers are free vocabulary (`pk`, `hash`, `ttl`, `index
  gsi1`), so every store's terms fit without the language knowing any of them.
  `ref <path>` names what a column points at; a quoted string is a caption.
- **Writing fields changes no picture.** The landscape, and every view that
  does not stand beside the leaf, is byte-identical with or without them.
- **They draw at home altitude**: a view scoped to the leaf's own container
  draws every field, in declared order. Opening the database card *is*
  drilling into its tables — the dive affordance the container already has.
- **Anywhere else, `preview <leaf>` / `preview *`** draws up to six, with
  `+N more fields`; `preview:` on the leaf picks which (`none | auto | [names]`,
  the container attr pointed at fields).

## How it was decided

1. **Canvas mock-ups** of three card treatments — rows under the head, a code
   listing, keyed fields only. Rows won; the listing brought in a second
   surface nothing else uses; "keys first" survived only as an idea, and then
   not at all (below).
2. **A five-agent cold probe.** Each agent had the skill with its "nothing
   draws columns" line removed, a checkout platform in prose (Postgres,
   DynamoDB, Kafka, MongoDB, types and keys spelled out), and the instruction
   to write the syntax they would expect. No CLI.

   | Question | Result |
   |---|---|
   | Block name | `fields` 4/5, `schema` 1/5 |
   | Where | inside the leaf's attr block 5/5; on topics and DynamoDB nodes too |
   | Line shape | `name type markers…`, no colons, 5/5 |
   | Bare punctuated types (`numeric(10,2)`, `array<…>`) | 4/5 |
   | Enum spelling | `enum(a, b)` 2, `enum(a b)` 2, `enum [a b]` 1 |
   | Markers as bare words; `pk` on each column of a composite key | 5/5 |
   | Trailing quoted string per field (DynamoDB key patterns) | 5/5 |
   | Field-level reference | 4/5 — `ref path` 2, `references path` 1, `fk -> path` 1 |
   | Nested fields | dotted names 5/5; one also wrote a `payload { }` sub-block |
   | `#` for keys | 0/5 |
   | Used `preview` | **0/5** |
   | How they drilled in | **5/5 declared a view scoped to the database container**; 1/5 also scoped a leaf |

   It was a leading prompt — it asked for schemas. Gauntlet prompts 36 and 37
   (tables, no columns asked for) carry the opposite check: no agent may write
   `fields` there unprompted.
3. **Three adversarial reviews** — DSL, product, codebase. They removed the
   first design, below, and forced the grammar shape.
4. **A design pass against the code**, which found the heuristic and grid
   problems below before they were written.

Every bare type, marker, caption and ref the probe wrote parses; each mismatch
(`schema {`, `payload { }`, `fk ->`, `references`, `scope <leaf>`) gets a
diagnostic that writes the fix.

## Rejected shapes

- **A page per leaf, entered by clicking the leaf.** The first design. It
  needed five mechanisms the code did not have, two of which broke working
  behaviour:
  - a leaf-scoped view, where context lifts the writing service to the table's
    own system and drops it as an ancestor (`resolve.ts`, rule 3) — the page
    showed the table alone;
  - view naming: `view shop.orders { }` with no `scope` is a root view, and
    the auto loop then adds a second view of the same name;
  - sync: a flat project with no declared views would sync only the table
    page and silently drop its main diagram (`cli/src/index.ts`, `viewNames`);
  - a hover card that exists in neither surface;
  - static `<a href>` dive links — assumed to exist for system cards; they do
    not (`svg.ts` emits no `<a>` but a leaf's `link:`).

  And it was a click nobody could see (DESIGN §3: nothing carries an affordance
  it cannot honour), giving the GitHub reader nothing. The probe settled it:
  nobody drilled into a leaf; everybody scoped the container.
- **"Marked fields first" as the preview order.** It would put `nullable`
  above `status` on every probe's `orders` table, and every agent declared keys
  first anyway. `auto` is declared order, as on containers.
- **The default card wearing a "N fields" shelf.** Rejected in review by the
  author: someone recording a schema must be able to keep the default look.
- **A code-listing panel inside the card.** A recessed second surface no other
  element uses.
- **Assigning roles in the grammar** (`name type? marker* ("ref" Path)?
  String?`). Not LR(1): type and marker are both identifiers, a string is a
  type in one position and a caption in another, and `ref` is also a word.
  The grammar takes a name and a run of words; `build.ts` assigns the roles.
- **A lenient type *token*.** Brackets nest (`array<map<k, v>>`) and a Lezer
  token cannot recurse; `TypeArgs` is a grammar rule, which also skips the
  space in `enum [a b]` for free.
- **A catch-all `Ident "{"` error production** for `schema {` and friends in
  a container body. `kw<>` uses `@extend`, so `layout {` would parse both ways.
  The leaf's attr block takes any `name {` as a `FieldsBlock` (the model checks
  the word — `Ident "{"` against Attr's `Ident ":"` is one token of lookahead);
  a container body takes `fields {` only; the rest is a source heuristic.
- **Wires to rows, FK lines between rows** — never (`preview-card.md`: the
  moment a wire may land on a row, a hand-picked subset lies about the rest).
  A `ref` is text on the row.
- **Importing schemas in core.** A render is a pure function of its source.
  The skill tells agents to copy fields from the repo's migration, Prisma or
  proto files, never from memory.

## Things the code taught

- **The regex syntax heuristics read field lines as statements.** The
  unquoted-space one matched `id: uuid pk` as `key: two words` and deleted the
  real errors in its range. Every heuristic skips `FieldsBlock` spans; the one
  fields heuristic rewrites a bare syntax error inside a block from the
  characters that broke it (`--`, `'`, `?`, `@`, an unclosed bracket) and
  writes the whole corrected line.
- **`declareNode` read only the first attr block.** Fields are collected from
  all of them; a second `fields` block is an error, not a silent drop.
- **`scope <leaf>`** used to draw an empty page with a "nothing to draw"
  warning. It is an error now that names the container to scope.

## Diagnosing the next odd schema

- Fields written, nothing drawn: the view does not stand in the leaf's
  container and does not `preview` it — or the leaf is a context leaf (scenery
  is never detailed) or a member of an expanded frame (not home).
- A `ref` that does not resolve: it is looked up from the leaf's container
  outward, like an edge endpoint; only its longest prefix must be a node.
- A type drawn as a marker, or the reverse: the first word after the name is
  the type, always. `order_id pk` warns that the type is missing.
