---
name: squinch
description: Author architecture diagrams as code with the Squinch DSL. Use this whenever the user wants an architecture or system diagram — creating one from prose, editing or reviewing a .squinch file, drawing cloud infrastructure (AWS, Azure, Kubernetes, hybrid estates), documenting services for a README or a design review, or any picture of systems, services and the connections between them — even when they never say "squinch". Write the .squinch model, validate it with `squinch check`, render it with `squinch render` (SVG in both themes plus the interactive HTML by default; PNG only when asked), and fix what you see with the layout cookbook.
compatibility: Requires Node.js 22+ and the squinch CLI on PATH, or npx squinch with no install
---

# Squinch — architecture diagrams as code

Squinch renders `.squinch` files into deterministic SVG diagrams. You write the
*model* (systems, components, connections); the engine lays it out. When the
auto-layout isn't what you want, you steer it with **relative** hints — there are
no pixel coordinates anywhere in the language.

## The loop

Work like a compiler user, not an artist:

```bash
squinch check diagram.squinch --format json   # parse + lint; machine-readable
squinch render diagram.squinch -o out.svg     # deterministic SVG; theme: the view's, else dark
squinch render diagram.squinch --view NAME --theme light -o out.svg   # themes: light | dark
squinch render diagram.squinch --sync         # every view × both themes, next to the source
squinch render diagram.squinch -o out.html    # one interactive file: every view, both themes
squinch render diagram.squinch -o out.png --scale 2   # PNG, only when asked (--width also works)
squinch icons search "<term>, <term>, …"      # find icon ids — batch every unknown in one call
squinch diff --format json                    # what changed in the architecture
```

If `squinch` is not on PATH, prefix every command with `npx` — `npx squinch
check …` — or install it once with `npm i -g squinch`.

### What to hand over

Unless the user names a format or a theme, a finished diagram is **all** of:

```bash
squinch render diagrams/ --sync              # <name>.<view>.light.svg + .dark.svg per view
squinch render diagrams/ -o diagram.html     # every view, both palettes, click-to-zoom, presentation mode
```

- **Both themes, always.** Dark is designed, not inverted, and the reader's
  environment picks — never choose one for them. For a README or a docs site
  that should follow the reader's colour scheme, `--adaptive -o x.svg` folds
  the pair into one SVG behind `prefers-color-scheme`.
- **The HTML is the thing to open.** It is one self-contained file with every
  view and a theme switch, and it needs no server — point the user at it
  first. A project with several views is unreadable as a pile of SVGs.
- **PNG is the exception**, not the default: render one only when the user
  asks for an image, slides, or a surface that cannot show SVG. A PNG you
  render to check your own work is a different thing (quality bar 3) and
  stays out of the hand-over.
- Every render carries the tool version that drew it (`data-squinch` on the
  root `<svg>`), and `render --check` re-renders and compares, so committed
  SVGs can gate CI. For a throwaway diagram that lives nowhere, two explicit
  `--theme` renders plus the HTML are the lighter recipe.
- **Write the files; leave committing to the user.** Don't commit, push or
  make a branch unless they ask — they will want to look first.

Then end your reply with three to five bullets, one or two plain sentences
each, the way you would say it to a colleague — and nothing before them that
says the same thing:

- Open `diagram.html` — it has the landscape and orders views, light and dark.
- I guessed that the services run on Lambda and that Postgres means RDS; the
  request named neither.
- I looked at both views. The one rough spot is the Kafka wire running round
  the right edge; moving it made the services row harder to read, so I left it.
- If this is more than you need, I can take out the load generator and the
  tracing collector, or show less detail by grouping the services into three
  areas.

The first three are never skipped: where to open it; what you guessed — every
product, cloud or runtime the request did not name — or "Nothing guessed" when
that is true; and what you saw when you looked, or that you could not look.
The last — an offer to cut it down, naming your own most peripheral boxes, not
a category — ends every hand-over of an open-ended request or a big system,
and is left off a small diagram that drew what was asked. One more bullet may
say how you grouped a big system, or a warning you kept. Don't describe the
components or the layout: the diagram shows them.

0. If the system is big — a whole repo, a platform — decide its *areas* before
   you write a node, because no layout hint rescues everything on one page: see
   "When the system is big".
1. Write the model first, with **no `layout` block at all** — most diagrams
   never need one. Your edges already say what the tiers are, and the engine
   ranks from them: a node sits below everything that points at it. Render it
   and look. Add hints only to fix something you can see is wrong, one at a
   time, naming only the nodes you actually care about. Icon ids outside the
   AWS basics — anything `azure/`, `gcp/`, `k8s/`, `logos/` or `sys/` — are
   looked up before the first `check`, never written from memory: open
   `references/icons.md`, which lists them per pack, or run `squinch icons
   search` with every unknown in one call. An id guessed from the word you
   would say — a `sys/` or `azure/` name that reads right and does not exist —
   is the most common way a first `check` fails.
2. `check` after every edit. Diagnostics tell you the location, the problem, and
   usually the fix (`did you mean ...?`). Trust them. When one is not
   self-explanatory, open `references/cookbook.md` — symptom → fix, keyed on
   the diagnostic's own words.
3. Exit code 0 and **no diagnostics at all** = clean. Errors block the render;
   warnings do not, which is exactly why they matter — a warning means the file
   is valid but probably not the diagram you were asked for. Fix warnings
   before you stop.
4. A stderr line starting `update:` (a newer squinch is on npm) or `skill:`
   (this SKILL.md was installed by a different squinch) — or the `update` /
   `skill` fields in `check --format json` — is information, not a diagnostic:
   exit 0 with no diagnostics is still clean. Mention it to the user once and
   carry on. Never upgrade squinch or re-run `squinch skill` unasked: an
   upgrade can change render bytes, and that is the user's call.

## Quality bar before you call it done

1. `squinch check` exits 0 with no diagnostics.
2. **Every view** you declared is rendered in both `--theme light` and
   `--theme dark`, plus the interactive `.html` — and all of it is handed
   over, not just checked (see "What to hand over").
3. **Look at the picture, not the markup.** SVG source cannot show you a
   detour. Rasterise each view beside the source and open the image —
   `squinch render diagram.squinch --view NAME -o NAME.check.png` — then
   delete the `.check.png` files when you are done. Keep them inside your
   working directory: a path like `/tmp` is often one you may not read. One
   theme is enough, both share one layout. Tiers read top-to-bottom (or
   left-to-right), no edge takes a baffling detour, async flows (`~>`) are
   dashed, related things sit together. If you could not view the image, say
   so in the hand-over and make no claim about how the layout looks.
4. Labels are short noun phrases. A `subtitle:` of a few words says what a
   leaf runs on or who owns it; anything longer goes in `description`, never
   the label.
5. Model semantics honestly: request/response is `->`; anything that queues,
   buffers or fans out is `~>`. If the prose says stream, queue, topic, event,
   publishes, emits, feeds, notifies or subscribes — Kinesis, Kafka, SQS, SNS,
   EventBridge, Service Bus — that edge is `~>`, and a pipeline drawn entirely
   with `->` is almost always wrong.
6. **Every actor the prose names is in the diagram.** People are easy to drop:
   "customers browse", "developers push", "an analyst queries" each name a
   `person`, and a stack diagram that draws only the technology has left out
   who uses it. Re-read the request and check each noun appears — a human is a
   `person`, not a box and not omitted.
7. **Nothing is in the diagram that the request does not support.** A reader
   takes every box as a fact, so a CDN, WAF, cache or queue that nothing in
   the request implies is a guess presented as truth — leave it out. The same
   goes for glue: an API or worker you put between two things the request
   names, and a product you picked where it named only a kind ("Postgres" is
   not "RDS"). When the picture cannot be drawn without filling a gap, draw
   the plainest reading and say what you guessed in the hand-over.

## Language

```squinch
// comments are // only (# belongs to tags)
pack aws                              // icon packs this file draws from (aws |
pack azure                            //  azure | gcp | logos | k8s). Optional — any
                                      //  installed pack resolves without it — but
                                      //  declaring documents intent and catches a
                                      //  misspelled pack name at check time.

person customer "Customer"            // human actor. This form is top-level
                                      // only — inside a system write it as
                                      // `who = person "Operator"`. Either
                                      // takes a block: `{ description: "…" }`
gw = aws/api-gateway "Edge Gateway"   // components may sit at the top level too —
                                      // that's how things stay individually
                                      // visible at landscape altitude (see
                                      // "Grouping vs. nesting" under Views)

system shop "Order Service" {         // systems/containers nest arbitrarily
  description: "Checkout and orders"  // optional; shows on the collapsed card
  icon: aws/api-gateway               // the card's own mark; without it the
                                      // first child's icon stands in
  glyph: sys/code                     // kind mark, in a chip at the card's
                                      // top right; a bad ref is a check error
  domain: "orders"                    // optional owner/team tag on the card's
                                      // shelf, beside the child icons
  tags: #core                         // tags inherit to everything inside

  api    = aws/api-gateway "API Gateway"        // id = pack/icon "Label"
  create = aws/lambda      "Create Handler" {
    description: "Validates and persists"
    subtitle: "Lambda · Node 20"      // a few words under the label, always
                                      // drawn: runtime, owner, region
    tags: #pci
  }
  db     = aws/dynamodb    "Orders Table" datastore #pci
  // a tag can sit in kind position like that, or in the block — same thing:
  idx    = aws/opensearch  "Search Index" datastore {
    tags: #pci                        // kind and attr block go in either order
  }
  wh     = sys/database    "SQL Warehouse" datastore {
    badge: logos/databricks           // small vendor mark on the icon plate —
                                      // see "Platforms with no icon pack" below
  }
  legacy = box             "Old Billing" external   // `box` = no icon
  // kinds: `external` (not ours — draws a hatched surface, and also goes on a
  // whole system: `system stripe "Stripe" external { … }`) and `datastore`
  // (holds state — a note to the reader and to `squinch diff`; your icon
  // choice is what actually shows it). For a human, use the `person` forms
  // above rather than a kind.

  api -> create                       // sync edge (solid)
  api -> create, get, search          // fan-out
  db ~> sync "DynamoDB stream"        // async edge (dashed); label optional
  api -> create { tags: #hot-path }   // edges take tags and attrs too
  api -> db { color: amber }          // a hue on the stroke + head — see Colour
  a <-> b                             // bidirectional;  a -- b  undirected
}

customer -> shop.api "places order"   // cross-system edges use dotted paths

zone prod_vpc "VPC prod" vpc {        // deployment boundary — cross-cuts the
  contains shop                       // ownership tree; renders as the classic
}                                     // dashed frame around its members
```

Rules that matter:
- **Ids are unique within their container**; refer to nested things as `shop.api`
  from outside, bare `api` from inside.
- Statements end at newline (or `;`). Labels are quoted strings.
- **Commas are optional wherever whitespace already separates** — `rows [a, b]`,
  `align a, b`, `highlight #a, #b`, `{ style: dashed, animate: slow }` all parse,
  as does a trailing comma. They stay *required* in a path list (`a -> b, c`,
  `contains`, `channel`, `only`, `expand`), and stay wrong inside a tag value: write
  `tags: #a #b`, never `tags: #a, #b`.
- Parallel edges between the same pair are fine — give each a label.
- **A system you are not breaking down is a node, not an empty system.**
  `system partner "Partner System" external { }` gives you a card with nothing
  behind it and a zoom that goes nowhere; `check` warns that the system is
  empty. Write `partner = box "Partner System" external` instead.
- A `layout { }` block goes inside a `view` (arranging the view) **or inside a
  `system`** (arranging that system's own interior — `rows`, `cols`, `place`
  and `direction`, written by short name; see Layout hints). Everything else
  — `channel`, `align`, `wrap`, `density`, `highlight`, `note`, `expand` —
  belongs to a view alone.

Tables — a database is one node until the reader asks what is *in* it. Then
write it as a `container` holding one `sys/table` per table: it still draws as
one card where it sits, a dive opens it onto the tables, and a foreign key is
an ordinary labelled edge. A caller points at the container (`svc -> db`) or
at the table it touches (`svc -> db.orders`). `datastore` moves to the tables
— on a container it is a check error — and `icon:` keeps the database's own
mark on the card. Tables are as deep as it goes: nothing draws columns, so
leave them out. A database nobody asked to open stays a node, and so does a
table with no database above it. On a serverless or managed store where the
table is itself the resource you deploy, write one node per table inside the
service that owns it, with no container invented to hold them.

```squinch
system shop "Order Service" {
  svc = aws/lambda "Order Handler"
  container db "Orders DB" {
    icon: aws/rds
    description: "Postgres 16 · 3 tables"
    customers = sys/table "customers" datastore
    orders    = sys/table "orders" datastore { subtitle: "partitioned monthly" }
    payments  = sys/table "payments" datastore
    orders   -> customers "customer_id"   // a foreign key, child to parent
    payments -> orders    "order_id"
  }
  svc -> db.orders "writes"
}
```

Edge motion — `~>` edges animate on their own (dashes drift toward the target,
off under `prefers-reduced-motion`). Opt out with `{ animate: false }`, or pick
a variant: `reverse` (acks flowing back), `slow`/`fast` (cadence), `packets`
(discrete messages), `pulse` (a heartbeat — works on solid sync edges too),
`comet` (a dot rides the route — the only motion a plain solid edge can take).
Sync edges take `style: dotted` (`dashed` warns next to `~>` edges — dashes
are the async convention), and a dotted sync edge may also animate. One `animate:` value per edge, and don't decorate every edge — motion
is for the hops where cadence or direction *means* something.

```squinch
probe  -> legacy "healthcheck" { animate: pulse }
sensor ~> ingest "telemetry"   { animate: packets }
cart   -> pay "checkout"       { animate: comet }   // no `style:` needed
mirror -> replica "sync" {
  style:   dashed
  animate: slow
}
```

Colour — `color:` takes one of nine hues, `red | amber | green | teal | blue |
violet | pink | gray | accent`, never hex (each is a designed light/dark pair,
and a literal cannot be right on both). It goes on anything: a leaf, a person
or a `system` gets a spine down its left edge, an edge its stroke and head, a
zone its outline. Use it to say *these belong together* or *this is the path*
without dimming everything else the way `highlight` does. The stronger form is
the view statement `color #tag red`, which colours every visible thing carrying
the tag, one tag per line — it wins over an element's own `color:`, and with
`legend auto` each coloured tag earns a legend entry. Colour is annotation:
async stays dashed, context stays muted, so a greyscale print loses only the
emphasis.

Zones mark deployment boundaries: `zone id "Label" kind { contains a, b.c }`,
kinds `account | region | vpc | subnet | network | cloud | onprem | custom`.
Optional attrs: `icon:` — **any** pack icon (`azure/vnet`, `logos/docker`; AWS
ships purpose-made group marks like `aws/vpc`, `aws/region`,
`aws/private-subnet`, `aws/corporate-data-center`) — `label: top-right`
(corners: top-left default, top-right, bottom-left, bottom-right), and
`color: teal` (the nine hues above; never hex). A zone's `kind` already picks
its tint — `account` red, the network kinds blue, `cloud` violet, the rest
gray — so two nested zones of related kinds come out nearly the same shade:
set `color:` on the inner one to tell them apart. `detail: "10.0.0.0/16"` adds a second, monospaced
segment to the chip for the boundary's hard fact — a CIDR, an account id, a
region. It is dropped rather than truncated on a boundary too narrow for both,
since a clipped CIDR is a different network, not a shortened label.

**Zones nest by sharing members, never by naming each other.** `contains` takes
nodes, so an outer boundary repeats the inner one's members:

```
zone account "Azure Subscription" account { contains gw, aks, sql }
zone vnet    "Virtual Network"    network { contains aks, sql }
```

`aks` and `sql` are in both, so `vnet` draws inside `account`. Naming the inner
zone — `contains gw, vnet` — is accepted as shorthand for exactly that
expansion. Everywhere *else* a zone id is an error: you cannot draw an edge to
a boundary. Zones must nest cleanly or stay disjoint in any one view, may not
cut through an expanded container, and only appear where their members are
visible.

## Views (altitudes)

Every system automatically gets a zoomable view. Declare views to customize or to
add lenses — and declare one for any part the ask singles out ("I care most
about orders"): `render --sync` writes only declared views, so an auto view the
reader was promised never reaches them as SVGs. `view orders { title "…" }` is
enough.

```squinch
view landscape {            // views take no positional label — the title is a
  title "System Landscape"  // statement. It draws top-left as the diagram's
                            // name, with or without a `titleblock`.
  include *                 // all TOP-LEVEL entities, as collapsed cards
}

view shop {                 // name matching a system = that system's view
  scope shop                // implied by the name here; explicit for clarity
  only #pci                 // KEEP only these — the view's filter. `scope` says
                            // where you stand, `only` says which of it you keep.
                            // Takes ids too: `only api, vault`
  exclude legacy            // trim noise (removes the subtree)
  expand workers            // inline one child container in a frame — one
                            // level; nesting two explicit expands is an error.
                            // Several: `expand workers, ledger`, or one per line
  detail ledger.post        // draw an outside node itself, not its system card
  highlight #pci            // spotlight matches, dim the rest — this still
                            // shows EVERYTHING; "only the PCI parts" is `only`
  color #pci red            // colour everything tagged #pci, dim nothing —
                            // one tag per line; wins over an element's own color:
  note right-of db "Single-table design; see ADR-42"
  note top-right "Audit scope: Q3" { style: warning }
  context off               // drop the muted neighbour cards this view earned
                            // (default is `context auto`)
  legend auto               // footer key of the styles actually used
  titleblock {                // a meta chip under the title. version/commit/
    subtitle: "Landscape view" // date are reserved — their values stand alone,
    version: "2026-07"         // and `commit` sets in mono. Any other key
    commit: "a41f0c2"          // keeps its key beside its value.
    owner: team-orders         // Nothing here is derived: no git, no clock.
  }
}
```

When the reader wants **everything on one page** — every container open to
leaf depth, no clicking around — declare a full-detail view with `expand *`
(declare it after the landscape so the breadcrumb keeps pointing home). It
composes with the other verbs: `scope orders` + `expand *` opens one subtree.

```squinch
view full {
  title "Full detail"
  expand *                  // open every container, frames nesting as they go;
                            // empty containers stay cards, edges de-aggregate
}
```

Between a card and an open frame there is one more altitude: **`preview
<path>`** (a comma list, or `preview *`) draws a card **detailed** — the children its
`preview:` attr names (§ containers; up to three, `auto` takes the first three
declared) as readable rows under the head, `+N more` on the shelf for the
rest. It is still a card: every wire lands on it, nothing attaches to a row,
and a dive opens the container. Reach for it on the *landscape*, when the
reader should see what a system is made of without opening it — a domain and
its capabilities, a platform and its services — and only where those children
carry a `description:` or `subtitle:`; three bare names say little more than
the chips. Do not put it on every view: a dense view has no room for a card
twice its height, and `preview` beside `expand` on the same container is an
error.

```squinch
system orders "Orders" {
  description: "Order lifecycle, cart to refund"
  preview: [checkout fulfillment returns]   // what the card calls out; pricing folds into +1
  system checkout "Checkout" {
    description: "Cart to confirmed order"
    api = aws/lambda "Checkout API"
  }
  system fulfillment "Fulfillment" {
    description: "Pick, pack, dispatch"
    worker = aws/lambda "Dispatcher"
  }
  system returns "Returns" {
    description: "Refunds and RMAs"
    api = aws/lambda "Returns API"
  }
  system pricing "Pricing" {
    description: "Prices, promotions, tax"
    api = aws/lambda "Pricing API"
  }
}
view landscape {
  include *
  preview orders            // the Orders card, with its three parts named
}
```

Numbered flows badge a request's path over **edges that already exist** — a
flow annotates the model, it never creates connections. A step with no edge
behind it is a check error telling you to declare the edge first (steps count
in declaration order; bare ids bind when unambiguous, otherwise use full
paths):

```squinch
system shop "Shop" {
  api = aws/api-gateway "API"; create = aws/lambda "Create"
  db = aws/dynamodb "Orders"; files = aws/s3 "Files"
  api -> create                    // these edges…
  create -> db
  create ~> files
}
flow checkout "Checkout" {
  api -> create -> db              // …are what the flow numbers: steps 1, 2
  create ~> files                  // step 3 — branches keep counting
}
view shop { show flow checkout }
```

`flow` blocks live at the **top level**, beside your systems — not inside a
`system` and not inside a `view` (the view only says `show flow <id>`). From out
there, write steps as full paths (`shop.api -> shop.create`). A step may cross a
view's `scope`. A flow is also a story: in the playground's **Present** mode the
arrow keys walk a `show flow` view one hop at a time — nothing extra to author.

Grouping vs. nesting: `include *` shows only *top-level* entities, so wrapping
several services in a parent `system` purely to group them collapses them into
one card at landscape altitude. If they should stay individually visible but
share a boundary, keep them top-level and group them with a `zone`.

### When the system is big

A reader can only take in so much at once, so on a large system — a whole
repo, a platform — size is a modelling decision, made before layout. A small
system needs none of this: keep it flat.

- **Group before you draw.** Sort the components into the areas the system
  already has — its top-level folders, its teams, its domains — and make each
  a `system`. Use the names the code uses. If nothing hands you the areas,
  find them: things that call each other and change together. The landscape
  then draws one card per area with the calls between them merged (`×4`), and
  every area gets its own zoomable view for free.
- **It holds at every altitude.** Opening an area should read as easily as the
  landscape does. Every service inside one `backend` system has only moved
  the problem down a click — group by what things are *for* (identity,
  catalogue, buying, fulfilment), and nest a system inside a system when an
  area is itself big.
- **What a thing owns lives inside it.** A service's own database, cache or
  worker belongs in that service's area, not beside it on the landscape. What
  everyone shares — a gateway, an event bus — stays top-level.
- **One caller with many targets is the shape that runs off the page**: a UI
  or gateway calling every service draws them all in one row. Grouping the
  targets is the fix. `wrap N` folds a fan-out only when the targets do not
  call each other, and a real system's usually do. Never answer it by listing
  every target in one `rows` band — that forces exactly the strip you are
  trying to avoid. Leave the targets unhinted and let the engine rank them.
- **Hand over altitudes, not one page.** Declare the landscape first, then a
  view for each area worth opening; the interactive HTML lets the reader
  click down. `view full { expand * }` is for when they ask for everything at
  once. Say in your hand-over how you grouped it, so the reader can ask you
  to open an area up rather than start over.
- **Let the landscape say what each area is made of.** Give every area a
  `description:`, and when its parts are things the reader would recognise —
  the services of a platform, the capabilities of a domain — name the three
  that matter in `preview: [a b c]` and put `preview *` on the landscape view.
  Each card then lists those three under its name, still as one card, and the
  reader knows what is inside before clicking. Only there: a zoomed view has no
  room for cards twice the height.

Zoomed views automatically show outside neighbours as muted **context** cards —
don't add them yourself; if one appears that you don't want, `context off`.

## Layout hints (in a `layout { }` block — a view's, or a system's own)

Hint conflicts are the single biggest source of failed `check` runs in this
project's history — almost always a `rows` that pins every node, colliding with
one feedback edge. The engine ranks a clean pipeline correctly on its own;
every hint you add is a constraint you have to keep true.

```squinch
view shop {
  layout {
    direction down                    // down (default) | right
    density comfortable               // compact | comfortable | spacious
    lines orthogonal                  // orthogonal (default) | curved | straight
    rows [api] [create get search] [db files idx]   // horizontal bands, top to bottom
    cols [create db] [get files]      // vertical bands, left to right (shared axis)
    place sync right-of db            // right-of | left-of | above | below
    align gw db                       // exact shared axis; first one is the anchor
    channel create, get, search -> db // one trunk into a shared target, not N lines
                                      // (the edges stay declared in the model;
                                      //  this only merges how they are drawn)
    route api -> db from south to north   // which side an edge exits/enters —
                                          // only for edges that SPAN rows; a
                                          // same-rank edge is routed for you
    route api -> db "write" from south    // label disambiguates parallels
  }
}
view steps { include *
  layout { wrap 5 } }                     // a long chain or a wide fan-out, folded
```

- `rows` is the workhorse: one bracket group per horizontal band, listed top to
  bottom; order inside a bracket is left to right. Unlisted nodes place
  themselves — only list a node when you care where it lands. Do **not** use
  it to fold a long chain or a wide fan-out into several bands by hand: the
  edges that skip a band detour around it and the fold reads worse than the
  wide version. That is what `wrap N` is for — it folds the chain as a
  serpentine, or the fan-out onto a bus, and routes the fold cleanly.
- **`wrap N` puts N in each band, and N sets the shape** — for a chain and a
  fan-out alike. For a slide, roughly 16:9, use N ≈ √(nodes being folded),
  rounded up: a 14-step chain is `wrap 4`, and so are twelve workers under
  one dispatcher. Half per band (`wrap 7` on fourteen) is a ribbon, not a
  slide. Leave `direction right` out of a wide fold: a band is a rank, and
  under `direction right` ranks are columns, so `wrap 7` becomes two tall
  columns of seven.
- **Every edge must point down your bands** — check each band against your
  arrows before you write it. The bands are a claim about direction, and a node
  pointing back *up* the list is a check error, not a nudge. This bites on
  monitoring, feedback and retry paths: `mon -> api` under
  `rows [api] [svc] [db] [mon]` is refused. Two fixes, both fine: put the
  observer in the **same** band as what it watches (`rows [api mon] [svc] [db]`
  — equal ranks are legal and route side to side), or leave it out of `rows`
  and let the engine rank it.
- `cols` is its transpose: one bracket group per vertical band, left to right.
  Members of a column share an exact axis, so a service and its database line
  up. `rows` and `cols` compose — they pin different axes, so using both gives
  you a full grid, and a cell is empty when nobody is placed in it.
- **`cols` and `align` work across bands, never within one.** Six collectors
  that all feed one normaliser are siblings on a single rank — they are already
  drawn side by side, and no two of them can share an axis, so `cols [c1 … c6]`
  is refused. If you want them beside each other, that is `rows [c1 … c6]`. The
  trap is worst under `direction right`, where a rank *looks* like a column on
  screen: the words name the model, not the picture.
- **A system's interior is arranged by the system itself.** Give the system
  its own `layout { }` with `rows`/`cols`/`place` in short names, and that
  arrangement follows it into every view that opens it — expanded beside its
  siblings, or standing inside it in the system's own view. Direct members
  only: a nested container gets its own block. The view then only ranks
  systems against each other, and never restates an interior:

```squinch
system checkout "Checkout" {
  api = aws/api-gateway "API"; svc = aws/lambda "Orders"
  bus = aws/sqs "Events"; cache = aws/elasticache "Sessions" datastore
  db = aws/dynamodb "Orders" datastore
  api -> svc; svc ~> bus; svc -> cache; svc -> db
  layout { rows [api] [svc] [bus cache] [db] }   // short names, inside
}
system pipeline "Pipeline" {
  ingest = aws/lambda "Ingest"; enrich = aws/lambda "Enrich"; publish = aws/lambda "Publish"
  ingest -> enrich; enrich -> publish
  layout { direction right }                     // this interior reads left to right
}
view detail {
  expand checkout
  expand shipping
  layout { rows [cdn] [checkout shipping] }      // the view ranks the systems
}
```

  `direction right` in a system's block lays that system's interior out left
  to right wherever it is opened, inside a view that still flows down — the
  way to draw a pipeline as a row. It is a property of the system, not of the
  view: there is no per-view override for an expanded frame.
  A view may still name interior paths (`rows [gw] [checkout.api]`); when its
  hints relate two or more of a system's members they replace that system's
  block in that view, whole — bands are never merged. Naming one member only
  ranks the whole system from outside. Two members of one system asked to
  share a row with an edge between them is a warning: same-rank edges route
  between systems, not inside one, so put one below the other or collapse the
  system in that view.
- **Rank hints don't reach inside a zone.** A zone lays out as a single block —
  `rows`/`cols`/`place` order zones *relative to each other*, and the engine
  arranges the members within. To rank a zone, name **one** member of it (or
  the zone's own id): `rows [gw] [prod_vpc]` puts the whole boundary below the
  gateway. Listing every member does nothing but earn a warning. If the ranking
  matters more than the boundary, drop the zone. Two zones *may* share a band
  with edges running between them — `rows [batch orders]` on two namespaces
  holds, and the edge routes through the gutter like one between expanded
  containers.
- A node may be in a band **and** carry a `place`, so long as the two agree —
  `rows [db bus]` with `place bus right-of db` is fine; a `place` that puts the
  node somewhere the band does not is refused.
- `place x right-of y` is the whole side-car idiom (stream processors, caches,
  DLQs). Do **not** add `route y ~> x from east to west` to it: `place` puts
  the two on the same row, and same-rank edges route side to side
  automatically — a `from`/`to` on one is ignored, and says so.

The cookbook in `references/cookbook.md` is the next step when a diagnostic is
not self-explanatory or the render shows a shape you cannot name the hint for —
symptom → fix, keyed on the diagnostic's own words.

## Icons

**Read `references/icons.md` when you need an icon id outside the AWS basics**:
it lists the ids and aliases per pack, the Google Cloud category rule in full,
the Kubernetes short names, the `sys/` rows by theme, and the Databricks recipe
worked out component by component. Open it before you write the node, not after
`check` refuses the id.

When the request names a **specific product**, search for it — don't write the id
from memory. `check` only tells you an id exists, never that it's the one the
reader asked for, so a plausible-but-wrong mark passes silently and ships. The
confusable pairs are the ones to watch: CloudFront (`aws/cloudfront`, a CDN) is
not Cloudflare (`logos/cloudflare`, a different company); `aws/aurora` is not
`aws/rds`. One `squinch icons search cloudfront` settles it.

The AWS ids you'll use constantly: `lambda` · `dynamodb` · `s3` · `sqs` · `sns` ·
`api-gateway` · `opensearch` · `aurora` · `rds` · `elasticache` · `cloudfront` ·
`eventbridge` · `kinesis` · `step-functions` · `ecs` · `eks` · `fargate` · `ecr` ·
`athena` · `glue` · `redshift` · `sagemaker` · `bedrock` · `rekognition` ·
`cognito` · `secrets-manager` · `route-53` · `waf` · `elastic-load-balancing`
(alias `elb`) · `batch` · `efs` · `app-runner`.

Six packs, and the ids you'll reach for in each:

- **`aws/`** — 316 icons; the basics above.
- **`azure/`** — 636 icons, named like the portal (`azure/app-services`,
  `azure/storage-accounts`, `azure/monitor`), with short forms for the ones
  everybody abbreviates: `azure/aks` · `azure/vm` · `azure/vnet` ·
  `azure/cosmos` · `azure/functions` · `azure/sql` · `azure/blob` ·
  `azure/service-bus` · `azure/event-hub` · `azure/key-vault` ·
  `azure/front-door` · `azure/app-gateway` · `azure/load-balancer` ·
  `azure/aci` · `azure/acr` · `azure/api-management` · `azure/log-analytics` ·
  `azure/redis`.
- **`gcp/`** — 45 icons, because Google's own system works that way: nineteen
  products have a unique mark (`gcp/cloud-run`, `gcp/gke`, `gcp/bigquery`,
  `gcp/cloud-sql`, `gcp/spanner`, `gcp/vertex-ai`…), and *every other product
  draws its category's glyph* under the name you know it by (`gcp/pubsub`
  draws Data Analytics). Put the product name in the label and let the icon
  say the category.
- **`k8s/`** — 39 icons under kubectl's short names, for what runs *inside* a
  cluster: `k8s/pod` · `k8s/deploy` · `k8s/svc` · `k8s/sts` · `k8s/ds` ·
  `k8s/cm` · `k8s/secret` · `k8s/ing` · `k8s/ns` · `k8s/sa` · `k8s/pv` ·
  `k8s/pvc` · `k8s/hpa` · `k8s/job` · `k8s/cronjob` · `k8s/crd` · `k8s/node` ·
  `k8s/etcd` · `k8s/control-plane` · `k8s/api` · `k8s/sched` · `k8s/kubelet`.
  `logos/kubernetes` when the cluster is one box in a wider estate.
- **`logos/`** — 147 product marks plated in their brand colour, the non-cloud
  half of a stack: `logos/postgres` · `logos/mysql` · `logos/mongodb` ·
  `logos/redis` · `logos/kafka` · `logos/rabbitmq` · `logos/elasticsearch` ·
  `logos/docker` · `logos/terraform` · `logos/nginx` · `logos/github` ·
  `logos/gitlab` · `logos/grafana` · `logos/prometheus` · `logos/datadog` ·
  `logos/sentry` · `logos/stripe` · `logos/snowflake` · `logos/cloudflare` ·
  `logos/vercel` · `logos/react` · `logos/python` · `logos/go` · `logos/rust`.
  Slack, Twilio, Salesforce, Heroku, gRPC and dbt have no mark upstream — use
  `box` or the label.
- **`sys/`** — 195 generic Lucide icons for what no vendor draws, and it needs
  no `pack` statement. Ids are Lucide's own names, so a word you would say
  (`process`, `analytics`, `device`, `web`) is usually *not* one — pick from
  these: compute `server` `container` `cpu` `code` `app-window` `terminal`
  `cog` `webhook` `workflow`; hardware `laptop` `monitor` `smartphone`
  `hard-drive` `printer`; network `network` `router` `wifi` `radio-tower`
  `globe` `share-2`; security `lock` `key-round` `shield` `shield-check`;
  data `database` `folder` `search` `archive` `table` `file`; places `factory`
  `warehouse` `building-2` `house` `earth`; process and observability `clock`
  `timer` `repeat` `activity` `gauge` `chart-line` `siren` `bug`; commerce
  `shopping-cart` `credit-card` `wallet` `receipt-text` `truck`
  `package-check` `barcode`; shapes `box` `circle` `square` `hexagon`
  `diamond` `star`. Aliases: `gear`→`cog`, `db`→`database`,
  `rack`/`vm`/`host`→`server`, `firewall`→`shield`, `vault`→`lock-keyhole`,
  `cron`→`clock`, `lb`→`share-2`, `cart`, `payment`, `order`, `shipping`.

Pick one cloud's pack and stay with it — don't draw the same concept as
`aws/…` in one box and `azure/…` in the next. Composing a cloud pack with
`logos` and `sys` is normal; it's how you draw a hybrid estate. A platform with
no pack at all — Databricks, Snowflake, dbt, Confluent publish no icons anyone
may redistribute — is drawn as the concept from `sys/*` with the vendor's mark as
a `badge:` where `logos/*` has one; never a lookalike from another vendor, never
an invented id.
