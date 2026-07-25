# Squinch

> *squinch (n.) — the corner arch that lets a round dome sit on a square room; the
> piece of architecture that makes mismatched structures fit together.*

**Architecture diagrams as code, built for the age of AI agents.** A DSL that LLMs
write fluently and humans control precisely — with real layout and edge-routing
control, cloud icon packs, C4-style zooming, and deterministic rendering that lives
in git next to the code it describes.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="examples/orders/orders.orders.dark.svg">
  <img alt="Order Service" src="examples/orders/orders.orders.light.svg">
</picture>

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

## C4-style zoom

One hierarchical model; altitudes are derived. Collapsed systems render as cards
with a preview of what's inside; zooming shows internals and cross-boundary edges
re-anchor automatically, aggregating with a count badge when several collapse into
one. See [examples/landscape](examples/landscape) for all four altitudes of the same
model.

## Try it from source

```bash
pnpm install && pnpm --filter @squinch/core build
node packages/cli/bin/squinch.js init my-diagrams
node packages/cli/bin/squinch.js render my-diagrams --sync
```

CLI: `check` (with `--format json` for agents), `render` (`--view`, `--theme`, `-o`,
`--sync`, `--check`), `icons search`, `init`, `watch`.

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
