# Layout cookbook (symptom → fix)

Open this when `check` reports a diagnostic you do not recognise, or when the
render shows something you cannot name the hint for. Every row is keyed on the
diagnostic's own words or on what you see; search this file for either. The
rows assume the Layout-hints section of `SKILL.md`, which explains the hints
themselves.

## Contents

- [Placing and banding](#placing-and-banding) — `rows`, `cols`, `place`, `align`, `wrap`, direction — and the hint conflicts `check` refuses
- [Edges and wires](#edges-and-wires) — fan-in, trunks, self-edges, chaining, `route`, step badges
- [Zones](#zones) — boundaries that overlap, cut through a frame, or have nothing to show
- [Labels, attributes and ids](#labels-attributes-and-ids) — cut-off text, attrs on the wrong element, tags, prefixes
- [Views and altitude](#views-and-altitude) — empty views, `expand`, `only`/`highlight`/`color`, `include`, `detail`, context cards
- [Icons](#icons) — an id you cannot find

## Placing and banding

| Symptom | Fix |
|---|---|
| Layers feel arbitrary / related things scattered | Add `rows`, one group per conceptual tier (entry, handlers, storage) |
| One node belongs beside another (stream sync, DLQ, cache) | `place X right-of Y` — that is all. The connecting edge routes itself; adding `route … from east to west` does nothing, because `place` makes them same-rank |
| "`route x -> y` sides are ignored — it is a same-rank edge" warning | Drop the `from`/`to`. Sides only apply to edges that span rows |
| "`x` is placed `right-of y`, but `rows` puts it somewhere else" error | The two hints disagree. Restating a band is fine — `rows [db bus]` alongside `place bus right-of db` is accepted, since both say the same thing — so fix whichever one is wrong, or drop `x` from the band |
| "`x` is listed in `rows` but is placed relative to `y`, which is not" error | Put `y` in a band too, or take `x` out of its band. A banded node can only be placed against another banded one |
| "cols `[a b c]` — all 3 sit on the same rank, so they cannot share an axis" warning | You wanted them side by side; that is `rows [a b c]`. `rows` is a **rank** — things drawn beside each other. `cols`/`align` stack a node onto another's axis *across* ranks. The confusion is worst with `direction right`, where a rank looks like a column on screen — the words describe the model, not the picture |
| "`x` appears in `rows` twice" error — likewise "appears in `cols` twice" | A node can hold only one rank position; remove one of the two occurrences |
| "hint conflict: `a` → `b` runs upward — row 6 to row 4" error | Your bands contradict your arrows. `rows` runs top to bottom, so every edge must point down the list. Usually a monitor or feedback path: put it in the **same** band as what it points at (equal ranks are legal), or drop it from `rows` and let the engine rank it |
| "hint conflict: `rows` puts `a` and `b` in one band, but `k` sits on the path between them and is in no band — `b` lands a tier later" error | Something you did not list sits between two things you put side by side — usually a shared bus or queue (`a ~> k ~> b`). A band is one tier, so `b` cannot be beside `a` and below `k` at once. Paste the `rows` line the fix writes out: it lists `k` too, in its own band or beside whichever side the arrows allow. On a big landscape, expect this the moment you band the areas and forget the bus |
| "hint conflict: `a` → `b` runs upward inside `s`" error | The system's bands contradict its own arrows, same rule as the view's `rows`: put `b` in a row below `a`, or drop one of them from that block |
| "`a` and `b` are asked to share a row inside `s`, but the edge between them cannot be routed there" warning | Same-rank edges route between systems, not inside one. Put `b` in the row below `a`, or collapse `s` in this view |
| A wire jogs slightly instead of running straight | `align a b` — b takes a's axis exactly (a is the anchor) |
| Edge exits a silly side | `route a -> b from south to north` (sides: north/south/east/west) |
| Everything takes a long detour around the canvas | Check whether an edge points *against* the flow. Reversing one back-edge to face the direction traffic actually travels beats any hint |
| A full-detail view came out tall — want it wide | Add `layout { rows … }` banding the expanded systems side by side; calls between them route through the gutters and land on the cards |
| An expanded system's insides are in the wrong order or tier | Give the system its own `layout { rows … }` in short names — it follows the system into every view. Or name the interior paths in the view's `rows` (`[app.api] [app.db app.cache]`), which replaces the system's block for that view |
| A pipeline inside a system should read left to right while the view flows down | `layout { direction right }` inside that system — its interior becomes a row wherever it is opened; the view keeps its own direction |
| A long chain renders as a tall strip, or a wide fan-out runs off the page | `layout { wrap 5 }` — folds one chain into a serpentine, or one source's fan-out into bands under it (the skipping edges become a bus). Two shapes only; anything else warns and names the `rows` line to write instead. Never beside `rows`/`cols`. For a 16:9 slide, N ≈ √(steps) rounded up, and no `direction right` |
| "`wrap 5` has no effect — this view is not a single chain or a single fan-out (…)" warning | `wrap` folds exactly one chain (a → b → c …) or one source fanning out to leaves. Write the bands by hand: `rows [a b] [c d]` |
| Diagram too cramped / too airy | `density spacious` / `density compact` |
| "rank hints on … have no effect" warning | Those nodes are all inside one zone, which lays out as a single block. Order the zones instead, or drop the boundary |
| "align skipped … outside zone" warning | The snap would have dragged a member out of its own boundary. Align it with something inside the zone |

## Edges and wires

| Symptom | Fix |
|---|---|
| "an edge has one source — `x, y` cannot fan in" error | Fan-out exists (`a -> b, c`), fan-in does not: write one edge per source. If the point is the *drawing* — many arrows converging as one trunk — that is `channel x, y -> z` in the view's layout |
| Several things all write to one store, crossing each other | `channel a, b, c -> db` — they merge into one trunk |
| "channel into `x`" warning — including "has no room for a trunk" | The trunk needs the whole picture: every member edge visible in this view, at least two of them, and the sources sitting *above* the target. Check `rows`, and that nothing is `exclude`d |
| "`x` connects to itself — a self-edge is not drawn" warning | Squinch draws connections between things, not loops on one thing. Put it on the node: `note right-of x "retries"`, or fold it into the label |
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
| Need a VPC / network boundary / cloud-vs-on-prem split | `zone id "Label" vpc { contains a, b }` — kinds: account, region, vpc, subnet, network, cloud, onprem, custom |

## Labels, attributes and ids

| Symptom | Fix |
|---|---|
| "`owner` has a tag value — tags live in `tags:`" error | Only the `tags:` key collects tags. A `#value` under any other key is either a tag that belongs in `tags:`, or plain text that needs quotes |
| "N ids are missing their `sys` prefix" error | Ids declared inside a `system` are addressed from outside it by their full path. Inside `shop`, write `api`; from a `zone`, a `view` or another system, write `shop.api`. The error folds every id that made the same mistake into one line because it is one mistake |
| "`datastore` on `system s` — only `external` applies to a system" error | Only `external` describes a whole system. The other kinds describe one node: put it on a node inside, or drop it |
| "label is N characters — it will be cut off" warning | Labels wrap to two lines and then ellipsize, so the reader loses the tail. Keep it a short noun phrase and move the detail into `description:` |
| "subtitle is N characters — it will be cut off" warning | A subtitle is one line and widens the card to fit it. Keep it to a few words — runtime, owner, region — and move the rest into `description:` |
| "`show descriptions` no longer draws anything" warning | Descriptions are prose: they show as a system's card tagline and in hover, never inside a leaf. Drop the line, and give the leaves a short `subtitle:` — runtime, owner, region — for the line under the label |
| "unknown zone attribute `description`" warning | A zone's chip holds its label and a mono `detail:` (a CIDR, an account id) — nothing else. Prose about the boundary goes in a `note` anchored to a member |
| "`subtitle` is a leaf attribute" warning | Only a leaf draws a line under its name. On a system or container that line is `description:` (it shows on the collapsed card); a `person` has none |

## Views and altitude

| Symptom | Fix |
|---|---|
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
