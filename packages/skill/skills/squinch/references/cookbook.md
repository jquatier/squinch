# Layout cookbook (symptom → fix)

Open this when `check` reports a diagnostic you do not recognise, or when the
render shows something you cannot name the hint for. Every row is keyed on the
diagnostic's own words or on what you see; search this file for either. The
rows assume the Layout-hints section of `SKILL.md`, which explains the hints
themselves.

## Contents

- [Placing and banding](#placing-and-banding) — `rows`, `cols`, `place`, `align`, `wrap`, direction — and the hints `check` refuses or warns about
- [Edges and wires](#edges-and-wires) — fan-in, trunks, self-edges, chaining, `route`, step badges
- [Zones](#zones) — boundaries that overlap, cut through a frame, or have nothing to show
- [Labels, attributes and ids](#labels-attributes-and-ids) — cut-off text, attrs on the wrong element, tags, prefixes, long notes and `about`
- [Views and altitude](#views-and-altitude) — empty views, `expand`, `only`/`highlight`/`color`, `include`, `detail`, context cards
- [Icons](#icons) — an id you cannot find

## Placing and banding

| Symptom | Fix |
|---|---|
| Layers feel arbitrary / related things scattered | Add `rows`, one group per conceptual tier (entry, handlers, storage) |
| One node belongs beside another (stream sync, DLQ, cache) | `place X right-of Y` — that is all. The connecting edge runs straight across; adding `route … from east to west` does nothing, because `place` puts them on one row |
| "`route x -> y` sides are ignored — it is a same-rank edge" warning | Drop the `from`/`to`. Sides only apply to edges that span rows |
| "`route x -> y` could not use the east side of `x` — …" warning | What follows the dash is the cause, and the fix line says what to change — follow it: the edge is part of a `channel` or a `wrap` trunk (take it out), `x` is in the same row as what holds the other end (drop the side, or move `x`), or the edge leaves `x`'s system by its side — toward something beside the system, or because the system has `direction right` inside a view that flows down (or the reverse) — and `x` was asked for the side facing away (ask for one of the sides the fix names). A side that already has edges on it is never the cause — it takes any number |
| "`route x -> y` names no edge drawn in this view" warning | A route names the edge as this view draws it: `route shop -> db` while `shop` is collapsed, `route shop.api -> db` once it is expanded. The fix line writes the spelling this view needs |
| An edge leaves its node by the side asked, then turns inside the system instead of leaving the system by that side | A side carries through every system and zone wall around the node — past row-mates too, the edge going over or under them — with two exceptions. The side facing back against the edge's own way (`from north` or `to south` on an edge that runs down) carries through a wall only from the first (last) row inside it; at the first wall where it does not, the edge turns there. And where the edge's other end is in the same row as the system, the edge leaves toward it |
| "`route a -> b` asks `a` for its west side, and another `route` line asks it for its east" error | One end of an edge uses one side. `from` and `to` may be on separate lines; two lines for the same end may not disagree — keep one |
| "`x` is placed `right-of y`, but `rows` puts it somewhere else" error | The two hints disagree. Restating a band is fine — `rows [db bus]` alongside `place bus right-of db` is accepted, since both say the same thing — so fix whichever one is wrong, or drop `x` from the band |
| "`x` is listed in `rows` but is placed relative to `y`, which is not" error | Put `y` in a band too, or take `x` out of its band. A banded node can only be placed against another banded one |
| "cols `[a b c]` — all 3 sit on the same rank, so they cannot share an axis" warning | You wanted them side by side; that is `rows [a b c]`. `rows` is a **rank** — things drawn beside each other. `cols`/`align` stack a node onto another's axis *across* ranks. The confusion is worst with `direction right`, where a rank looks like a column on screen — the words describe the model, not the picture |
| "`x` appears in `rows` twice" error — likewise "appears in `cols` twice" | A node can hold only one rank position; remove one of the two occurrences |
| A wire jogs slightly instead of running straight | `align a b` — b takes a's axis exactly (a is the anchor) |
| "align `[a b]` — `b` could not be put on `a`'s axis" warning — likewise for `cols` | They sit in different systems or zones, or another hint holds them apart. Align the containers themselves, or drop one of the hints |
| An edge runs back up the page (a monitor, a retry, a feedback path) | That is how it is drawn: out of the top of the lower node, into the bottom of the upper one. To shorten it, put the observer in the same band as what it watches (`rows [api mon] [svc] [db]`), or leave it out of `rows` |
| Edge exits a silly side | `route a -> b from south to north` (sides: north/south/east/west) |
| Everything takes a long detour around the canvas | Check whether an edge points *against* the flow. Reversing one back-edge to face the direction traffic actually travels beats any hint |
| A full-detail view came out tall — want it wide | Add `layout { rows … }` banding the expanded systems side by side; calls between them cross the gutters and land on the nodes they name |
| An expanded system's insides are in the wrong order or tier | Give the system its own `layout { rows … }` in short names — it follows the system into every view. Or name the interior paths in the view's `rows` (`[app.api] [app.db app.cache]`), which replaces the system's block for that view |
| A pipeline inside a system should read left to right while the view flows down | `layout { direction right }` inside that system — its interior becomes a row wherever it is opened; the view keeps its own direction |
| A long chain renders as a tall strip, or a wide row runs off the page | `layout { wrap 5 }` — no row holds more than 5. A chain folds into a serpentine; any other wide row folds into bands, fed by one trunk. It reaches every system the view opens; one system alone takes it in its own block (`layout { wrap 4 }`). Never beside `rows`/`cols`. For a 16:9 slide, N ≈ √(nodes) rounded up, and no `direction right` |
| "`wrap 5` has no effect — no row here is wider than 5" warning | Nothing to fold. Lower the number, or drop the line |
| Diagram too cramped / too airy | `density spacious` / `density compact` |

## Edges and wires

| Symptom | Fix |
|---|---|
| "an edge has one source — `x, y` cannot fan in" error | Fan-out exists (`a -> b, c`), fan-in does not: write one edge per source. If the point is the *drawing* — many arrows converging as one trunk — that is `channel x, y -> z` in the view's layout |
| Several things all write to one store, crossing each other | `channel a, b, c -> db` — they merge into one trunk |
| "channel into `x`" warning | The trunk needs the target visible in this view and at least two of its member edges. Check that nothing is `exclude`d or folded into a collapsed card |
| "the relationship marks at `x` are crowded" warning | Too many marked wires meet one wall of `x`. In a `direction right` view a table takes side wires only on its head, which holds four; from five the marks touch. Let that view flow down (drop `direction right`), or move one relationship to another wall of `x`: `route orders -> x to north` in the view's layout (`from north` where the edge leaves `x`). Wider `density` and fewer marks do not help — the wall is as long as it is |
| "`x` connects to itself — a self-edge is not drawn" warning | Squinch draws connections between things, not loops on one thing. Put it on the node: `note right-of x "retries"`, or fold it into the label. A table that references itself says it on the row: `manager_id uuid fk ref employees` |
| "edges do not chain — `a -> b -> c` is one statement per hop" error | Only a `flow` chains hops. Write each connection on its own line — `a -> b`, then `b -> c` — and, if the sequence itself is the point, declare a `flow` that walks them |
| "N edges match route …" error | Add the edge's label to the `route` statement |
| A numbered step's badge sits past its target node | The edge label is too wide for that run — shorten it, or the badge gets evicted and the reading order looks wrong |

## Zones

| Symptom | Fix |
|---|---|
| "zones `a` and `b` contain exactly the same members" error | Two names for one boundary. Neither can sit inside the other, so merge them into a single `zone`, or narrow one's `contains` so it is genuinely a sub-boundary |
| "zones `a` and `b` partially overlap — visible zones must nest or stay disjoint" error | Boundaries must nest or stay apart, never half-lap. The fix line lists which members are shared and which are exclusive — either give the inner zone only members the outer one also has, or move the odd one out |
| "zone … cuts through expanded container" | The zone holds *some* children of a container you `expand`ed — contain the whole container, or drop the `expand` in that view |
| "zone … has no visible members" | Its members are inside collapsed cards at this altitude — `expand` one, scope the view to them, or contain the container itself |
| A zone's members are in the wrong order or tier | Name them in the view's `rows`/`cols`/`place` — hints relating two or more members of a zone arrange them inside it. To move the whole boundary, name the zone's id: `rows [gw] [prod_vpc]` |
| "`a` → `b` is not drawn — one end is inside the other" warning | The edge points from a system at something inside it (or the reverse) while that system is open. Point it at a member instead, or collapse the system in this view |
| Need a VPC / network boundary / cloud-vs-on-prem split | `zone id "Label" vpc { contains a, b }` — kinds: account, region, vpc, subnet, network, cloud, onprem, custom |

## Labels, attributes and ids

| Symptom | Fix |
|---|---|
| "`owner` has a tag value — tags live in `tags:`" error | Only the `tags:` key collects tags. A `#value` under any other key is either a tag that belongs in `tags:`, or plain text that needs quotes |
| "N ids are missing their `sys` prefix" error | Ids declared inside a `system` are addressed from outside it by their full path. Inside `shop`, write `api`; from a `zone`, a `view` or another system, write `shop.api`. The error folds every id that made the same mistake into one line because it is one mistake |
| "`datastore` on `system s` — only `external` applies to a system" error | Only `external` describes a whole system. The other kinds describe one node: put it on a node inside, or drop it |
| "label is N characters — it will be cut off" warning | A leaf widens, then wraps to two lines, and past that the reader loses the tail; a card's name gets one line. Keep it a short noun phrase and move the detail into `description:` |
| "subtitle is N characters — it will be cut off" warning | A subtitle is one line and widens a leaf only up to 240. Keep it to a few words — runtime, owner, region — and move the rest into `description:` |
| "`show descriptions` no longer draws anything" warning | Descriptions are prose: they show as a system's card tagline and in hover, never inside a leaf. Drop the line, and give the leaves a short `subtitle:` — runtime, owner, region — for the line under the label |
| "unknown zone attribute `description`" warning | A zone's chip holds its label and a mono `detail:` (a CIDR, an account id) — nothing else. Prose about the boundary goes in a `note` anchored to a member |
| A table's `fields` are written but nothing draws | Fields draw where the table's container is open: a view scoped to it (`view db { scope shop.db }`) shows every field, and expanding it (`expand db`) shows a compact list. A top-level table needs `preview <table>`. The landscape never draws them, by design |
| "`x`'s fields are never drawn — no view shows them" warning | No view opens the table's container with the table in it, and nothing previews it. The fix names the line: `preview x` for a top-level table, or stop filtering it out of its container's view |
| "preview `x` is redundant" warning | Its fields already draw here — the view is scoped to its container, or the container is expanded. Drop the line; `preview` never changes how many show |
| "`schema { }` is not a block a leaf takes" error | The block is `fields { }`, inside the table's own braces, one field per line: `id uuid pk` |
| "comments are `//` — `--` is an arrow here" error | SQL's `--` is an arrow in squinch. Write `id uuid pk // primary key`, or put the note in a quoted caption: `id uuid pk "primary key"` |
| "`?` is not squinch" / "`@` attributes are not squinch" error | Pasted Prisma or ORM syntax. An optional field says `nullable`, `@id` is `pk`, any other `@attr` is a bare marker word. The fix writes the whole corrected line |
| "`scope x` names a leaf — a view stands inside a container" error | To see a table's fields, scope its container: `scope shop.db`. The table draws every field there |
| "`subtitle` is a leaf attribute" warning | Only a leaf draws a line under its name. On a system or container that line is `description:` (it shows on the collapsed card); a `person` has none |
| "this note runs to N lines" warning | A note is a callout on one thing. Context for the whole view — what it shows, what is changing, where the runbook is — goes in the view's `about """…"""`, under the title. The note is still drawn in full |
| "… uses a heading (`#`) / emphasis (`*…*`), which squinch draws as typed" warning | Prose takes `**bold**`, `` `code` ``, `[text](https://…)`, `- ` bullets and blank-line paragraphs, nothing else. Drop the `#`; make emphasis `**bold**` or plain |
| "the link to `x` in … is drawn as text" warning | A link takes an absolute http or https URL: `[text](https://…)`. A repo-relative path cannot open from a rendered SVG |
| "view `v` already has an `about`" error | One per view. Join the two into one `"""` block string, a blank line between them |
| You want more text on the diagram than fits | Write it in the source — `about` for the view, a note for one thing — never in the rendered file: `render --check` reports a hand-edited SVG as stale on every run |

## Views and altitude

| Symptom | Fix |
|---|---|
| "`scope` starts a second statement on this line — statements end at a newline or `;`" error | Statements end at a newline or `;`. A short view on one line needs the `;`: `view db { title "Schema"; scope shop.db }` — or one statement per line |
| "view `v` has nothing to draw" warning | Everything got filtered out. Check `scope` (a leaf has no insides — scope a system, not a node), then `include`/`only`/`exclude`. An empty `system x { }` does this too: make it a node instead |
| Too many boxes at once | Group into `system`s by area and let the landscape show their cards — see "When the system is big". Splitting into views alone does not help while everything is still top-level |
| Everything open on one page, no clicking into containers | `view full { expand * }` — every container becomes a nested frame, every edge shows natively |
| "expand `x` inside `x`'s own view — this view stands inside `x` already" warning | A view named after a container *is* that container's own view: you are already inside it. To draw `x` opened up among its neighbours, name the view something else: `view overview { expand x }` |
| "`expand *` already opens every container — the explicit `expand` lines are redundant" warning | Drop the explicit `expand x` lines; the star covers them |
| "`expand *` opened nothing — no containers are visible here" warning | The model (or this scope) has no containers to open — drop the line |
| Show **only** one concern (an auditor's view: "only the PCI parts") | `only #pci`. Anything outside the scope that the survivors still talk to stays as a muted context card — that boundary crossing is usually the point of the view; `context off` drops those too |
| Emphasise one concern while keeping its context | `highlight #pci` — spotlights matches, dims the rest, shows everything |
| Tell two groups apart, or mark one path, without dimming anything | `color #team-a teal` in the view (tags inherit through containers), or `{ color: red }` on the element. Nine hues, never hex |
| "color #x: nothing visible here is tagged #x" warning | Same cause as the `highlight` row: the tag is misspelled, or its carriers are not in this view — check `tags:` and the view's `include`/`only` |
| "`x` is tagged #a (red) and #b (blue) — #b wins" warning | Two `color` lines landed on one element. Give both tags the same hue, or narrow one of them |
| Narrow a view with `include #tag` | It does not narrow. `include` **adds**; an include that changes nothing warns and points at `only` |
| Show one specific node from another system, not its whole card | `detail ledger.post` |
| A neighbour system clutters a zoomed view | `exclude thatSystem` or `context off` |
| "highlight #x: nothing visible here is tagged #x" warning | Everything would dim and nothing stand out. The tag is misspelled, or the things carrying it are not in this view — check the tag against your `tags:`, and the view's `include`/`only` |
| Not sure which views exist | `squinch check <path>` lists them (`--format json` puts them in `views`) |

## Icons

| Symptom | Fix |
|---|---|
| Icon unknown | Collect every icon you're unsure of and search once: `squinch icons search "queue, vector search, llm"` — commas separate terms, spaces stay a phrase. `no exact match — closest:` rows are ranked next moves. The check error's `did you mean` is usually right |
