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

1. Write the model first, with no `layout` block. Render it.
2. Only if the picture needs it, add hints (`rows`, `place`, `route`) one at a time.
3. `check` after every edit. Diagnostics tell you the location, the problem, and
   usually the fix (`did you mean ...?`). Trust them.
4. Exit code 0 and no diagnostics = clean. Warnings deserve a look; errors block render.

## Language

```squinch
// comments are // only (# belongs to tags)
pack aws                              // enable a vendor icon pack (aws | azure |
pack azure                            //  logos — declare each one you use).
                                      //  `sys` and `builtin` need no declaration.

person customer "Customer"            // human actor
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
  db     = aws/dynamodb    "Orders Table"
  legacy = box             "Old Billing" external   // `box` = no icon
  // kinds: `external` (not ours — someone else's system), `datastore` (holds
  // state), `person` (a human actor). They are semantic, and themes style them.

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
  `prefers-reduced-motion`). Opt out per edge: `{ animate: false }`.
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
- **A zone's `kind` already picks its colour**, so two nested zones of related
  kinds (say `network` inside `vpc`) come out nearly the same shade. Set
  `color:` on the inner one to tell them apart.
- **Rank hints don't reach inside a zone.** A zone is laid out as one block, so
  `rows`/`cols`/`place` order zones *relative to each other*, and ELK arranges
  the members within. Listing members of a single zone in `rows` does nothing —
  `check` warns when it spots this. If the ranking matters more than the
  boundary, drop the zone.

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
  exclude legacy            // trim noise (removes the subtree)
  expand workers            // inline one child container in a frame
  highlight #pci            // spotlight matches, dim everything else
  show descriptions         // inline description lines under labels — these are
                            // clipped to the card width with an ellipsis and
                            // nothing warns you, so keep them to ~4 words
  note right-of db "Single-table design; see ADR-42"
  note top-right "Audit scope: Q3" { style: warning }
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
    route db ~> sync from east to west              // which side an edge exits/enters
    route api -> db "write" from south              // label disambiguates parallels
  }
}
```

- `rows` is the workhorse: one bracket group per horizontal band, listed top to
  bottom; order inside a bracket is left to right. Unlisted nodes place themselves.
- `cols` is its transpose: one bracket group per vertical band, left to right.
  Members of a column share an exact axis, so a service and its database line
  up. `rows` and `cols` compose — they pin different axes, so using both gives
  you a full grid, and a cell is empty when nobody is placed in it.
- A node goes in `rows`/`cols` **or** gets a `place` — never both, in any
  direction. That is why `sync` is missing from the bands in the example above:
  a placed node is positioned relative to its target, so listing it in a band as
  well is a check-time error. Naming every node in `rows` is the natural move
  when a request asks for tiers, and it is the one that collides with this.
- Edges between two nodes in the same row route automatically (straight when
  adjacent, under the band otherwise). `place x right-of y` + `route y ~> x from
  east to west` is the idiom for a side-car (stream processors, caches, DLQs).

## Layout cookbook (symptom → fix)

| Symptom | Fix |
|---|---|
| Layers feel arbitrary / related things scattered | Add `rows`, one group per conceptual tier (entry, handlers, storage) |
| One node belongs beside another (stream sync, DLQ, cache) | `place X right-of Y` and route the connecting edge `from east to west` |
| "`x` is placed via `place` but also listed in `rows`" error | Drop `x` from the `rows` band and keep the `place` — a placed node is positioned relative to its target, so it must not be listed in a band as well |
| "`x` appears in `rows` twice" error | A node can hold only one rank position; remove one of the two occurrences |
| Several things all write to one store, crossing each other | `channel a, b, c -> db` — they merge into one trunk |
| Edge exits a silly side | `route a -> b from south to north` (sides: north/south/east/west) |
| A wire jogs slightly instead of running straight | `align a b` — b takes a's axis exactly (a is the anchor) |
| Diagram too cramped / too airy | `density spacious` / `density compact` |
| Too many boxes at once | Split into views: a landscape with `include *`, plus per-system views |
| Show only one concern (PCI, GDPR, a team) | `highlight #pci` — spotlights matches, dims the rest. `include` **adds** to a view and cannot narrow one; to actually remove things use `exclude #tag` or `exclude <id>` |
| A neighbour system clutters a zoomed view | `exclude thatSystem` or `context off` |
| "hint conflict … runs upward" error | Your `rows` contradict an edge's direction — move the target to a lower row |
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

## Quality bar before you call it done

1. `squinch check` exits 0 with no diagnostics.
2. `squinch render` for **every view** you declared, both `--theme light` and
   `--theme dark`, succeeds.
3. Look at the SVG: tiers read top-to-bottom (or left-to-right), no edge takes a
   baffling detour, async flows (`~>`) are dashed, related things sit together.
4. Labels are short noun phrases; put detail in `description`, not the label.
5. Model semantics honestly: async/queued flows use `~>`, request/response uses `->`.
