# Squinch — DSL Spec v0 (draft)

> Naming (decided 2026-07-24): file ext `.squinch`, CLI binary `squinch`, npm scope
> `@squinch/*` (CLI published as bare `squinch`).
>
> **What is not built.** Everything here parses and renders today *except*
> `import` and `expose` (federation, **[v2]** — §10.4), which are errors rather
> than no-ops (§12). Anything without such a marker ships.
>
> Companion docs: [DESIGN.md](DESIGN.md) (design language),
> [ENGINEERING.md](ENGINEERING.md) (budgets, verification).

## 1. Design principles

1. **Everything expressible without coordinates.** All placement is relative (rows,
   columns, `right-of`, sides). There is no way to write `x: 340` — by design.
2. **Structure and layout never mix.** The model reads clean; layout lives in `layout`
   blocks — a container's block arranges its own interior, a view's block arranges the
   view. Deleting every `layout` block always yields a valid render.
3. **Forgiving surface, strict core.** Trailing commas; `//` and
   `#` comments; newline- or comma-separated lists. But unknown identifiers are errors
   (with did-you-mean suggestions) — silent typos make lying diagrams.
4. **Ids are the API.** `api = aws/api-gateway "API Gateway"` — the id `api` is what
   edges, layouts, views, and other teams' imports reference. Labels are free to change.
5. **LLM-first ergonomics.** Short common-case syntax, examples-friendly grammar, error
   messages that state the fix.

## 2. File anatomy

```squinch
// order-service.squinch
pack aws                          // icon packs used
pack corp from "./icons/corp"     // local in-repo pack

import "../payments/payments.squinch" as pay   // [v2] federation

// ---- model ----
person customer "Customer"

system shop "Order Service" {
  // nodes, containers, edges (see §3–4)
}

// cross-boundary edges live at top level
customer -> shop.api "places order"
shop.api -> pay.gateway "charge"            // [v2] only exposed nodes referenceable

// ---- views ----
view overview { include * }
view shop { scope shop  /* + layout */ }
```

A file with only a model and no `view` gets an implicit default view of everything.

### Projects (multi-file)

A directory is a project: all `.squinch` files in it merge into one model namespace
(ids must be unique project-wide; cross-file references just work). Views may live in
different files than the model they project — e.g. `model.squinch` + `views.squinch`, or a
team keeping `pci-views.squinch` separate. `squinch.config` (JSON) at the project root sets
shared defaults: packs, theme, lint rules. The CLI and SPA accept either a single file
or a project directory.

## 3. Nodes

```squinch
api    = aws/api-gateway  "API Gateway"          // id = pack/icon "Label"
db     = aws/dynamodb     "Orders Table"
queue  = box               "Legacy Queue"        // `box` = built-in iconless node
stripe = logos/stripe     "Stripe" external      // trailing keywords: external, datastore

create = aws/lambda "Create Handler" {           // optional attribute block
  description: "Validates and persists new orders"
  subtitle: "Lambda · Node 20"      // a few words under the label, always drawn
  tags:   #pci #critical            // …or positionally: `create = aws/lambda "X" #pci`
  color:  amber                     // a spine down its left edge — see §Colour
}
```

### Colour

`color:` takes one of nine words — `red | amber | green | teal | blue | violet |
pink | gray | accent` — and nothing else. Never hex: a literal cannot be right
on both canvases, and the adaptive render swaps theme tokens rather than
values, so each hue is a designed light/dark pair in the theme (DESIGN §2). The
same vocabulary works on every element, and paints the part of it that is
already the element's own mark:

| on | paints |
| --- | --- |
| a leaf (or `person`) | a 3px spine down its left edge — the card's, brought down; the artwork is never recoloured. Uncoloured leaves and actors carry no spine |
| a `system`/`container` | the card's spine (a hue instead of the brand ramp); the frame's stroke once expanded |
| an edge | stroke, arrowhead and `comet` dot |
| a zone | the boundary and its chip, over the kind's default tint |

Hue is annotation, not encoding: async is still dashed, context still muted, a
boundary still a dashed frame — a reader who cannot tell red from green loses
emphasis, never meaning (DESIGN §6). A view can also colour by tag —
`color #pci red` — which overrides an element's own `color:` (§5). Label pills
stay neutral. `squinch diff` reports colour changes as cosmetic.

Nothing in a titleblock is derived — not the commit, not the date. A render is
a pure function of its source (SPEC §determinism), so a field that read the
working tree or the clock would make two renders of one file disagree.

`description` and `tags` are available on **every** node, container, and edge.
A description is prose: it renders as a container's card tagline and in hover
cards, and never inside a leaf — one line at 11px held about thirty characters
of it, so the old `show descriptions` view toggle is retired and warns.
Container tags are inherited by everything inside (tag `shop` with `#pci` and
all its children match `#pci`).

`subtitle` is a leaf's own second line — a few words on what it runs on, who
owns it or where it lives — drawn always, a step quieter than a description.
Leaves only: a `person` has no line under its name and a card's is its
`description`, so the check warns on both rather than drawing nothing. Keep it short:
past 24 characters the check warns, and a leaf widens to fit what it holds, up to
240 for a subtitle. A long label takes a wider leaf up to 320, then a second line,
and only then is cut, with the check warning and the full text in a tooltip.
`link` makes a leaf's or person's title a hyperlink that opens in a new tab:
`api = aws/lambda "API" { link: "https://runbooks.example.com/api" }`. It takes
an absolute `http` or `https` URL in quotes, and anything else is a check error.
A container warns instead, because clicking a card zooms into it. A browser only
follows a link in an SVG it opens or inlines, so one shown through `<img>` (a
GitHub README, for one) does not react, and a PNG carries no link at all.
Any other key on a node, container, zone or note warns as unknown, with a
did-you-mean — `tech:` and `technology:` point at `subtitle:`, `url:` and
`href:` at `link:`, `owner:` and `team:` at `domain:` — and a note's one attr
takes one value, `style: warning`.

- `external` is drawn (hatched surface, DESIGN §3) and may sit on a whole
  `system`/`container` as well as a node. `person` and `datastore` are
  semantic only — they are compared by `squinch diff` and read by humans, and
  do not change the drawing; the icon is what shows a human or a database.
- `person customer "Customer"` is sugar for `customer = builtin/person "Customer"`,
  and takes the same trailing tags and attr block — one declaration, two word
  orders, one code path.

### Containers & nesting (C4-style)

`system` and `container` nest arbitrarily; every level is zoomable:

```squinch
system shop "Order Service" {
  icon:    aws/api-gateway    // the card's own mark; defaults to the first
                              //   child icon, so a card is never plateless
  glyph:   sys/code           // kind mark, in a chip at the card's top right
  domain:  "orders"           // optional ownership tag on the card's shelf
  preview: auto               // none | auto | [api db] — which direct children the
                              //   card calls out (≤ 3; the rest count as +N). A
                              //   nested container is one pick, shown by its own
                              //   card face; auto takes the first three declared

  api = aws/api-gateway "API Gateway"
  container workers "Async Workers" {
    sync = aws/lambda "Stream Sync"
  }
  db ~> workers.sync "stream"      // dotted path to nested ids
}
```

Ids resolve lexically: inside `shop`, write `sync` or `workers.sync`; outside, write
`shop.workers.sync`.

**A container's own layout.** A `layout { }` block inside the body arranges the
container's *direct* interior, wherever that interior is opened — as an expanded frame
in any view, and as the root of a view scoped to it (its auto view included):

```squinch
system checkout "Checkout" {
  api = aws/api-gateway "Checkout API"
  svc = aws/lambda "Order Service"
  bus = aws/sqs "Order Events"
  cache = aws/elasticache "Session Cache" datastore
  db  = aws/dynamodb "Orders" datastore
  api -> svc
  svc ~> bus
  svc -> cache
  svc -> db

  layout {
    rows [api] [svc] [bus cache] [db]   // written from inside: short names
  }
}
```

It accepts `rows`, `cols`, `place`, `direction` and `wrap` (§6); the other layout
statements describe a view and are refused with the view named as the fix. `wrap N`
there is the container's own fold — no row of its interior holds more than N members
— and it follows the container wherever it is opened, expanded inside another view or
as the root of the view scoped to it. Members are the
container's direct children — a leaf, or a child container ranked as one unit — so a
deeper path is an error naming the child's own block, and an outside path is an error
naming the view-level band to write instead. Two blocks in one container is an error.
The block is dormant while the container is collapsed, and a member a view has filtered
out drops from its band without comment. An edge that runs against the block's rows —
from a lower row to a higher one — is drawn running upward; it is not an error.

A view's own hints win, per container and all or nothing: when a view's
`rows`/`cols`/`place` relate two or more of a container's members, they replace that
container's block in that view; naming a single member only ranks the container from
outside and leaves the block in charge within. A view scoped to the container replaces
the block the moment it declares any `rows`, `cols`, `place` or `direction` of its own —
the same rule that makes `view <path>` the customization of the auto view rather than an
overlay on it. Bands from two blocks are never merged.

A leaf node takes `badge:` — a second icon reference drawn small on the corner of
its icon plate:

```squinch
wh = sys/database "SQL warehouse" { badge: logos/databricks }
```

It exists for platforms that publish no icon set anyone may redistribute (the
standing example is Databricks), so a pack for them cannot legally exist. Rather
than vendor someone's extracted artwork, the badge composes two things already
licensed: a generic `sys/*` concept for *what the thing is* and a brand mark for
*whose it is*. Any pack icon is a legal value; in practice it is a `logos/*` mark.
The ref is checked like `glyph:` — an unknown pack or icon is a check error with a
did-you-mean, never a silently blank plate.

### Fields (a leaf's schema)

A leaf — a table, a collection, a topic, a message — may carry its schema in a
`fields { }` block inside its braces, one field per line:

```squinch
orders = sys/table "orders" datastore {
  preview: [id status total_cents]       // optional: which fields `preview` shows
  fields {
    id           uuid           pk
    customer_id  uuid           fk ref customers
    status       enum(pending, paid, shipped)
    total_cents  bigint
    notes        varchar(500)   nullable "free text from support"
    address.city string                  // nested: a dotted name
  }
}
```

A line is a **name**, then words. The first word is the **type**, brackets and
all — `numeric(10,2)`, `array<map<k, v>>` and `enum [a b]` are each one type,
written the way the store spells it; a quoted string there is a quoted type.
After the type, in any order:

| word | meaning |
| --- | --- |
| a bare word (`pk`, `fk`, `unique`, `nullable`, `hash`, `range`, `ttl`, `index gsi1`) | a **marker** — one word each, free vocabulary, so every store's terms fit |
| `ref <path>` | a **reference**, resolved like an edge endpoint (its longest prefix that names a node; `.id` after it is kept as text). Drawn as text, never a wire — the edge between the two tables is the relationship, `ref` names the column |
| `"…"` | a **caption** — a key pattern (`"CART#<cartId>"`), a note |
| `#tag` | parsed, not drawn yet (the check says so) |

A comma between words is optional and never ends a line (`pk, fk` is two
markers); newline or `;` does. Comments are `//`. Field names are unique within
the block, and a name may be quoted.

A view that opens no container never changes because fields were written: the
landscape, a collapsed card and a context card draw exactly as before. Where a
leaf's rows draw is decided by where the leaf stands in the view (§5):

| the leaf is… | draws |
| --- | --- |
| in a view scoped to its container | every field |
| a direct member of an expanded frame (`expand c`, `expand *`) | the **compact** list, with no verb |
| at the top level, or brought in by `detail` | the compact list, only under `preview <leaf>` / `preview *` |
| collapsed inside a card, or context the view earned itself | nothing |

**Compact** is the leaf's `preview: [names]` list, as written and up to twelve,
or else the first six declared with `+N more fields` — and one field over six
shows all seven, since the row that says "+1 more" costs the row it hides.
`preview: none` keeps a leaf's rows to the view scoped to its container: the
opt-out for a table that should stay plain inside an opened system. `preview`
never shrinks anything; where rows already draw it warns that it is redundant.
Fields no view can ever draw — a top-level leaf nobody previews, a leaf its
container's declared view filters out — are a check warning naming the line to add.

The block belongs to a leaf: on a container, edge, note or person it is a check
error naming where it goes, as are `schema { }` / `columns { }` (did you mean
`fields`), a nested sub-block (write dotted names), and `--` comments. More than
thirty fields warns — list what a reader needs; the full schema lives in the repo.

**Altitude rendering:** a collapsed system/container renders as a **system card** —
kind-driven silhouette, label, optional `glyph` badge, optional `preview` strip —
never as a grid of its inner provider icons. Zooming/`expand` swaps the card for the
internals. Provider icons (e.g. `aws/*`) belong to leaf nodes; landscape-altitude
identity comes from shape + label + accent.

### Zones (deployment boundaries)

Ownership nesting (`system`/`container`) and deployment boundaries (VPC, account,
region, subnet) are different hierarchies — a zone is **cross-cutting** and declared
separately, with members listed by path:

```squinch
zone prod_account "Prod Account" account {
  contains orders, billing
}
zone vpc_a "VPC A" vpc {
  contains orders.api, orders.handlers, orders.db
  icon:  aws/vpc                      // optional icon, drawn as a flush chip tab
  label: top-right                    // chip corner: top-left (default) |
                                      //   top-right | bottom-left | bottom-right
  color: teal                         // override the kind's tint with a hue (§3
                                      //   Colour): red | amber | green | teal |
                                      //   blue | violet | pink | gray | accent
  detail: "10.0.0.0/16"               // optional second chip segment, set in
}                                     //   mono: a CIDR, an account id, a region
```

`detail` is free text the engine never parses — it just sets it monospaced so
digits line up between diagrams. It is all-or-nothing: on a boundary too narrow
for both, the segment is dropped rather than ellipsized, because a clipped
`10.0.0.0/16` is not a shortened label, it is a different network.

Zone kinds (`account | region | vpc | subnet | network | cloud | onprem | custom`)
drive the frame styling —
the classic dashed boundary with a corner label, tinted by kind: `account`
red, `vpc`/`subnet`/`network` blue, `cloud` violet, the rest gray. `color:`
overrides that tint with any hue. The frame is an outline only,
never a tint: a fill compounds where zones nest, so a subnet inside a VPC would
read darker than either, and the boundary's weight would encode depth rather
than kind. Constraint: within any single view,
visible zones must form a clean hierarchy (nested or disjoint); partial overlap is a
render error naming the offending members. Zones are model facts (deployment truth),
but only render in views where their members are visible.

Zones nest by **sharing members**, never by naming each other: the outer boundary
lists the inner one's leaves too. `contains <zone-id>` is sugar for exactly that
expansion (recursive, and independent of declaration order), so the model records
shared members either way — `contains` still yields a set of nodes, and a zone id
remains a hard error anywhere a node is meant, such as an edge endpoint.

For layout, a zone is a container like any other. From outside it is one unit —
a hint naming one of its members, or the zone's own id (`rows [gw] [prod_vpc]`),
places the whole boundary. Inside it, hints naming two or more of its members
arrange them (§6), and what no hint names is laid out automatically. A zone that
would cut through an expanded container (containing some of its children but not
the container itself) is a render error in that view.

### Flows (numbered paths)

```squinch
flow checkout "Checkout" {
  api -> create -> db          // chain; steps numbered in order
  create ~> files              // branches continue the numbering
}

view orders {
  show flow checkout           // numbered step badges on the flow's edges
}
```

Presentation mode walks the same construct one hop at a time (`flowStep`),
counted over the hops *visible in that view* rather than the flow's declared
numbering — a scoped view can lift the opening steps out.

### Built-in packs

Available without a `pack` statement: `builtin` (`box`, `person` — language
sugar, drawn in core) and `sys`, the generic set. Nothing enforces the
distinction: a pack resolves once it is *registered*, and `pack` is a
declaration of intent rather than a gate.

`sys` is 195 icons from Lucide (ISC), covering what no cloud vendor draws —
servers, racks, laptops, factories, network gear, carts and payments — plus
plain shapes for when nothing else fits. Ids are Lucide's own names; `squinch icons search` is the way
in. `logos` (third-party brand marks, Simple Icons) ships as a normal
installable pack.

## 4. Edges

```squinch
api -> create                       // sync: solid arrow
api -> create, get, search          // fan-out
db  ~> sync  "DynamoDB stream"      // async: dashed, animated by default
api <-> cache "read/write"          // bidirectional
web -- cdn                          // undirected association

get -> db "query" {                 // edge attribute block
  description: "Point reads by order id"
  tags:    #hot-path
  animate: false
  style:   dotted                   // dotted | dashed | solid
  color:   amber                    // stroke + head, one of the nine hues (§3)
}
```

Rules: an edge may appear anywhere its two endpoints are both in scope; duplicate edges
(same endpoints, same label) merge with a warning; labels are optional.

**`style:`** — `solid | dashed | dotted`. Sync edges default to solid, async to
dashed; the pattern is a presentation attribute, so it survives PNG export.
`style: solid` on a `~>` edge is a check-time error — the dash *is* the async
convention; `dotted` is the sanctioned alternative. The other direction is a
warning: `style: dashed` on a sync edge, in a model that has dashed async
edges, wears that convention (and is the same stroke once both carry a
`color:`). Restyled edges earn no legend entry — the legend carries meanings,
and a style name beside its own pattern says nothing; tag the edge and colour
the tag in the view to key it.

**`animate:`** — `false | flow | reverse | slow | fast | packets | pulse | comet`, one
value per edge. Async edges default to `flow` (dashes drift toward the target);
sync edges are still unless they opt in. The travel values need a visible
pattern, so on a sync edge they require `style: dashed` or `dotted` — declared
without one is a check-time error naming both fixes (`pulse`, which breathes
the whole edge including its arrowhead, works on solid lines). `packets` draws
its own sparse pattern and rejects a `style:`. `comet` is the one value that
does not move the stroke at all — it sends a dot along the route as a separate
element, so it needs no pattern and is the only way to show motion on a plain
synchronous call. It leaves the wire exactly as `style:` drew it: an edge never
carries both a drifting stroke and a traveller, because two motions at
different speeds on one line read as noise. All motion is passive CSS
keyframes at constant px/s inside one `prefers-reduced-motion` gate — it
survives a GitHub README `<img>` embed and switches off for readers who ask.
Unknown values and misspelled attribute keys are diagnosed with did-you-mean;
attributes are never silently dropped.

### Relationship marks (between tables)

Two attributes on an edge between two tables say how many rows take part, one
per end. They draw as crow's-foot marks where the wire meets each table, in
place of the arrowhead.

```squinch
orders      -> customers "customer_id" { from: many         to: one }          // optionality not stated
orders      -> coupons   "coupon_id"   { from: many         to: zero-or-one }  // the key is nullable
order_items -> orders    "order_id"    { from: one-or-many  to: exactly-one }  // both stated
products    -- tags                    { from: many         to: many }
```

`from:` counts the rows at the source end of the edge as written, `to:` those
at the target end; on an undirected `--` edge they are the left and right ends
as written. `from: many` on `orders -> customers` means many orders.

| Word | Mark, from the table outward | Says |
| --- | --- | --- |
| `one` | bar | one; optionality not stated |
| `many` | crow's foot | many; optionality not stated |
| `exactly-one` | bar, bar | one, and required |
| `zero-or-one` | bar, ring | one, and optional |
| `one-or-many` | foot, bar | many, and at least one |
| `zero-or-many` | foot, ring | many, and possibly none |

Each end is chosen on its own. **Both ends or neither**: one alone is a check
error. `->` keeps its meaning for layout direction; the marks only replace the
head.

- **Where marks are legal.** Both ends are leaves — not a container, not a
  person; the arrow is `->` or `--`; the edge has no `style:` (but `solid`) and
  no `animate:` (but `false`). Anything else is a check error that writes the
  line to use instead — as does a single `cardinality: many-to-one`
  attribute, or a near word like `zero-or-more`. There is no UML range
  (`0..*`) and no Mermaid operator: those are not Squinch and do not parse.
- **Lifting.** If either end of the edge lifts to an ancestor in a view, both
  marks drop and the edge draws as it always did — a wire that ends on a card
  does not end on a table.
- **Shared ends.** Where several wires share one drawn end (a `channel`, a
  `wrap` trunk) that end carries one mark; edges that mark it differently are
  a check error on the `channel` or `wrap` line.
- **Duplicates** (same ends, same label) with different marks are an error,
  not a merge — `--` written both ways round included.
- **`lines straight`** draws no marks, and the view says so: a straight line
  has no run out of the table for a mark to stand on.
- **Against the column.** When the edge's label names a column of the source
  table whose `ref` is the target, two warnings and nothing inferred: the ends
  look swapped (`from:` a "one" word, `to:` a "many" word), or the column is
  `nullable` and `to:` says `exactly-one` or `one-or-many`. Plain `one` never
  contradicts a column, and a column without `nullable` proves nothing.
- **Crowding.** The layout keeps labels, badges and notes off a mark. Where
  it cannot — a wall with more relationships than it holds apart, a label
  with nowhere else to stand — the view warns and names the table.

Nothing is derived from `fields`, markers or `ref`: the marks are what the
author wrote. A table's reference to itself stays on its row (`manager_id uuid
fk ref employees`); a self-edge is not drawn. Decisions and rejected shapes:
`docs/notes/relationship-marks.md`.

**Parallel edges & edge identity**: multiple edges between the same pair are legal and
distinguished by label (`api -> db "read"` / `api -> db "write"`). `route` may include
the label to disambiguate — `route api -> db "write" from east` — and referencing an
ambiguous parallel edge without one is a check error ("2 edges match `api -> db` — add
the label"). `note on` and flow steps match on endpoints only, first declared edge wins:
they have no label slot yet, so a note or badge meant for one of a parallel pair should
anchor to the pair's first edge or the diagram restructured. (Extending the label slot
to them is deliberate future work, waiting on evidence anyone hits this.)

## 5. Views

A view is a projection of the model. Zooming in the UI = navigating between views.

```squinch
view overview {                 // name is the URL anchor: #/view/overview
  title "System Landscape"
  theme dark
  include *                     // all top-level systems, collapsed
}

view shop {
  scope shop                    // zoom into one system; children become visible
  exclude files                 // trim noise
  expand workers                // inline one child container's internals
  preview ledger                // draw that card detailed: the children its
                                //   `preview:` names as rows, still one card
  layout { ... }                // §6

  highlight #pci                // spotlight matching elements, dim the rest;
                                // SPA renders tag chips for interactive toggling
  color #pci red                // colour everything carrying the tag (§3 Colour);
                                // one tag per line, repeat for more
  show flow checkout            // ①②③ badges along a declared flow
  legend auto                   // auto | off — key of what this view earned:
                                // sync/async, boundaries, flow, tag colours
  titleblock {                  // the header's meta chip, under the title
    subtitle: "Landscape view"  // a line under the diagram's name
    version:  "2026-07"         // version | commit | date are reserved: their
    commit:   "a41f0c2"         //   values stand alone, and `commit` sets in
    date:     "7 Aug 2026"      //   mono so hashes line up between diagrams
    owner:    team-orders       // any other key keeps its key beside its value
  }

  note right-of db "Single-table design; see ADR-42"
  note on db ~> sync "at-least-once; consumer must be idempotent"
  note top-right "Target state, Q3" { style: warning }
}
```

Notes are view-level commentary (never model facts): anchored relative to a node
(`right-of`/`left-of`/`above`/`below`), to an edge (`on a -> b`), or to a canvas
corner (`top-left`…`bottom-right`) — the no-coordinates principle applies to notes
too. Themes style them as callouts. A note beside a node has its room kept there by
the layout — inside the node's own container or zone when it is in one — and a note
on an edge has its room kept beside that wire; the authored side never changes.

- Every `system`/`container` gets an auto-generated default view (`view <path>`), so
  double-click-to-zoom always works even with zero `view` blocks written. Declaring
  `view <path>` explicitly *is* the customization of that auto view.
- `only`/`include`/`exclude` accept ids, paths, and tags (`only #pci`) — tag
  targets match every element whose *effective* (inherited) tags qualify;
  explicit includes never have to earn their spot the way auto context does.
- A view has two independent selection axes. `scope` is **where** — the root and
  the altitude. `only` is **which** — a filter over what that altitude contains.
  They are separate because a tag is a cross-cutting concern and can therefore
  never be a place: no `scope` can name "the PCI parts". `include` adds,
  `exclude` removes, and neither can narrow — `include` on a set that already
  contains its target is a no-op, which is why it warns.
- `detail <path>` (or a comma list — `detail`, `expand` and `preview` all
  take `a, b`, one entry per path, as `exclude` does) draws an outside
  element at its own depth instead of as the
  top-level card standing in for its branch. This was once a second, silent
  meaning of `include`; separating it is what made `only` expressible, because a
  verb that also controls altitude cannot be redefined to control membership.
- `preview <path>` / `preview *` draws a card **detailed**: the children its
  `preview:` attr chose (§3) as readable rows — icon, name, caption — under the
  same head, `+N more` on the shelf for the rest. It is the altitude between a
  card and an expanded frame, and it is still a card: every wire lands on it
  exactly as on the small one, and a dive opens the whole container. The
  choice of children lives on the container because it is a fact about the
  system; whether to show them large lives in the view because it is a fact
  about this picture — a landscape has room for a taller card, a dense view
  does not, and one model serves both. `preview` and `expand` on the same
  container is an error: a card is collapsed or open, not both.
- `color #tag <hue>` is a lens, so it wins over an element's own `color:`;
  tags inherit through containers exactly as for `highlight`. Two statements
  landing on one element with different hues is a warning (the later one
  wins), and a tag nothing visible carries is a warning, as with `highlight`.
  With `legend auto`, each tag coloured this way earns a legend entry labelled
  `#tag`; element-level colours earn none — a hue name is not a label.

### Visibility resolution (what's shown at each level)

A deterministic rule stack, evaluated in fixed order:

1. **Scope children**: the scope's *direct* children — containers as cards, leaves as
   icons. Exactly one level deep; depth is opened deliberately via `expand`.
   `expand` itself obeys the same rule: it opens the scope's own children, one
   level, and frames never nest — with one deliberate exception, `expand *`,
   which opens **every** visible container to leaf depth and lets the frames it
   creates nest. It is the whole-ladder spelling (the depth counterpart of
   `include *`'s breadth); the later verbs operate on its fully opened interior
   exactly as they do one level down. A container with no children stays a card
   under `expand *` — the everything view never silently drops an element. An
   explicit `expand` whose target sits inside another
   expanded container is a check **error** (the fix names the deeper view to
   write: `scope` the outer container and `expand` the inner — or `expand *`
   for every level at once). An `expand` whose
   target isn't among the scope's children, or is a leaf, warns and opens
   nothing — silence was the old behaviour, and it read as a rendered no-op.
   `expand *` alongside explicit `expand` lines warns (redundant), as does
   `expand *` with no visible containers to open.
   **`preview <path>` / `preview *`** runs here too, on the cards that remain:
   it marks a visible container's card detailed (its `preview:` children as
   rows) without changing what is visible — the card is one unit to every later
   rule, exactly as the small card is. Its diagnostics mirror `expand`'s: a
   leaf target, a target not among the visible cards, `preview *` with nothing
   to detail or beside explicit lines each warn; `preview` and `expand` on one
   container is an error. Context cards are never detailed. A detailed card
   with one child warns too, whether named or reached by `preview *`: its one
   row repeats the card. The card still draws detailed — the fix is the
   author's, usually the part moved up a level rather than wrapped in a system
   of its own, since only they know whether the boundary is meant.
   **A leaf's `fields`** (§3) change nothing visible either. Rows are decided
   last, once every rule below has run, so `only`, context, `detail` and
   `include` never narrow them: every field in a view scoped to the leaf's
   container; the compact list on a direct member of an expanded frame; the
   compact list under `preview <leaf>` / `preview *` for a leaf at the top
   level or one `detail` brought in. Never on a person, or on context the view
   earned itself. `preview` on a leaf whose rows already draw, on one with
   `preview: none`, on one without fields, or on one this view does not draw
   each warn; `preview` beside `expand` is an error for a container only.
   `scope <leaf>` is an error that names the container to scope.
2. **`only` filters the interior** — the view's *which* axis, applied after
   `expand` so an expanded container's children are filtered too. A container
   survives if it, anything beneath it, or a visible ancestor above it matches
   — naming a container keeps its opened interior, and at a high altitude the
   tagged elements are usually leaves inside the cards.
3. **Context neighbors**: elements outside the scope with ≥1 edge (after lifting)
   into the visible interior are auto-included, rendered at **top-level altitude**
   (the foreign *system* as one muted/hatched card — `web`, not `web.app`) at the
   periphery. `context off` disables. Earned against the *filtered* interior, so
   narrowing a view narrows its periphery with it — no special case, just the
   existing rule that neighbours must earn their place. A sibling dropped by
   `only` never returns here: it lifts to the container being scoped, and a view
   must not draw a muted card of itself.
4. **`detail <path>`** redraws a named outside element at its own depth,
   replacing the top-level card that would otherwise stand in for its branch.
5. **Explicit `include`** adds elements, or every element carrying a tag. It is
   purely additive and cannot narrow; an include that changes nothing warns.
6. **`exclude` wins last** — removes an element and its entire subtree, beating
   scope, only, context, expand, detail, and include.
7. **Derived content follows visibility, never drives it**: edges render iff both
   lifted endpoints are visible and distinct; zone frames wrap only visible members
   (none visible → no frame); a note anchored to an invisible element is suppressed
   with a lint warning; context neighbors must *earn* inclusion via a surviving edge.

`highlight` and the SPA's tag chips are orthogonal to all of this — they dim and
spotlight but never change the visible set. Visibility is structure; highlight is
attention.

### Edge lifting (what makes zoom work)

Edges are declared at whatever depth they're true (`web.app -> orders.api`); each view
re-anchors them deterministically:

1. Each endpoint lifts to its **nearest visible ancestor** in the view. An
   *expanded* container counts as visible for this purpose even though it is
   drawn as a frame rather than a card: an edge naming it (`client -> cluster`
   with `cluster` expanded) attaches to the frame's border, and such an edge
   earns context cards exactly as a leaf endpoint would. A frame that `only` or
   `exclude` emptied of members is not a lift target (and does not render).
2. Both endpoints lift to the same visible node → the edge is internal → hidden here.
   The open-frame variant follows the same rule: an edge between a frame and one
   of its own visible members is internal at this altitude and hidden.
3. Edges lifting to the same visible (source, target) pair **merge into one aggregate
   edge**: single constituent keeps its label; multiple render a count badge (`×3`).
   In SPA/VSCode, hover/click lists the constituent relations with jump-links to the
   view where each is native.
4. Aggregates keep styling only on unanimous agreement: when every constituent
   shares the same arrow kind, `animate`, `style` and `color`, the trunk carries them;
   any disagreement renders style-neutral (solid, medium), and the styling
   reappears at the altitude where those edges are native. (An all-`~>` bundle
   has always kept its dashes and drift; this codifies that.)
5. Lifting is a pure model operation — identical results in SPA, VSCode, CLI, CI.
6. Relationship marks (§4) never lift: an edge with either end lifted draws
   without them, singly or in a trunk.

In an `expand *` view no in-scope endpoint has anywhere to lift — every leaf is
visible — so every interior edge is native and nothing aggregates; only edges
to context cards still lift. Full detail *means* de-aggregated.

**Every drawn edge ends on the element it names.** An edge whose end is a
leaf inside an expanded container or a zone crosses that boundary and runs on
to the leaf itself, whatever the two ends' ranks — between the interiors of
two containers banded side by side, between rows, or against the flow. The one
edge a view cannot draw is one whose end still contains the other after
lifting and that rule 2 did not hide: it is left out with a warning,
"`a` → `b` is not drawn — one end is inside the other".

### Zoom navigation

SPA/VSCode: double-click a card → that node's view; breadcrumb & browser-back go up;
every view is a deep link (`#/view/orders.handlers`). Static renders: `render --sync`
emits one SVG per view, and system cards carry plain `<a href>` links to sibling view
SVGs — click-to-zoom works in committed SVGs on GitHub with zero JavaScript.

## 6. Layout (the three tiers)

Inside a `layout { ... }` block — a view's, or a container's own (§3, which takes
`rows`/`cols`/`place`/`direction`/`wrap` only). Everything optional; auto-layout
(deterministic, declaration-order-stable) fills every gap.

What auto-layout promises, with or without hints: no edge passes through an
element it does not end on; every edge that can be drawn is drawn, including
one between two elements of the same row and one that runs against the flow;
elements nobody placed keep their declared order unless leaving it removes a
crossing; an element whose edges fan out stands over the middle of them. How
that is achieved is not part of the language (docs/notes/layout-engine.md).

### Tier 0 — view-level knobs

```squinch
layout {
  direction down          // down | right (default down)
  lines orthogonal        // orthogonal | curved | straight (default orthogonal, rounded)
  density comfortable     // compact | comfortable | spacious
  wrap 5                  // no row holds more than 5: wider ones fold into bands
}
```

`wrap N` is the aspect-ratio control: no row holds more than N. It folds
every row wider than N — in the view, and in every container the view opens;
a container's own `wrap` (§3) is used for that container instead, and follows
it into every view. A single chain folds into a serpentine (bands alternate
direction, so the hop between bands is one short step); any other row keeps
its rank and splits into bands of N that stand in columns, with the edges
from one source into the later bands — and from the earlier bands on to one
shared target — drawn as one trunk with branches. A fold is a `rows` line
written for you, so `wrap` beside `rows` or `cols` in one block is an error.
The one warning is "`wrap N` has no effect — no row here is wider than N".
A band is a rank, so under `direction right` a fold makes columns, not rows
(docs/notes/wrap.md).

`direction` is also the one Tier-0 knob a container's own block takes (§3): a
pipeline that reads left to right inside a view that flows down says `direction
right` in its own `layout { }`, and that holds wherever the container is opened.
Edges crossing its boundary enter and leave through it and continue to the
leaf. A wire that runs through a frame's title on the way in is drawn behind
the title, which sits on a halo — the zone-chip rule, applied to frame titles.
A direction equal to the one already in effect around the container is a no-op.

### Tier 1 — placement hints (where 90% of tuning happens)

```squinch
layout {
  rows [api] [create get search] [db files idx]   // rank assignment, left-to-right order
  place sync right-of db                          // right-of | left-of | above | below
  align get db                                    // share an axis (column here)
}
```

- `rows`/`cols` pin nodes to ranks *and* order within the rank; unlisted nodes are
  auto-placed around them.
- Hints reach inside expanded containers: `rows [gw] [app.api] [app.db app.cache]`
  ranks and orders `app`'s members within its frame. The container's own `layout { }`
  (§3) is the primary spelling for that — it follows the container into every view —
  and view-level paths are the per-view override. The same holds for a zone: hints
  naming its members arrange them inside it, and a hint may name the zone itself by
  its id to place the whole boundary.
- Two elements may share a row *with an edge between them* — at the top level, inside
  an expanded container, inside a zone. Neighbours join straight across; an edge that
  reaches past a row-mate goes round under the row.
- An edge may run **against** the rows: `rows [a] [b]` with `b -> a` is drawn, leaving
  the top of `b` and entering the bottom of `a`. Rows say where things stand; they are
  not a claim about which way every edge points.
- A row is kept whole. An unlisted element on a path between two row-mates is ranked
  around the row; it never splits it.
- `align a b` puts `b` on `a`'s axis exactly, and `cols` gives each column one axis;
  both hold inside a container too. They relate elements in *different* rows: asked of
  elements in one row it is a warning ("… sit on the same rank, so they cannot share
  an axis" — that is `rows`), and where elements sit in different containers, or
  another hint holds them apart, it is a warning naming the ones that "could not be
  put on" the first one's axis.
- One `rows` (or `cols`, `direction`) line per block: a second is an error, never a
  silent winner.
- A full fixed grid needs no separate construct: `rows` and `cols` pin different
  axes and compose, and a cell is empty simply by nobody occupying it —
  `rows [a b] [c]` + `cols [a c] [b]` is a 2×2 with the bottom-right empty.
  (The once-planned `grid` statement was dropped as redundant on that basis.)
- Hints are per-view, keyed by node id (semantic + diffable). A hint referencing a
  removed/renamed id is a *warning*, never a silent relayout.
- **Nothing is dropped in silence.** Hints that contradict each other are errors:
  `place a right-of b` + `place b right-of a`, a `place` that puts a banded element
  somewhere its band does not, an element listed in `rows` twice, a second `rows` line,
  `wrap` beside `rows`. A hint that is consistent but cannot be given in this view is
  a warning that names it: the `align`/`cols` cases above, a `route` side that cannot
  be used or a `route` that names no edge the view draws (Tier 2), a `wrap` that folds nothing, a `channel` whose edges are not all
  visible. A silently dropped hint would strand the agent loop; a diagnostic gets
  fixed in one iteration.

### Tier 2 — edge routing

```squinch
layout {
  route db ~> sync from east to west         // exit/entry sides
  channel create, get, search -> db          // shared trunk (bus)
}
```

`from`/`to` name the sides an edge leaves and enters, on the element the `route`
line names — screen sides, whatever direction a container flows. They apply to
edges that span rows: on an edge between two elements of one row the sides are
ignored with a warning ("sides are ignored — it is a same-rank edge"), since such
an edge already runs face to face.

A side carries outward. Where the element is the last thing on that side inside an
expanded container or a zone — nothing stands between it and that wall — the edge
crosses the wall by the same side, and so on through each boundary around it.
Where something stands between, the edge still leaves the element by the side
asked, and takes its ordinary way out of the container; to carry the side through,
put the element at that edge of its row (`rows [cache api]` in the container's own
block). An edge that ends at an expanded container itself (`route shop -> db from
east`) is asked of that frame's wall.

Where the named element's own side cannot be used the edge keeps its natural side
and the check warns, naming the element, the side and the cause — "could not use
the east side of `a` — …": that side already carries an edge running straight
across to a neighbour; the edge is part of a `channel` or a `wrap` trunk; the
element is in the same row as the container that holds the other end; or the edge
leaves the element's container sideways and the element was asked for the side
facing the other way, or has a row-mate standing between.

A `route` names an edge as the view draws it: with a container collapsed the edge
runs from its card (`route shop -> db`), and opened, from the node inside (`route
shop.api -> db`). A line that names no edge drawn in the view warns and says which
spelling the view needs. A `route` matching several edges between one pair needs
the edge's label to say which; without it, it is an error.

`channel a, b, c -> t` draws the listed edges into `t` as one trunk with a branch
per source. It applies where the target and at least two of the edges are visible
in the view, and warns otherwise.

Waypoint
modifiers were considered and rejected — [notes/routing-hints.md](notes/routing-hints.md)
records why, so the case does not get reopened from memory.

## 7. Packs, themes, exposure

```squinch
pack aws                     // resolved from the registered packs (@squinch/pack-aws or a vendored copy)
pack corp from "./icons"     // local: directory with pack.json + svgs

theme light                  // file-level default; views override. Unset: dark
expose api, db               // [v2] this file's public surface for importers
```

Missing pack/icon never fails a render: placeholder box + warning diagnostic.

Themes come in pairs that can share one file. `light`/`dark` draw the same
geometry — a pair must share a font, because type metrics drive layout — so a
render can carry both palettes and let `prefers-color-scheme` choose (`squinch
render --adaptive`). A plain render defaults to `dark`; an adaptive one
defaults to `light`, because `dark` is the counterpart, not a base: an
adaptive file is a light render carrying a dark override, so `--adaptive
--theme dark` is a check error naming the themes that do pair.

## 8. Grammar sketch (informal EBNF)

```ebnf
file        = { statement } ;
statement   = pack | import | node | container | edge | view | theme | expose
            | zone | flow ;

zone        = "zone" ident [ label ] [ ident ] "{" "contains" pathlist "}" ;
flow        = "flow" ident [ label ] "{" { chain } "}" ;
chain       = path { arrow path } ;

pack        = "pack" ident [ "from" string ] ;
import      = "import" string "as" ident ;               (* v2, not built *)
container   = ("system" | "container") ident [ label ] { kind | tag } "{"
                { ident ":" value      (* card attrs: description, icon, glyph,
                                          domain, preview (none|auto|rank),
                                          tags, color *)
                | node | container | edge | interior } "}" ;
interior    = "layout" "{" { "rows" rank { rank } | "cols" rank { rank }
                           | "place" path relpos path
                           | "direction" ("down"|"right") } "}" ;   (* §3 *)
node        = ident "=" iconref [ label ] { kind | tag | attrs }
                          (* leaf attrs: description, subtitle, tags, color, badge,
                             preview (none|auto|rank of field names) *)
            | "person" ident [ label ] { tag | attrs } ;
iconref     = ident "/" ident | "box" ;
kind        = "external" | "datastore" ;   (* `person` comes from the
                                              declaration forms, not a keyword *)
edge        = path arrow pathlist [ label ] { tag | attrs } ;
arrow       = "->" | "~>" | "<->" | "--" ;
path        = ident { "." ident } ;
pathlist    = path { "," path } ;
theme       = "theme" ident ;
expose      = "expose" pathlist ;                       (* v2, not built *)

view        = "view" path "{" { viewstmt } "}" ;
viewstmt    = "title" string | "theme" ident | "scope" path
            | "only" targets
            | "include" targets | "exclude" targets
            | "detail" pathlist | "expand" ( "*" | pathlist )
            | "preview" ( "*" | pathlist )
            | "context" ( "auto" | "off" )
            | "highlight" tag { tag }
            | "color" tag ident
            | "show" "flow" ident
            | "legend" ( "auto" | "off" ) | "titleblock" attrs
            | "note" anchor string [ attrs ]
            | "layout" "{" { layoutstmt } "}" ;
anchor      = relpos path | "on" path arrow path | corner ;
corner      = "top-left" | "top-right" | "bottom-left" | "bottom-right" ;
tag         = "#" ident ;
targets     = ( path | tag ) { "," ( path | tag ) } ;
layoutstmt  = "direction" ("down"|"right") | "lines" ident | "density" ident
            | "wrap" number
            | "rows" rank { rank } | "cols" rank { rank }
            | "place" path relpos path | "align" path [","] path { [","] path }
            | "route" path arrow path { routemod }
            | "channel" pathlist arrow path ;
rank        = "[" path { [","] path } "]" ;
relpos      = "right-of" | "left-of" | "above" | "below" ;
routemod    = "from" side | "to" side ;
side        = "north" | "south" | "east" | "west" ;

label       = string ;  attrs = "{" { ( ident ":" value | fields ) [sep] } "}" ;
fields      = "fields" "{" { fieldline nl } "}" ;      (* §3 Fields; leaves only *)
fieldline   = ( path | string ) [ ":" ] { word | string | tag | "ref" path | "," } ;
word        = path [ "(" args ")" | "<" args ">" | "[" args "]" ] ;   (* args nest *)
sep         = nl | ";" | "," ;                (* interchangeable *)
```

Whitespace-insensitive; statements end at newline or `;`. **A comma is never required
where whitespace already separates, and never an error where a list is being written** —
`rows [a, b]`, `align a, b`, `highlight #a, #b` and `{ style: dashed, animate: slow }`
all parse, as principle 3 above has promised since v0 — and so does
`{ style: dashed  animate: slow }`: attributes on one line need nothing between them,
since a value is one run and the next attribute starts `key:`. The two exceptions are a path
list, where the comma is what distinguishes `a -> b, c` from a label
(`contains`, `channel`, `only` follow it), and a tag *value* — `tags: #a #b`, because
after a comma there the parser cannot tell another tag from the next attribute key.
That one is a check error naming the fix. Built with Lezer so the same grammar drives
parsing, CodeMirror highlighting, and LSP autocomplete.

## 8.5 Semantic diff

`squinch diff` compares two *models*, never two renderings, and splits what it
finds into **structural** (topology: who talks to whom, zone membership, flow
steps, what a view hides) and **cosmetic** (labels, descriptions, subtitles,
layout hints, presentation). Reviewers should never have to squint to tell a re-ordered row
from a new path into the payment vault.

```bash
squinch diff                          # working tree vs HEAD
squinch diff old.squinch new.squinch  # two files or two project directories
squinch diff --base v1.2.0            # against any git ref
squinch diff --format json|markdown   # agents and CI; markdown for PR comments
squinch diff --fail-on structural     # exit 1 when topology changes
```

A leaf's `fields` are structure, matched by name so a reorder is nothing: a field
added, dropped or retyped, a marker or a `ref` changed, each reports on its own
line. A field's caption and a leaf's `preview:` pick are cosmetic. An edge's
relationship marks are structure too: `to: one` becoming `to: zero-or-one` is
a claim about the data changing, as is adding or removing the pair.

Renames are reported as a removal plus an addition, with a *possible rename*
note when the icon and neighbours match — a hint, never a silent assumption.

## 9. Error-message philosophy

Errors are written for the agent loop — every diagnostic states location, problem, and
the most likely fix:

```
order-service.squinch:12:10  unknown icon `aws/lambd`
  did you mean `aws/lambda`? (pack `aws` has 312 icons; run `squinch icons search lambda`)

order-service.squinch:31:3   `place synch right-of db` references unknown id `synch`
  did you mean `sync` (defined at line 9)?

order-service.squinch:44:3   `rows` lists `files` twice
  a node can hold only one rank position; remove one occurrence

order-service.squinch:18:5   `lines` describes a view, not a container's interior
  move it to the view's `layout { }`; inside `shop` only rows, cols, place, direction and wrap apply

order-service.squinch:19:11  `workers.sync` is inside `workers`, not a direct member of `shop`
  arrange it in `workers`'s own layout block: `container workers { … layout { rows [sync] } }`

order-service.squinch:21:5   `rows` appears twice in this block — one `rows` line assigns every band
  merge the bands into one line

order-service.squinch:23:5   `wrap 5` and `rows` both assign bands in this view
  keep one: `wrap` folds the chain or fan-out for you; `rows`/`cols` spell the bands by hand
```

Lint (non-fatal): duplicate edges, labels over ~40 chars, view filters that match
nothing (`only`/`include`/`exclude` by tag). Layout hints naming nodes a view has
filtered out are silently skipped — hints are per-view advice, not assertions — and a
node with no edges renders as a floating card without comment: islands are a real
topology, not a mistake.

`squinch check --format json` emits structured diagnostics (location, code, message,
suggested fix) — agents parse that, humans get the pretty version. Both carry the same
information from day one.

**Live-preview semantics**: while the source is mid-edit/invalid, the SPA and VSCode
preview keep rendering the **last valid** diagram with error markers in the editor —
never a blank or flashing pane (Lezer error recovery + model caching).

## 10. Worked examples

### 10.1 The canonical prompt

*"Lambda-based API with 3 handlers behind API Gateway, using DynamoDB, S3, and
OpenSearch. OpenSearch is kept up to date by an async lambda listening to the Dynamo
stream."*

```squinch
pack aws

system orders "Order Service" {
  api    = aws/api-gateway "API Gateway"
  create = aws/lambda      "Create Handler"
  get    = aws/lambda      "Get Handler"
  search = aws/lambda      "Search Handler"
  db     = aws/dynamodb    "Orders Table"
  files  = aws/s3          "Assets"
  idx    = aws/opensearch  "Search Index"
  sync   = aws/lambda      "Stream Sync"

  api -> create, get, search
  create -> db, files
  get    -> db
  search -> idx
  db  ~> sync "DynamoDB stream"
  sync -> idx "index updates"
}

view orders {
  theme dark
  layout {
    rows [api] [create get search] [db files idx]
    place sync right-of db
  }
}
```

### 10.2 Nesting & zoom

```squinch
pack aws

person customer "Customer"

system web "Storefront" {
  cdn = aws/cloudfront "CDN"
  app = aws/amplify    "Next.js App"
  cdn -> app
}

system orders "Order Service" {
  api = aws/api-gateway "API Gateway"
  container handlers "API Handlers" {
    create = aws/lambda "Create"
    get    = aws/lambda "Get"
  }
  db = aws/dynamodb "Orders Table"
  api -> handlers.create, handlers.get
  handlers.create -> db
  handlers.get    -> db
}

customer -> web.cdn "browses"
web.app  -> orders.api "REST"

view overview {                 // altitude 1: two collapsed systems + person
  title "Landscape"
  include *
}

view orders {                   // altitude 2: inside orders; `handlers` collapsed
  scope orders
}

view orders.handlers {          // altitude 3: inside the container
  scope orders.handlers
}
```

In the SPA/VSCode preview, double-clicking `orders` in `overview` navigates to `view
orders`; breadcrumb navigates back up.

### 10.3 Layout rescue (all three tiers on a messy graph)

Auto-layout handles the first render; the tuning below is the control that
auto-layout alone can never give you:

```squinch
view orders {
  layout {
    direction down
    lines orthogonal                          // Tier 0
    rows [api] [create get search] [db files idx]
    place sync right-of db                    // Tier 1
    align api db                              // gateway and table share the center axis
    channel create, get, search -> db          // Tier 2: one trunk, not 3 crossing lines
  }
}
```

### 10.4 Federation **[v2]**

`payments/payments.squinch` (owned by another team):

```squinch
pack aws
system payments "Payments" {
  gateway = aws/api-gateway "Payments API"
  ledger  = aws/aurora      "Ledger"
  gateway -> ledger
}
expose payments.gateway
```

`orders/order-service.squinch`:

```squinch
import "../payments/payments.squinch" as pay

system orders "Order Service" { /* ... */ }

orders.create -> pay.gateway "charge card"   // only exposed ids resolve

view overview {
  include orders, pay        // `pay` renders collapsed with an import badge;
}                            // click-through opens the payments team's own views
```

Version pinning for imports is unspecified in v0; CI warns when an import's exposed surface changes.

### 10.5 Tags, highlight & notes

The compliance-review view of §10.1, without touching the model's structure:

```squinch
system orders "Order Service" {
  create = aws/lambda   "Create Handler" { tags: #pci }
  db     = aws/dynamodb "Orders Table"   {
    tags: #pci
    description: "Single-table design, on-demand capacity"
  }
  // ... rest as in §10.1
}

view orders.pci-review {
  scope orders
  title "PCI Surface"
  highlight #pci                 // create + db glow; everything else dims
  color #pci red                 // …and wear red, so the lens survives a print
  note right-of db "Encrypted at rest (KMS); see ADR-31"
  note top-right "Audit scope: Q3 2026" { style: warning }
}
```

One model, N lenses: the same graph serves the architecture view, the PCI view, the
"what's deprecated" view — each just a different `highlight`/`include` projection.

## 11. The agent loop

Shipped as a skill for coding agents:

1. Write or edit the `.squinch` file (grammar + examples are in the skill).
2. `squinch check file.squinch` — parse + lint; machine-readable diagnostics.
3. `squinch render file.squinch --png -o out.png` — deterministic render.
4. Look at the PNG; if a label overlaps or an edge crosses badly, add Tier 1/2 hints
   (the skill includes a "layout cookbook" of before/after fixes).
5. Repeat until clean. Success bar for v1: the §10.1 prompt reaches a clean diagram with
   zero human fixes.

## 12. Consistency rules (spec meta)

- Every construct used in §10 examples appears in §3–7 and the §8 grammar.
- A construct that is not built is a parse error, never a silent no-op, and the
  grammar sketch in §8 says so inline — reading the EBNF alone must not imply
  something works. They are listed at the top of this document.
- A construct that was considered and **rejected** is removed from this spec
  outright rather than carried as a "not built" entry; the reasoning lives in
  `docs/notes/` so it stays findable without implying the door is open.
- No `[v1.1]` markers: the v1.1 constructs (zones, flows, tags, channels, cols,
  align, legend, titleblock) all shipped, and a marker claiming otherwise
  understates the language to anyone designing against it.
