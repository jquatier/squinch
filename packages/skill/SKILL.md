---
name: squinch
description: Author architecture diagrams as code with the Squinch DSL. Use when asked to create, edit, or review an architecture/system diagram. Write a .squinch file, validate it with `squinch check`, render SVG with `squinch render`, and fix what you see using the layout cookbook below.
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
squinch render diagram.squinch -o out.svg     # deterministic SVG (light theme)
squinch render diagram.squinch --view NAME --theme dark -o out.svg   # themes: light | dark | sketch | sketch-dark | contrast
squinch render diagram.squinch -o out.png --scale 2   # PNG for slides/docs (--width also works)
squinch icons search <term>                   # find icon ids, e.g. "queue", "kafka"
squinch diff --format json                    # what changed in the architecture
```

1. Write the model first, with **no `layout` block at all**. Render it and look.
2. Most diagrams need no `layout` block ever. Your edges already say what the
   tiers are, and the engine ranks from them: a node sits below everything that
   points at it. Writing `rows` that lists every node just restates that — and
   the moment one edge disagrees with your band order it is a hard error, not a
   nudge. Add hints only to fix something you can see is wrong in the render,
   one at a time, naming only the nodes you actually care about.
3. `check` after every edit. Diagnostics tell you the location, the problem, and
   usually the fix (`did you mean ...?`). Trust them.
4. Exit code 0 and **no diagnostics at all** = clean. Errors block the render;
   warnings do not, which is exactly why they matter — a warning means the file
   is valid but probably not the diagram you were asked for. `only changed
   nothing` means your tag covers everything, so the lens shows the whole
   picture. Fix warnings before you stop.

## Language

```squinch
// comments are // only (# belongs to tags)
pack aws                              // enable a vendor icon pack (aws | azure |
pack azure                            //  logos | k8s — declare each one you use).
                                      //  `sys` and `builtin` need no declaration.

person customer "Customer"            // human actor. This form is top-level
                                      // only — inside a system write it as
                                      // `who = person "Operator"`.
gw = aws/api-gateway "Edge Gateway"   // components may sit at the top level too,
                                      // not only inside a `system` — that's how
                                      // you keep things individually visible at
                                      // landscape altitude and group them with
                                      // a `zone` instead

system shop "Order Service" {         // systems/containers nest arbitrarily
  description: "Checkout and orders"  // optional; shows on the collapsed card
  glyph: sys/code                     // badge for the collapsed card — any pack
                                      // icon works (aws/…, logos/…), not just sys/…
                                      // a bad ref is a check error, not a `?` plate
  tags: #core                         // tags inherit to everything inside

  api    = aws/api-gateway "API Gateway"        // id = pack/icon "Label"
  create = aws/lambda      "Create Handler" {
    description: "Validates and persists"
    tags: #pci
  }
  db     = aws/dynamodb    "Orders Table" datastore {
    tags: #pci                        // kind and attr block go in either order
  }
  wh     = sys/database    "SQL Warehouse" datastore {
    badge: logos/databricks           // small vendor mark on the icon plate —
                                      // see "Platforms with no icon pack" below
  }
  legacy = box             "Old Billing" external   // `box` = no icon
  // kinds: `external` (not ours — someone else's system) and `datastore`
  // (holds state). `external` draws a hatched surface and is the one worth
  // reaching for: nothing else in the diagram says "this is somebody else's".
  // It also goes on a whole system — `system stripe "Stripe" external { … }`
  // — where the whole card hatches. `datastore` is a note to the reader and
  // to `squinch diff`; your icon choice is what actually shows it. For a
  // human, use the `person` forms above rather than a kind.

  api -> create                       // sync edge (solid)
  api -> create, get, search          // fan-out
  db ~> sync "DynamoDB stream"        // async edge (dashed); label optional
  api -> create { tags: #hot-path }   // edges take tags and attrs too
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
- Parallel edges between the same pair are fine — give each a label.
- `~>` edges animate (dashes drift toward the target; still under
  `prefers-reduced-motion`). Opt out per edge: `{ animate: false }`, or pick a
  variant: `reverse` (acks flowing back), `slow`/`fast` (cadence), `packets`
  (discrete messages), `pulse` (a heartbeat — works on solid sync edges too).
  Sync edges take `style: dashed | dotted`, and a dashed sync edge may also
  animate:

  ```squinch
  probe  -> legacy "healthcheck" { animate: pulse }
  sensor ~> ingest "telemetry"   { animate: packets }
  mirror -> replica "sync" {
    style:   dashed
    animate: slow
  }
  ```

  One `animate:` value per edge. Don't decorate every edge — motion is for the
  hops where cadence or direction *means* something.
- `layout { }` blocks go inside a `view`, **never** inside a `system` —
  structure and layout stay separate. Same for `highlight`, `note`, `expand`.
- Zones (`zone id "Label" kind { contains a, b.c }`) mark deployment
  boundaries: kinds `account | region | vpc | subnet | network | cloud |
  onprem | custom`. Zones must nest cleanly or stay disjoint in any one view,
  and may not cut through an expanded container. A zone only appears where
  its members are visible. Optional attrs: `icon:` — **any** pack icon, e.g.
  `azure/vnet` or `logos/docker`; AWS also ships purpose-made group marks
  (`aws/cloud`, `aws/region`, `aws/account`, `aws/vpc`, `aws/private-subnet`,
  `aws/public-subnet`, `aws/corporate-data-center`) — `label: top-right`
  (corners: top-left default, top-right, bottom-left, bottom-right), and
  `color: ink` (theme roles only — account, network, cloud, neutral, ink,
  muted, accent; never hex).
- **A system you are not breaking down is a node, not an empty system.**
  `system partner "Partner System" external { }` gives you a card with nothing
  behind it and a zoom that goes nowhere; write `partner = box "Partner System"
  external` instead. `check` warns on any empty container.
- **Zones nest by sharing members, never by naming each other.** `contains`
  takes nodes only, so an outer boundary repeats the inner one's members:

  ```
  zone account "Azure Subscription" account { contains gw, aks, sql }
  zone vnet    "Virtual Network"    network { contains aks, sql }
  ```

  `aks` and `sql` are in both, so `vnet` draws inside `account`. Naming the
  inner zone — `contains gw, vnet` — is accepted as shorthand for exactly that:
  it expands to `vnet`'s own members. Sharing is still what the model records,
  so the two forms are indistinguishable in the render. Everywhere *else* a zone
  id is an error: you cannot draw an edge to a boundary.
- **A zone's `kind` already picks its colour**, so two nested zones of related
  kinds (say `network` inside `vpc`) come out nearly the same shade. Set
  `color:` on the inner one to tell them apart.
- **Rank hints don't reach inside a zone.** A zone is laid out as one block, so
  `rows`/`cols`/`place` order zones *relative to each other*, and ELK arranges
  the members within. Name the zone by its own id to rank it —
  `rows [gw] [prod_vpc]` puts the whole boundary below the gateway. Listing
  members of a single zone in `rows` does nothing, and `check` warns when it
  spots that. If the ranking matters more than the boundary, drop the zone.

## Views (altitudes)

Every system automatically gets a zoomable view. Declare views to customize or to
add lenses:

```squinch
view landscape {            // views take no positional label, unlike
  title "System Landscape"  // `system id "Label"` — the title is a statement.
                            // NOTE: `title` is *only drawn* inside a
                            // `titleblock` (below). On its own it names the
                            // view for tooling and nothing appears in the SVG.
  include *                 // all TOP-LEVEL entities, as collapsed cards
}

view shop {                 // name matching a system = that system's view
  scope shop                // implied by the name here; explicit for clarity
  only #pci                 // KEEP only these — the view's filter. `scope` says
                            // where you stand, `only` says which of it you keep.
                            // Takes ids too: `only api, vault`
  exclude legacy            // trim noise (removes the subtree)
  expand workers            // inline one child container in a frame
  detail ledger.post        // draw an outside node itself, not its system card
  highlight #pci            // spotlight matches, dim the rest — this still
                            // shows EVERYTHING. "only the PCI parts" is `only`;
                            // `highlight` is "the whole picture, PCI emphasised"
  show descriptions         // inline description lines under labels — these are
                            // clipped to the card width with an ellipsis and
                            // nothing warns you, so keep them to ~4 words
  note right-of db "Single-table design; see ADR-42"
  note top-right "Audit scope: Q3" { style: warning }
  context off               // drop the muted neighbour cards this view earned
                            // (default is `context auto`)
  legend auto               // footer key of the styles actually used
  titleblock {              // drafting-style corner block — this is what
                            // actually renders the view's `title`
    version: "2026-07"
    owner: team-orders
  }
}
```

Numbered flows badge a request's path over **edges that already exist** — a
flow annotates the model, it never creates connections. Every step must match
an edge you declared (steps count in declaration order; bare ids bind when
unambiguous, otherwise use full paths):

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

A step with no backing edge is a check error telling you to declare it first.
`flow` blocks live at the **top level**, beside your systems — not inside a
`system` and not inside a `view` (the view only says `show flow <id>`). From out
there, write steps as full paths (`shop.api -> shop.create`). A step may cross a
view's `scope`: an edge from a context card into the scope still gets its
number.

A flow is also a story: in the playground's **Present** mode the arrow keys walk
a `show flow` view one hop at a time, lighting the current edge and dimming what
the request hasn't reached. Nothing extra to author — declare the flow, and any
view that shows it can be walked.

Grouping vs. nesting: `include *` shows only *top-level* entities, so wrapping
several services in a parent `system` purely to group them collapses them into
one card at landscape altitude. If they should stay individually visible but
share a boundary, keep them top-level and group them with a `zone`.

Zoomed views automatically show outside neighbours as muted **context** cards —
don't add them yourself; if one appears that you don't want, `context off`.

## Layout hints (in a `layout { }` block inside a view)

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
```

- `rows` is the workhorse: one bracket group per horizontal band, listed top to
  bottom; order inside a bracket is left to right. Unlisted nodes place themselves.
- **Check each band against your arrows before you write them.** The bands are
  a claim about direction, and the engine enforces it.
- **Every edge must point down your bands.** `rows` declares the flow direction,
  so a node pointing back *up* it is a check error, not a nudge. This bites on
  monitoring, observability, feedback and retry paths — `mon -> api` under
  `rows [api] [svc] [db] [mon]` is refused. Two fixes, both fine: put the
  observer in the **same** band as what it watches (`rows [api mon] [svc] [db]`
  — equal ranks are legal and route side to side), or leave it out of `rows`
  and let the engine rank it. Only list a node when you care where it lands.
- `cols` is its transpose: one bracket group per vertical band, left to right.
  Members of a column share an exact axis, so a service and its database line
  up. `rows` and `cols` compose — they pin different axes, so using both gives
  you a full grid, and a cell is empty when nobody is placed in it.
- A node may be in a band **and** carry a `place`, so long as the two agree.
  `rows [db bus]` with `place bus right-of db` is fine — the band already reads
  left to right, and the `place` just says so again. What is refused is a
  `place` that puts the node somewhere the band does not: the wrong way round,
  a band away, or beside something no band mentions. `sync` is left out of the
  bands in the example above because it is simpler that way, not because it
  would be an error to list it.
- `place x right-of y` is the whole side-car idiom (stream processors, caches,
  DLQs). Do **not** add `route y ~> x from east to west` to it: `place` puts the
  two on the same row, and same-rank edges bypass the main router entirely —
  they route side to side automatically, straight when adjacent and under the
  band otherwise. A `from`/`to` on one is ignored, and now says so.

## Layout cookbook (symptom → fix)

| Symptom | Fix |
|---|---|
| Layers feel arbitrary / related things scattered | Add `rows`, one group per conceptual tier (entry, handlers, storage) |
| One node belongs beside another (stream sync, DLQ, cache) | `place X right-of Y` — that is all. The connecting edge routes itself; adding `route … from east to west` does nothing, because `place` makes them same-rank |
| "`route x -> y` sides are ignored — it is a same-rank edge" warning | Drop the `from`/`to`. Sides only apply to edges that span rows |
| "`x` is placed `right-of y`, but `rows` puts it somewhere else" error | The two hints disagree. Restating a band is fine — `rows [db bus]` alongside `place bus right-of db` is accepted, since both say the same thing — so fix whichever one is wrong, or drop `x` from the band |
| "`x` is listed in `rows` but is placed relative to `y`, which is not" error | Put `y` in a band too, or take `x` out of its band. A banded node can only be placed against another banded one |
| "cols `[a b c]` — all 3 sit on the same rank, so they cannot share an axis" warning | You wanted them side by side; that is `rows [a b c]`. `rows` is a **rank** — things drawn beside each other. `cols`/`align` stack a node onto another's axis *across* ranks. The confusion is worst with `direction right`, where a rank looks like a column on screen — the words describe the model, not the picture |
| "`x` appears in `rows` twice" error — likewise "appears in `cols` twice" | A node can hold only one rank position; remove one of the two occurrences |
| "`datastore` on `system s` — only `external` applies to a system" error | Only `external` describes a whole system. The other kinds describe one node: put it on a node inside, or drop it |
| "hint conflict: `a` → `b` runs upward — row 6 to row 4" error | Your bands contradict your arrows. `rows` runs top to bottom, so every edge must point down the list. Usually a monitor or feedback path: put it in the **same** band as what it points at (equal ranks are legal), or drop it from `rows` and let the engine rank it |
| "zones `a` and `b` contain exactly the same members" error | Two names for one boundary. Neither can sit inside the other, so merge them into a single `zone`, or narrow one's `contains` so it is genuinely a sub-boundary |
| "zones `a` and `b` partially overlap — visible zones must nest or stay disjoint" error | Boundaries must nest or stay apart, never half-lap. The fix line lists which members are shared and which are exclusive — either give the inner zone only members the outer one also has, or move the odd one out |
| "same-rank edge `a` → `b` crosses an expanded container or zone — layout quality may degrade" warning | The two ends were put on one row (usually by `place`) but the straight path between them runs through a boundary. Give one end its own band in `rows`, or drop the `expand` in this view |
| Several things all write to one store, crossing each other | `channel a, b, c -> db` — they merge into one trunk |
| "`x` connects to itself — a self-edge is not drawn" warning | Squinch draws connections between things, not loops on one thing. Put it on the node: `note right-of x "retries"`, or fold it into the label |
| "label is N characters — it will be cut off" warning | Labels wrap to two lines and then ellipsize, so the reader loses the tail. Keep it a short noun phrase and move the detail into `description:` |
| "view `v` has nothing to draw" warning | Everything got filtered out. Check `scope` (a leaf has no insides — scope a system, not a node), then `include`/`only`/`exclude`. An empty `system x { }` does this too: make it a node instead |
| "highlight #x: nothing visible here is tagged #x" warning | Everything would dim and nothing stand out. The tag is misspelled, or the things carrying it are not in this view — check the tag against your `tags:`, and the view's `include`/`only` |
| "channel into `x`" warning — including "has no room for a trunk" | The trunk needs the whole picture: every member edge visible in this view, at least two of them, and the sources sitting *above* the target. Check `rows`, and that nothing is `exclude`d |
| Edge exits a silly side | `route a -> b from south to north` (sides: north/south/east/west) |
| A wire jogs slightly instead of running straight | `align a b` — b takes a's axis exactly (a is the anchor) |
| Diagram too cramped / too airy | `density spacious` / `density compact` |
| Too many boxes at once | Split into views: a landscape with `include *`, plus per-system views |
| Show **only** one concern (an auditor's view: "only the PCI parts") | `only #pci`. Anything outside the scope that the survivors still talk to stays as a muted context card — that boundary crossing is usually the point of the view; `context off` drops those too |
| Emphasise one concern while keeping its context | `highlight #pci` — spotlights matches, dims the rest, shows everything |
| Narrow a view with `include #tag` | It does not narrow. `include` **adds**; an include that changes nothing warns and points at `only` |
| Show one specific node from another system, not its whole card | `detail ledger.post` |
| A neighbour system clutters a zoomed view | `exclude thatSystem` or `context off` |
| "N edges match route …" error | Add the edge's label to the `route` statement |
| "zone … cuts through expanded container" | The zone holds *some* children of a container you `expand`ed — contain the whole container, or drop the `expand` in that view |
| "zone … has no visible members" | Its members are inside collapsed cards at this altitude — `expand` one, scope the view to them, or contain the container itself |
| Need a VPC / network boundary / cloud-vs-on-prem split | `zone id "Label" vpc { contains a, b }` — kinds: account, region, vpc, subnet, network, cloud, onprem, custom |
| Icon unknown | `squinch icons search <term>`; the error's `did you mean` is usually right |
| Everything takes a long detour around the canvas | Check whether an edge points *against* the flow. Reversing one back-edge to face the direction traffic actually travels beats any hint |
| "rank hints on … have no effect" warning | Those nodes are all inside one zone, which lays out as a single block. Order the zones instead, or drop the boundary |
| "align skipped … outside zone" warning | The snap would have dragged a member out of its own boundary. Align it with something inside the zone |
| A numbered step's badge sits past its target node | The edge label is too wide for that run — shorten it, or the badge gets evicted and the reading order looks wrong |
| Not sure which views exist | `squinch check <path>` lists them (`--format json` puts them in `views`) |

## Icons you'll use constantly (aws pack)

When the request names a **specific product**, search for it — don't write the id
from memory. `check` only tells you an id exists, never that it's the one the
reader asked for, so a plausible-but-wrong mark passes silently and ships. The
confusable pairs are the ones to watch: CloudFront (`aws/cloudfront`, a CDN) is
not Cloudflare (`logos/cloudflare`, a different company); `aws/aurora` is not
`aws/rds`. One `squinch icons search cloudfront` settles it.

`lambda` · `dynamodb` · `s3` · `sqs` · `sns` · `api-gateway` · `opensearch` ·
`aurora` · `rds` · `elasticache` · `cloudfront` · `eventbridge` · `kinesis` ·
`step-functions` · `ecs` · `eks` · `fargate` · `ecr` · `athena` · `glue` ·
`redshift` · `sagemaker` · `bedrock` · `rekognition` · `cognito` ·
`secrets-manager` · `route-53` · `waf` · `elastic-load-balancing` (alias `elb`) ·
`batch` · `efs` · `app-runner`

Short aliases exist for the famous ones (`s3`, `sqs`, `sns`, `eks`, `ecs`, `ecr`,
`elb`, `glacier`, `opensearch`). When unsure: `squinch icons search <term>`.

**Azure** has its own pack (636 icons). Short forms exist for the ones everybody
abbreviates: `azure/aks` · `azure/vm` · `azure/vnet` · `azure/cosmos` ·
`azure/functions` · `azure/sql` · `azure/blob` · `azure/service-bus` ·
`azure/event-hub` · `azure/key-vault` · `azure/front-door` · `azure/app-gateway` ·
`azure/load-balancer` · `azure/aci` · `azure/acr` · `azure/api-management` ·
`azure/log-analytics` · `azure/redis`. Canonical ids read like the portal —
`azure/app-services`, `azure/storage-accounts`, `azure/monitor`,
`azure/application-insights`. Search the same way: `squinch icons search --pack azure <term>`.
Pick one cloud's pack and stay with it — don't draw the same concept as
`aws/…` in one box and `azure/…` in the next. Combining a cloud pack with
`logos` is a different thing and completely normal: it's how you draw a hybrid
estate, with `logos/postgres` on the on-prem side and `azure/sql` in the cloud.

**Kubernetes internals** come from the `k8s` pack (39 official community
icons — the blue heptagons from the k8s docs). Canonical ids are kubectl's
short names, and the long names alias to them, so both spellings check clean:
`k8s/pod` · `k8s/deploy` (`deployment`) · `k8s/svc` (`service`) · `k8s/sts`
(`statefulset`) · `k8s/ds` (`daemonset`) · `k8s/rs` (`replicaset`) · `k8s/cm`
(`configmap`) · `k8s/secret` · `k8s/ing` (`ingress`) · `k8s/ns` (`namespace`) ·
`k8s/sa` (`serviceaccount`) · `k8s/pv` · `k8s/pvc` · `k8s/sc` · `k8s/netpol` ·
`k8s/hpa` · `k8s/job` · `k8s/cronjob` · `k8s/crd` · `k8s/node` · `k8s/etcd` ·
`k8s/control-plane` · `k8s/api` (`apiserver`) · `k8s/sched` (`scheduler`) ·
`k8s/kubelet` · `k8s/k-proxy` (`kubeproxy`).
Use `k8s/*` when the diagram is about what runs *inside* a cluster; use
`logos/kubernetes` when the cluster is one box in a wider estate. A namespace
is a boundary, not a workload — prefer `zone team-a "team-a" custom { contains
…, icon: k8s/ns }` over a `k8s/ns` node. Composing with a cloud pack is normal:
`azure/aks` or `aws/eks` as the managed control plane, `k8s/*` for what it runs.

**Non-AWS things** come from the `logos` pack (124 product marks, plated in
their brand colour): `logos/postgres` · `logos/mysql` · `logos/mongodb` ·
`logos/redis` · `logos/kafka` · `logos/rabbitmq` · `logos/elasticsearch` ·
`logos/kubernetes` (`k8s`) · `logos/docker` · `logos/terraform` ·
`logos/nginx` · `logos/github` · `logos/gitlab` · `logos/grafana` ·
`logos/prometheus` · `logos/datadog` · `logos/sentry` · `logos/stripe` ·
`logos/snowflake` · `logos/cloudflare` · `logos/vercel` · `logos/nextdotjs` ·
`logos/react` · `logos/python` · `logos/nodedotjs` (`node`) · `logos/go` ·
`logos/rust` · `logos/graphql`. Search the same way: `squinch icons search kafka`.
Some brands (Slack, Twilio, Salesforce, Heroku, gRPC…) have no icon upstream —
they were withdrawn on trademark request. Use `box` for those.

`sys/*` is the generic set — 147 Lucide icons for anything no vendor draws, and
it needs no `pack` statement. Use it for on-prem and physical things, and as the
last resort when nothing else fits. Ids are Lucide's own names, so
`squinch icons search <word>` is the way to find one rather than guessing:

- **compute / app** — `server`, `container`, `cpu`, `code`, `app-window`,
  `hexagon`, `terminal`, `cog`, `webhook`, `workflow`, `route`
- **hardware** — `laptop`, `monitor`, `smartphone`, `hard-drive`, `printer`
- **network** — `network`, `router`, `wifi`, `radio-tower`, `globe`, `share-2`
- **security** — `lock`, `lock-keyhole`, `key-round`, `shield`, `shield-check`
- **data** — `database`, `folder`, `search`, `archive`, `table`, `file`
- **places** — `factory`, `warehouse`, `building-2`, `house`, `earth`
- **process / observability** — `clock`, `timer`, `repeat`, `activity`, `gauge`,
  `chart-line`, `siren`, `bug`
- **shapes, when nothing fits** — `box`, `circle`, `square`, `triangle`,
  `diamond`, `hexagon`, `star`

Short aliases exist for words you would type instead: `gear`→`cog`,
`cube`→`box`, `db`→`database`, `rack`/`vm`/`host`→`server`, `disk`→`hard-drive`,
`firewall`→`shield`, `vault`→`lock-keyhole`, `cron`→`clock`, `lb`→`share-2`.

## Platforms with no icon pack

Some vendors publish no icons anyone may redistribute, so no pack exists and none
ever will — Databricks, Snowflake, dbt and Confluent are the ones that come up.
Don't reach for a lookalike from another vendor and don't invent an id. Draw the
*concept* from `sys/*` and mark it with the vendor's mark from `logos/*`:

```squinch
wh = sys/database "SQL warehouse" { badge: logos/databricks }
```

Databricks, worked out — every base below is a real `sys/` id or alias:

| component | write |
| --- | --- |
| Delta table | `sys/table … { badge: logos/databricks }` |
| Unity Catalog | `sys/catalog` |
| SQL warehouse | `sys/database` |
| Vector search | `sys/waypoints` |
| Model serving | `sys/model` |
| MLflow experiment | `sys/experiment` |
| Notebook | `sys/notebook` |
| Workflows job | `sys/workflow` |
| Structured streaming | `sys/stream` |

The same recipe covers any vendor whose mark is in the logos pack —
`logos/snowflake` is there, dbt and Confluent are not. Run `squinch icons search
<vendor>` before writing a badge; if there's no mark, skip the badge and let the
label carry the vendor rather than substituting a lookalike. Badge only what the
platform actually owns: a Kafka or S3 node keeps its own icon, and that contrast
is what makes the platform boundary readable.

## Quality bar before you call it done

1. `squinch check` exits 0 with no diagnostics.
2. `squinch render` for **every view** you declared, both `--theme light` and
   `--theme dark`, succeeds.
3. Look at the SVG: tiers read top-to-bottom (or left-to-right), no edge takes a
   baffling detour, async flows (`~>`) are dashed, related things sit together.
4. Labels are short noun phrases; put detail in `description`, not the label.
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
