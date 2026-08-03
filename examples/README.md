# Examples

Icons come from [@squinch/pack-aws](../packages/pack-aws) — Amazon's official
Architecture Icons, redistributed verbatim under CC-BY-ND 2.0.

Each subdirectory is a Squinch project. The `.svg` files are committed renders
kept in sync by CI (`squinch render <dir> --check`) — edit the `.squinch` source,
run `squinch render <dir> --sync`, and commit both.

- **orders/** — the canonical service (SPEC §10.1): API Gateway, three handlers,
  DynamoDB with a stream-driven OpenSearch sync. Exercises `rows`,
  `place right-of`, and `route … from east to west`.
- **products-api/** — the root README's hero: edge, a service inside a VPC zone,
  and a self-warming index. The smallest project here that shows zones.
- **storefront/** — C4-style altitudes (SPEC §10.2): a landscape of system cards,
  a zoomed service view with an aggregated edge and a context card, a `#pci`
  highlight view with notes, and a container frame via `expand`.
- **microservices/** — the zoom showcase, and the source of the animation at the
  top of the root README: a storefront, an edge gateway, and three services
  (catalog with OpenSearch, orders with an async fulfillment queue, accounts).
  The landscape shows service cards; each service view opens its internals while
  neighbours collapse to context cards; cross-service calls aggregate behind a
  count badge.

For deliberately awkward cases — dense meshes, long labels, deep nesting,
coplanar rows — see the [lookbook](../lookbook/) instead. These four are meant to
look like diagrams you would actually ship.
