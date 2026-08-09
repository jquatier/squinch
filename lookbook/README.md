# Lookbook

Stress cases for the renderer, snapshot-locked (CI regenerates and diffs).
Regenerate with `npx tsx lookbook/build.ts`; eyeball every cell before
committing a visual change. What looks bad here becomes the next fix.

## 01-minimal

The smallest useful diagram: one system, a few components, and the connections between them. Everything else here builds on this shape.

Source: [`cases/01-minimal.squinch`](cases/01-minimal.squinch)

| light | dark |
|---|---|
| ![](out/01-minimal.tiny.light.svg) | ![](out/01-minimal.tiny.dark.svg) |

## 02-fan-out

One entry point feeding many handlers. Connections spread evenly along the edge of a node rather than stacking at a single point, so a wide fan stays readable.

Source: [`cases/02-fan-out.squinch`](cases/02-fan-out.squinch)

| light | dark |
|---|---|
| ![](out/02-fan-out.fan.light.svg) | ![](out/02-fan-out.fan.dark.svg) |

## 03-fan-in

The reverse shape: many producers all feeding one destination.

Source: [`cases/03-fan-in.squinch`](cases/03-fan-in.squinch)

| light | dark |
|---|---|
| ![](out/03-fan-in.fanin.light.svg) | ![](out/03-fan-in.fanin.dark.svg) |

## 04-deep-chain

A pipeline read left to right. Set `direction right` on a view and the stages run across the page instead of down it.

Source: [`cases/04-deep-chain.squinch`](cases/04-deep-chain.squinch)

| light | dark |
|---|---|
| ![](out/04-deep-chain.pipe.light.svg) | ![](out/04-deep-chain.pipe.dark.svg) |

## 05-long-labels

What happens when the names are long. Labels wrap, then trim with the full text kept for hover, and the small pills on connections step aside rather than overlapping each other.

Source: [`cases/05-long-labels.squinch`](cases/05-long-labels.squinch)

| light | dark |
|---|---|
| ![](out/05-long-labels.verbose.light.svg) | ![](out/05-long-labels.verbose.dark.svg) |

## 06-dense-mesh

Ten services that all talk to each other. Where wires have to cross, the crossing takes a small break so it can never be mistaken for a junction.

Source: [`cases/06-dense-mesh.squinch`](cases/06-dense-mesh.squinch)

| light | dark |
|---|---|
| ![](out/06-dense-mesh.mesh.light.svg) | ![](out/06-dense-mesh.mesh.dark.svg) |

## 07-nested-frames

Containers opened up inside a system with `expand`. Each level of nesting sits on a slightly different surface, so depth is visible without heavy borders.

Source: [`cases/07-nested-frames.squinch`](cases/07-nested-frames.squinch)

| light | dark |
|---|---|
| ![](out/07-nested-frames.platform.light.svg) | ![](out/07-nested-frames.platform.dark.svg) |

## 08-landscape

The top-level view of an estate: each system is a card, with the people and outside parties that touch it. A card carries a badge for what kind of thing it is and a preview of what is inside.

Source: [`cases/08-landscape.squinch`](cases/08-landscape.squinch)

| light | dark |
|---|---|
| ![](out/08-landscape.landscape.light.svg) | ![](out/08-landscape.landscape.dark.svg) |

## 09-coplanar-row

Connections between things on the same row. Neighbours join straight across; ones that reach past a node drop into a lane underneath so they never run through anything.

Source: [`cases/09-coplanar-row.squinch`](cases/09-coplanar-row.squinch)

| light | dark |
|---|---|
| ![](out/09-coplanar-row.row.light.svg) | ![](out/09-coplanar-row.row.dark.svg) |

## 10-highlight-notes

Annotation. `highlight` picks out everything carrying a tag and dims the rest, and `note` pins explanatory text to a node, a connection, or a corner of the diagram. Tag a connection itself and that wire lights up even when the things it joins stay dim.

Source: [`cases/10-highlight-notes.squinch`](cases/10-highlight-notes.squinch)

| light | dark |
|---|---|
| ![](out/10-highlight-notes.pci.light.svg) | ![](out/10-highlight-notes.pci.dark.svg) |

## 11-async-mesh

Asynchronous connections, written `~>`. They draw dashed and drift slowly towards their target, so an event-driven estate reads differently at a glance from a request-and-response one.

Source: [`cases/11-async-mesh.squinch`](cases/11-async-mesh.squinch)

| light | dark |
|---|---|
| ![](out/11-async-mesh.events.light.svg) | ![](out/11-async-mesh.events.dark.svg) |

## 12-lifted-aggregate

Zoomed out, several connections between the same two systems collapse into a single line with a count on it. Zoom in and the individual connections are still there.

Source: [`cases/12-lifted-aggregate.squinch`](cases/12-lifted-aggregate.squinch)

| light | dark |
|---|---|
| ![](out/12-lifted-aggregate.landscape.light.svg) | ![](out/12-lifted-aggregate.landscape.dark.svg) |

## 13-descriptions

`show descriptions` adds a line of explanatory text under every label.

Source: [`cases/13-descriptions.squinch`](cases/13-descriptions.squinch)

| light | dark |
|---|---|
| ![](out/13-descriptions.obs.light.svg) | ![](out/13-descriptions.obs.dark.svg) |

## 14-sidecar-routes

`place` puts one node beside another instead of below it — the shape you want for a cache, a stream processor or a dead-letter queue that belongs next to the thing it serves.

Source: [`cases/14-sidecar-routes.squinch`](cases/14-sidecar-routes.squinch)

| light | dark |
|---|---|
| ![](out/14-sidecar-routes.app.light.svg) | ![](out/14-sidecar-routes.app.dark.svg) |

## 15-densities

The same diagram at all three `density` settings, from compact to spacious.

Source: [`cases/15-densities.squinch`](cases/15-densities.squinch)

**`compact`**

| light | dark |
|---|---|
| ![](out/15-densities.compact.light.svg) | ![](out/15-densities.compact.dark.svg) |

**`comfortable`**

| light | dark |
|---|---|
| ![](out/15-densities.comfortable.light.svg) | ![](out/15-densities.comfortable.dark.svg) |

**`spacious`**

| light | dark |
|---|---|
| ![](out/15-densities.spacious.light.svg) | ![](out/15-densities.spacious.dark.svg) |

## 16-legend-titleblock

Footer furniture. `legend auto` explains the line styles the diagram actually uses and nothing else; `titleblock` adds a drafting-style corner block for version, owner and anything else worth stamping on a drawing.

Source: [`cases/16-legend-titleblock.squinch`](cases/16-legend-titleblock.squinch)

**`overview`**

| light | dark |
|---|---|
| ![](out/16-legend-titleblock.overview.light.svg) | ![](out/16-legend-titleblock.overview.dark.svg) |

**`pay`**

| light | dark |
|---|---|
| ![](out/16-legend-titleblock.pay.light.svg) | ![](out/16-legend-titleblock.pay.dark.svg) |

## 17-zones

`zone` draws a deployment boundary — a cloud, a VPC, an on-premises site — around whatever sits inside it. Boundaries cut across the ownership structure, and they nest.

Source: [`cases/17-zones.squinch`](cases/17-zones.squinch)

| light | dark |
|---|---|
| ![](out/17-zones.landscape.light.svg) | ![](out/17-zones.landscape.dark.svg) |

## 18-flows

`flow` numbers a path through the diagram, so you can show how one request actually travels. In the playground you can step through it a hop at a time.

Source: [`cases/18-flows.squinch`](cases/18-flows.squinch)

| light | dark |
|---|---|
| ![](out/18-flows.shop.light.svg) | ![](out/18-flows.shop.dark.svg) |

## 19-glyphs

The `sys` icon set: generic marks for servers, storage, networking and plain shapes, for the parts of a stack no vendor draws. Each one is shown twice, as a small badge on a card and at full size. A sample rather than the whole set.

Source: [`cases/19-glyphs.squinch`](cases/19-glyphs.squinch)

| light | dark |
|---|---|
| ![](out/19-glyphs.sheet.light.svg) | ![](out/19-glyphs.sheet.dark.svg) |

## 20-align-hops

`align` puts two nodes on exactly the same axis, for when the automatic layout leaves them a few pixels apart and the near-miss looks like a mistake.

Source: [`cases/20-align-hops.squinch`](cases/20-align-hops.squinch)

| light | dark |
|---|---|
| ![](out/20-align-hops.s.light.svg) | ![](out/20-align-hops.s.dark.svg) |

## 21-logos

The `logos` pack: marks for the frameworks, databases and tools that make up the half of a stack your cloud provider did not build.

Source: [`cases/21-logos.squinch`](cases/21-logos.squinch)

| light | dark |
|---|---|
| ![](out/21-logos.landscape.light.svg) | ![](out/21-logos.landscape.dark.svg) |

## 22-channel

`channel` merges several connections into one trunk where they all arrive at the same place, so a shared store is approached once instead of by a fan of near-parallel lines. The connections are still declared individually.

Source: [`cases/22-channel.squinch`](cases/22-channel.squinch)

**`plain`**

| light | dark |
|---|---|
| ![](out/22-channel.plain.light.svg) | ![](out/22-channel.plain.dark.svg) |

**`bussed`**

| light | dark |
|---|---|
| ![](out/22-channel.bussed.light.svg) | ![](out/22-channel.bussed.dark.svg) |

## 23-note-anchors

Every place a note can go: beside, above or below a node, attached to a connection, or pinned to one of the four corners of the diagram.

Source: [`cases/23-note-anchors.squinch`](cases/23-note-anchors.squinch)

| light | dark |
|---|---|
| ![](out/23-note-anchors.svc.light.svg) | ![](out/23-note-anchors.svc.dark.svg) |

## 24-arrow-kinds

The four kinds of connection — one-way, two-way, asynchronous, and undirected — and how each one is drawn.

Source: [`cases/24-arrow-kinds.squinch`](cases/24-arrow-kinds.squinch)

| light | dark |
|---|---|
| ![](out/24-arrow-kinds.mesh.light.svg) | ![](out/24-arrow-kinds.mesh.dark.svg) |

## 25-edge-routing

The `lines` setting, three ways over the same diagram: how an edge *travels*. `orthogonal` turns square corners, `curved` rounds them off, and `straight` runs point to point. How an edge is *drawn and moves* is the other axis — `style:` and `animate:`, case 29-edge-styles.

Source: [`cases/25-edge-routing.squinch`](cases/25-edge-routing.squinch)

**`orthogonal`**

| light | dark |
|---|---|
| ![](out/25-edge-routing.orthogonal.light.svg) | ![](out/25-edge-routing.orthogonal.dark.svg) |

**`curved`**

| light | dark |
|---|---|
| ![](out/25-edge-routing.curved.light.svg) | ![](out/25-edge-routing.curved.dark.svg) |

**`straight`**

| light | dark |
|---|---|
| ![](out/25-edge-routing.straight.light.svg) | ![](out/25-edge-routing.straight.dark.svg) |

## 26-route-label

`route` controls which side of a node a connection leaves and enters by. When two connections join the same pair of nodes, naming one of their labels picks the one you mean.

Source: [`cases/26-route-label.squinch`](cases/26-route-label.squinch)

| light | dark |
|---|---|
| ![](out/26-route-label.api.light.svg) | ![](out/26-route-label.api.dark.svg) |

## 27-k8s

The k8s pack: official community icons (the blue heptagons from the kubernetes docs), full-colour artwork like aws/azure — no plate, no tint. Canonical ids are kubectl's short names; the long forms alias to them, and this file deliberately uses both spellings so the case exercises the alias table. A namespace draws as a zone with `icon: k8s/ns`, not as a node.

Source: [`cases/27-k8s.squinch`](cases/27-k8s.squinch)

| light | dark |
|---|---|
| ![](out/27-k8s.cluster.light.svg) | ![](out/27-k8s.cluster.dark.svg) |

## 28-azure

The azure pack: Microsoft's official Architecture Icons — the gradient artwork is drawn raw like aws/k8s, no plate, no tint. Long marketing names alias to what people actually type (`azure/vnet`, `azure/aks`, `azure/cosmos`), and this file leans on those short forms. A virtual network draws as a zone with `icon: azure/vnet` — the chip inset that keeps full-bleed artwork off the pill border is exercised right here.

Source: [`cases/28-azure.squinch`](cases/28-azure.squinch)

| light | dark |
|---|---|
| ![](out/28-azure.storefront.light.svg) | ![](out/28-azure.storefront.dark.svg) |

## 29-edge-styles

How an edge is drawn and how it moves: `style: solid | dashed | dotted` and `animate: flow | reverse | slow | fast | packets | pulse | comet`, one hub with each spoke showing one thing. Dash travel needs a pattern, so a sync edge animates by declaring `style: dashed` first; `pulse` breathes and works on solid lines. `comet` is the exception: it rides a dot along the route rather than moving the stroke, so it needs no pattern and is the way to show motion on a plain synchronous call. How an edge *travels* between nodes is the other axis — `lines`, case 25-edge-routing.

Source: [`cases/29-edge-styles.squinch`](cases/29-edge-styles.squinch)

| light | dark |
|---|---|
| ![](out/29-edge-styles.styles.light.svg) | ![](out/29-edge-styles.styles.dark.svg) |

## 30-badges

`badge:` puts a vendor mark on a node's icon plate. It exists because some platforms publish no icon set anyone may redistribute — Databricks is the standing example — so there is no pack to install and never will be. Rather than ship someone's extracted artwork, compose two things we already have a licence to: a generic `sys/*` concept for *what the thing is*, and a CC0 brand mark for *whose it is*. The badge is what makes a wall of grey plates legible: every Databricks-owned box is marked, and the Kafka and S3 nodes keep their own icons, so the platform boundary reads at a glance.

Source: [`cases/30-badges.squinch`](cases/30-badges.squinch)

| light | dark |
|---|---|
| ![](out/30-badges.lakehouse.light.svg) | ![](out/30-badges.lakehouse.dark.svg) |
