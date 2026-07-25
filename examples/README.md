# Examples

Icons come from [@squinch/pack-aws](../packages/pack-aws) — Amazon's official
Architecture Icons, redistributed verbatim under CC-BY-ND 2.0.

Each subdirectory is a Squinch project. The `.svg` files are committed renders
kept in sync by CI (`squinch render <dir> --check`) — edit the `.squinch` source,
run `squinch render <dir> --sync`, and commit both.

- **orders/** — the canonical service: API Gateway, three handlers, DynamoDB with
  a stream-driven OpenSearch sync. Exercises `rows`, `place right-of`, and
  `route … from east to west`.
- **microservices/** — the zoom showcase: a storefront, an edge gateway, and three
  services (catalog with OpenSearch, orders with an async fulfillment queue,
  accounts). The landscape shows service cards; each service view opens its
  internals while neighbours collapse to context cards; cross-service calls
  aggregate with a count badge.
- **landscape/** — C4-style altitudes: a landscape of system cards, a zoomed
  service view with an aggregated edge and a context card, a `#pci` highlight
  view with notes, and a container frame via `expand`.
