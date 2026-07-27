<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.png">
    <img src="docs/assets/logo-light.png" alt="Squinch — AI-Native Architecture Diagrams" width="500">
  </picture>
</p>

# Squinch

> *squinch (n.) — the corner arch that lets a round dome sit on a square room; the
> piece of architecture that makes mismatched structures fit together.*

**Architecture diagrams as code, built for the age of AI agents.** A DSL that LLMs
write fluently and humans control precisely — with real layout and edge-routing
control, cloud icon packs, C4-style zooming, and deterministic rendering that lives
in git next to the code it describes.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/zoom-dark.gif">
    <img src="docs/assets/zoom-light.gif"
         alt="Clicking the Catalog Service card on a landscape of five systems opens it into its own internals — API, products table, search index and stream sync — with the gateway and order service left as muted context; clicking the breadcrumb closes it again."
         width="900">
  </picture>
  <br>
  <em>Click a system to go inside it. One model, two altitudes — the card
  doesn't magnify, it opens, and the neighbours it talks to stay on screen as
  context. The breadcrumb takes you back up.</em>
</p>

## From source to diagram

The whole file — structure first, then a separate `view` that says how to draw
it. Delete the `layout` block and it still renders well; the hints only steer.

```squinch
system orders "Order Service" {
  api    = aws/api-gateway "API Gateway"
  create = aws/lambda      "Create Handler"
  db     = aws/dynamodb    "Orders Table"
  sync   = aws/lambda      "Stream Sync"

  api -> create
  create -> db
  db ~> sync "DynamoDB stream"
}

view orders {
  layout {
    rows [api] [create] [db]
    place sync right-of db
    route db ~> sync from east to west     // control the edge, not just the graph
  }
}
```

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="examples/orders/orders.orders.dark.svg">
  <img alt="Order Service" src="examples/orders/orders.orders.light.svg">
</picture>

## Status

🚧 **Pre-alpha.** The engine works end to end — parser, model, layout, renderer,
CLI — but nothing is published yet. Build from source (below) if you want to play.

## Why

Auto-layout tools give you no recourse when the picture comes out wrong: add a node
and everything reshuffles, edges cross, and your only option is to accept it. Manual
tools give you control but an un-diffable file. Squinch takes the third path —
excellent auto-layout by default, plus *relative* hints (never pixel coordinates)
that both humans and LLMs can reason about:

- **`rows [api] [create get search]`** — pin ranks and their order
- **`place sync right-of db`** — relative placement, no geometry
- **`route db ~> sync from east to west`** — say which side an edge leaves from

## Deterministic by construction

The same source, packs, and theme always produce **byte-identical SVG** — text is
measured from a bundled metrics table, never from the environment. That makes a
lockfile workflow possible:

```bash
squinch render diagrams/ --sync    # write SVGs for every view × theme, refresh squinch.lock
squinch render diagrams/ --check   # CI gate: fail if a committed SVG is stale
```

Commit the source *and* the render. Reviewers see the picture in the diff; CI makes
sure it never drifts from the source. (Add `.github/actions/squinch-check` to your
workflow to enforce it.)

### One file that follows the reader's theme

Embedding a diagram somewhere you don't control the background — a docs site, a
wiki, an internal portal — usually means shipping two files and a `<picture>`.
`--adaptive` folds both palettes into one SVG and lets `prefers-color-scheme`
pick:

```bash
squinch render diagrams/ --view landscape --adaptive -o architecture.svg
```

The light theme stays in the presentation attributes and the dark one rides in a
`@media` block, so anything that ignores CSS — including the resvg rasterizer
behind PNG export — still draws the light theme correctly rather than nothing.
It costs about 1.5% over a single render, versus two whole files. Still no
script: a stylesheet is not code.

## C4-style zoom

One hierarchical model; altitudes are derived. Collapsed systems render as cards
with a preview of what is inside; zooming shows internals while neighbours collapse
into muted context cards, and cross-boundary edges re-anchor automatically —
aggregating with a count badge when several collapse into one.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="examples/microservices/microservices.landscape.dark.svg">
  <img alt="Microservices landscape" src="examples/microservices/microservices.landscape.light.svg">
</picture>

Zoom into the catalog service and its API, table, search index and stream sync
appear — with the gateway and order service reduced to context:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="examples/microservices/microservices.catalog.dark.svg">
  <img alt="Catalog service" src="examples/microservices/microservices.catalog.light.svg">
</picture>

Same model, no duplication — see [examples/microservices](examples/microservices).

## Try it from source

```bash
pnpm install && pnpm --filter @squinch/core build
node packages/cli/bin/squinch.js init my-diagrams
node packages/cli/bin/squinch.js render my-diagrams --sync
```

CLI: `check` (with `--format json` for agents), `render` (`--view`, `--theme`,
`--adaptive`, `-o`, `--sync`, `--check`), `icons search`, `init`, `watch`.

## Docs

- [DSL specification (v0 draft)](docs/SPEC.md)
- [Design language](docs/DESIGN.md)
- [Implementation plan](docs/PLAN.md)
- [Examples](examples/)

## Acknowledgments

Squinch's model/view approach builds on the ideas of the
[C4 model](https://c4model.com) for visualizing software architecture.

## License

[Apache-2.0](LICENSE)
