# Squinch — DSL Spec v0 (draft)

> Naming (decided 2026-07-24): file ext `.squinch`, CLI binary `squinch`, npm scope
> `@squinch/*` (CLI published as bare `squinch`). Constructs marked **[v1.1]** /
> **[v2]** are specced for direction but not built in v1.
>
> Companion docs: [DESIGN.md](DESIGN.md) (design language), [PLAN.md](PLAN.md)
> (build plan).

## 1. Design principles

1. **Everything expressible without coordinates.** All placement is relative (rows,
   columns, `right-of`, sides). There is no way to write `x: 340` — by design.
2. **Structure and layout never mix.** The model reads clean; layout lives in `layout`
   blocks inside views. Deleting every `layout` block always yields a valid render.
3. **Forgiving surface, strict core.** Optional quotes and trailing commas; `//` and
   `#` comments; newline- or comma-separated lists. But unknown identifiers are errors
   (with did-you-mean suggestions) — silent typos make lying diagrams.
4. **Ids are the API.** `api = aws/api-gateway "API Gateway"` — the id `api` is what
   edges, layouts, views, and other teams' imports reference. Labels are free to change.
5. **LLM-first ergonomics.** Short common-case syntax, examples-friendly grammar, error
   messages that state the fix.

## 2. File anatomy

```squinch
// order-service.squinch
pack aws                          // icon packs used (versions pinned in squinch.lock)
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
stripe = logos/stripe     "Stripe" external      // trailing keywords: external, datastore, person

create = aws/lambda "Create Handler" {           // optional attribute block
  description: "Validates and persists new orders"
  owner:  team-orders
  link:   https://github.com/org/order-service
  status: planned            // planned | deprecated → rendered as badge/ghost
  tags:   #pci #critical
}
```

`description` and `tags` are available on **every** node, container, and edge.
Descriptions render as the card tagline, in hover cards, and inline via a view's
`show descriptions` toggle. Container tags are inherited by everything inside
(tag `shop` with `#pci` and all its children match `#pci`).

- Node kinds (`person`, `external`, `datastore`, plain) affect default styling per
  theme; usually inferred from icon metadata, keyword overrides available.
- `person customer "Customer"` is sugar for `customer = builtin/person "Customer"`.

### Containers & nesting (C4-style)

`system` and `container` nest arbitrarily; every level is zoomable:

```squinch
system shop "Order Service" {
  glyph:   sys/api            // optional badge on the collapsed card
  preview: auto               // none | auto | [api db] — mini-strip of inner icons
  owner:   team-orders

  api = aws/api-gateway "API Gateway"
  container workers "Async Workers" {
    sync = aws/lambda "Stream Sync"
  }
  db ~> workers.sync "stream"      // dotted path to nested ids
}
```

Ids resolve lexically: inside `shop`, write `sync` or `workers.sync`; outside, write
`shop.workers.sync`.

**Altitude rendering:** a collapsed system/container renders as a **system card** —
kind-driven silhouette, label, optional `glyph` badge, optional `preview` strip —
never as a grid of its inner provider icons. Zooming/`expand` swaps the card for the
internals. Provider icons (e.g. `aws/*`) belong to leaf nodes; landscape-altitude
identity comes from shape + label + accent.

### Zones (deployment boundaries) **[v1.1]**

Ownership nesting (`system`/`container`) and deployment boundaries (VPC, account,
region, subnet) are different hierarchies — a zone is **cross-cutting** and declared
separately, with members listed by path:

```squinch
zone prod_account "Prod Account" account {
  contains orders, billing
}
zone vpc_a "VPC A" vpc {
  contains orders.api, orders.handlers, orders.db
}
```

Zone kinds (`account | region | vpc | subnet | custom`) drive the frame styling —
the classic dashed boundary with a corner label. Constraint: within any single view,
visible zones must form a clean hierarchy (nested or disjoint); partial overlap is a
render error naming the offending members. Zones are model facts (deployment truth),
but only render in views where their members are visible.

### Flows (numbered paths) **[v1.1]**

```squinch
flow checkout "Checkout" {
  api -> create -> db          // chain; steps numbered in order
  create ~> files              // branches continue the numbering
}

view orders {
  show flow checkout           // renders ①②③… badges on the flow's edges
}
```

A static precursor to animated flow stories [v2]: same construct, presentation mode
later steps through it.

### Built-in packs

Always available without a `pack` statement: `builtin` (`box`, `person`), `sys`
(~30 first-party archetype glyphs: api, webapp, mobile, service, worker, database,
cache, queue, event-bus, filestore, search, ml-model, scheduler, gateway, auth,
monitor, org, internet, device, …; stroke-based/`currentColor`, theme-tintable), and
`logos` (third-party brand marks, Simple Icons-sourced) ships as a normal installable
pack.

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
  color:   muted                    // theme token, never hex in diagrams
}
```

Rules: an edge may appear anywhere its two endpoints are both in scope; duplicate edges
(same endpoints, same label) merge with a warning; labels are optional.

**Parallel edges & edge identity**: multiple edges between the same pair are legal and
distinguished by label (`api -> db "read"` / `api -> db "write"`). Any construct that
*references* an edge (`route`, `note on`, flows) may include the label to disambiguate:
`route api -> db "write" from east`. Referencing an ambiguous parallel edge without a
label is a check error ("2 edges match `api -> db` — add the label").

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
  layout { ... }                // §6

  highlight #pci                // spotlight matching elements, dim the rest;
                                // SPA renders tag chips for interactive toggling
  show descriptions             // render descriptions inline (off by default)
  show flow checkout            // ①②③ badges along a declared flow   [v1.1]
  legend auto                   // auto | off — legend of the edge styles
                                // and kinds this view actually uses
  titleblock {                  // drafting-style corner block
    version: "2026-07"
    owner:   team-orders
  }

  note right-of db "Single-table design; see ADR-42"
  note on db ~> sync "at-least-once; consumer must be idempotent"
  note top-right "Target state, Q3" { style: warning }
}
```

Notes are view-level commentary (never model facts): anchored relative to a node
(`right-of`/`left-of`/`above`/`below`), to an edge (`on a -> b`), or to a canvas
corner (`top-left`…`bottom-right`) — the no-coordinates principle applies to notes
too. Themes style them as callouts; the sketch theme renders them handwritten.

- Every `system`/`container` gets an auto-generated default view (`view <path>`), so
  double-click-to-zoom always works even with zero `view` blocks written. Declaring
  `view <path>` explicitly *is* the customization of that auto view.
- `include`/`exclude` accept ids, paths, and tags (`include #pci`). **[tags v1.1]**

### Visibility resolution (what's shown at each level)

A deterministic rule stack, evaluated in fixed order:

1. **Scope children**: the scope's *direct* children — containers as cards, leaves as
   icons. Exactly one level deep; depth is opened deliberately via `expand`.
2. **Context neighbors**: elements outside the scope with ≥1 edge (after lifting)
   into the visible interior are auto-included, rendered at **top-level altitude**
   (the foreign *system* as one muted/hatched card — `web`, not `web.app`) at the
   periphery. `context off` disables; explicitly `include web.app` overrides the
   top-level lift and anchors edges to the deeper node instead.
3. **Explicit `include`** adds elements (or tag matches [v1.1]).
4. **`exclude` wins last** — removes an element and its entire subtree, beating
   scope, context, expand, and include.
5. **Derived content follows visibility, never drives it**: edges render iff both
   lifted endpoints are visible and distinct; zone frames wrap only visible members
   (none visible → no frame); a note anchored to an invisible element is suppressed
   with a lint warning; context neighbors must *earn* inclusion via a surviving edge.

`highlight` and the SPA's tag chips are orthogonal to all of this — they dim and
spotlight but never change the visible set. Visibility is structure; highlight is
attention.

### Edge lifting (what makes zoom work)

Edges are declared at whatever depth they're true (`web.app -> orders.api`); each view
re-anchors them deterministically:

1. Each endpoint lifts to its **nearest visible ancestor** in the view.
2. Both endpoints lift to the same visible node → the edge is internal → hidden here.
3. Edges lifting to the same visible (source, target) pair **merge into one aggregate
   edge**: single constituent keeps its label; multiple render a count badge (`×3`).
   In SPA/VSCode, hover/click lists the constituent relations with jump-links to the
   view where each is native.
4. Aggregates render style-neutral (solid, medium) regardless of constituent styles —
   async dashes/animation reappear at the altitude where those edges are native.
5. Lifting is a pure model operation — identical results in SPA, VSCode, CLI, CI.

### Zoom navigation

SPA/VSCode: double-click a card → that node's view; breadcrumb & browser-back go up;
every view is a deep link (`#/view/orders.handlers`). Static renders: `render --sync`
emits one SVG per view, and system cards carry plain `<a href>` links to sibling view
SVGs — click-to-zoom works in committed SVGs on GitHub with zero JavaScript.

## 6. Layout (the three tiers)

All inside `view { layout { ... } }`. Everything optional; auto-layout (ELK, deterministic,
declaration-order-stable) fills every gap.

### Tier 0 — view-level knobs

```squinch
layout {
  direction down          // down | right (default down)
  lines orthogonal        // orthogonal | curved | straight (default orthogonal, rounded)
  density comfortable     // compact | comfortable | spacious
}
```

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
- `grid [a b] [c d]` **[v1.1]** — full fixed grid escape hatch for when
  auto-layout should get out of the way entirely; cells may be `_` (empty).
- Hints are per-view, keyed by node id (semantic + diffable). A hint referencing a
  removed/renamed id is a *warning*, never a silent relayout.
- **Contradictions are errors, never silent**: conflicting hints (`place a right-of b`
  + `place b right-of a`, a `rows` rank fighting an `align`) and constraint cycles
  fail `check` with both locations named. A silently dropped hint would strand the
  agent loop; a clear conflict error gets fixed in one iteration.

### Tier 2 — edge routing **[partially v1.1]**

```squinch
layout {
  route db ~> sync from east to west        // exit/entry sides        [v1]
  channel create, get, search -> db          // shared trunk (bus)      [v1.1]
  route search -> idx around files           // avoid a node's lane     [v1.1]
  route api -> legacy via below-db           // coarse waypoint: a node-relative
                                             // region, never a coordinate [v1.1]
}
```

The GUI's drag-to-adjust writes Tier 1/2 statements back into the source — the canvas
is a hint-authoring device, never a coordinate store. **[v2]**

## 7. Packs, themes, exposure

```squinch
pack aws                     // resolved via squinch.lock → @squinch/pack-aws@x.y.z or vendored copy
pack corp from "./icons"     // local: directory with pack.json + svgs

theme dark                   // file-level default; views override
expose api, db               // [v2] this file's public surface for importers
```

Missing pack/icon never fails a render: placeholder box + warning diagnostic.

## 8. Grammar sketch (informal EBNF)

```ebnf
file        = { statement } ;
statement   = pack | import | node | container | edge | view | theme | expose
            | zone | flow ;

zone        = "zone" ident [ label ] [ ident ] "{" "contains" pathlist "}" ;  (* v1.1 *)
flow        = "flow" ident [ label ] "{" { chain } "}" ;                      (* v1.1 *)
chain       = path { arrow path } ;

pack        = "pack" ident [ "from" string ] ;
import      = "import" string "as" ident ;                        (* v2 *)
container   = ("system" | "container") ident [ label ] "{"
                { ident ":" value      (* card attrs: glyph, preview, owner, ... *)
                | node | container | edge } "}" ;
node        = ident "=" iconref [ label ] { kind } [ attrs ]
            | ("person") ident [ label ] ;
iconref     = ident "/" ident | "box" ;
kind        = "external" | "datastore" | "person" ;
edge        = path arrow pathlist [ label ] [ attrs ] ;
arrow       = "->" | "~>" | "<->" | "--" ;
path        = ident { "." ident } ;
pathlist    = path { "," path } ;
theme       = "theme" ident ;
expose      = "expose" pathlist ;                                 (* v2 *)

view        = "view" path "{" { viewstmt } "}" ;
viewstmt    = "title" string | "theme" ident | "scope" path
            | "include" targets | "exclude" targets | "expand" path
            | "context" ( "auto" | "off" )
            | "highlight" tag { tag }
            | "show" ( "descriptions" | "flow" ident )
            | "legend" ( "auto" | "off" ) | "titleblock" attrs
            | "note" anchor string [ attrs ]
            | "layout" "{" { layoutstmt } "}" ;
anchor      = relpos path | "on" path arrow path | corner ;
corner      = "top-left" | "top-right" | "bottom-left" | "bottom-right" ;
tag         = "#" ident ;
targets     = ( path | tag ) { "," ( path | tag ) } ;
layoutstmt  = "direction" ("down"|"right") | "lines" ident | "density" ident
            | "rows" rank { rank } | "cols" rank { rank }
            | "place" path relpos path | "align" path path { path }
            | "route" path arrow path { routemod }
            | "channel" pathlist arrow path ;
rank        = "[" path { path } "]" ;
relpos      = "right-of" | "left-of" | "above" | "below" ;
routemod    = "from" side | "to" side | "around" path | "via" region ;
side        = "north" | "south" | "east" | "west" ;

label       = string ;  attrs = "{" { ident ":" value } "}" ;
```

Whitespace-insensitive; statements end at newline or `;`. Built with Lezer so the same
grammar drives parsing, CodeMirror highlighting, and LSP autocomplete.

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
```

Lint (non-fatal): orphan nodes, duplicate edges, unreachable `exclude` targets, labels
over ~40 chars, layout hints referencing excluded nodes.

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
    route db ~> sync from east to west
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
    route db ~> sync from east to west
    route search -> idx around files           // stop cutting through the S3 lane
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

Version pinning lives in `squinch.lock`; CI warns when an import's exposed surface changes.

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
  show descriptions
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
- Anything marked [v1.1]/[v2] must degrade gracefully when absent: unknown *future*
  keywords are errors today (no silent acceptance).
