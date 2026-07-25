# Squinch

> *squinch (n.) — the corner arch that lets a round dome sit on a square room; the
> piece of architecture that makes mismatched structures fit together.*

**Architecture diagrams as code, built for the age of AI agents.** A DSL that LLMs
write fluently and humans control precisely — with real layout and edge-routing
control, cloud icon packs, C4-style zooming, and deterministic rendering that lives
in git next to the code it describes.

## Status

🚧 **Pre-alpha — under active construction.** Nothing to install yet.

## What it will be

- **A `.squinch` DSL** — declare systems, containers, and connections once; views,
  themes, and layout hints live apart from structure, so diffs stay meaningful.
- **Deterministic rendering** — the same source produces byte-identical SVG in the
  browser, the CLI, and CI. Commit the render next to the source and let CI keep
  them honest, like a lockfile.
- **Three-tier layout control** — great auto-layout by default, relative placement
  hints (`rows`, `place right-of`) when you want them, edge routing (exit sides,
  channels) when you need it. Never pixel coordinates.
- **Zoom like C4** — one hierarchical model, altitude views derived automatically,
  edges aggregating cleanly at every level. Click a system to open it — even in a
  static committed SVG.
- **Icon packs & themes** — AWS icons first, first-party glyphs for high-level
  views, light/dark/sketch themes, animated data-flow edges.
- **Built for the agent loop** — a CLI and skill designed so a coding agent can
  write → check → render → inspect → fix, with error messages written to be acted on.

## Docs

- [DSL specification (v0 draft)](docs/SPEC.md)
- [Design language](docs/DESIGN.md)
- [Implementation plan](docs/PLAN.md)

## Acknowledgments

Squinch's model/view approach builds on the ideas of the
[C4 model](https://c4model.com) for visualizing software architecture.

## License

[Apache-2.0](LICENSE)
