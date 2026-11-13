// The sheet: one container's structure before anything has a position —
// what each wire does here, the layers, and each wire's way through them.

import { axes, type Axes } from "./axes.js";
import type { Box, Chain, ChainLink, Group, Laid, Layer, Link, Pt, Route, Slot, Wire } from "./types.js";

export interface Sheet {
  gid: string; g: Group; ax: Axes;
  wires: readonly Wire[];
  links: Link[]; layers: Layer[]; chains: Chain[];
  slotOf(box: string): Slot;
  layerOf(s: Slot): number;
  /** Where a child container's own layout put this wire's wall port. */
  childPort(box: Box, wire: Wire): Pt | undefined;
  /** Is `box` the first (`low`) or last (`high`) box of its rank? */
  outermost(box: string, wall: "low" | "high"): boolean;
  /** A box's flow offset inside its rank: tops level beside a table or a
   *  container, centred otherwise. */
  inset(s: Slot): number;
}

/** What each wire does in container `gid`. */
function linksOf(gid: string, ax: Axes, wires: readonly Wire[], routes: ReadonlyMap<string, Route>): Link[] {
  const links: Link[] = [];
  for (const wire of wires) {
    const r = routes.get(wire.id);
    if (!r) continue;
    if (r.home === gid) {
      if (r.kind === "down") links.push({ wire, type: "chain", top: r.a, bottom: r.b, flipped: false, labelled: !!wire.label });
      else if (r.kind === "up") links.push({ wire, type: "chain", top: r.b, bottom: r.a, flipped: true, labelled: !!wire.label });
      else links.push({ wire, type: r.kind, a: r.a, b: r.b });
      continue;
    }
    // this container is on the way out from `from`, or on the way in to `to`
    const fi = r.fromChain.indexOf(gid), ti = r.toChain.indexOf(gid);
    if (fi < 0 && ti < 0) continue;
    const outward = fi >= 0;
    const child = outward ? r.fromChain[fi + 1] ?? wire.from : r.toChain[ti + 1] ?? wire.to;
    const wall = ax.role(outward ? r.sideFrom : r.sideTo);
    if (wall === "end") links.push({ wire, type: "chain", top: child, bottom: "wall", flipped: !outward, labelled: false });
    else if (wall === "start") links.push({ wire, type: "chain", top: "wall", bottom: child, flipped: outward, labelled: false });
    else links.push({ wire, type: "side", box: child, wall, outward });
  }
  return links;
}

export function draft(
  gid: string, g: Group, wires: readonly Wire[],
  routes: ReadonlyMap<string, Route>, ranks: ReadonlyMap<string, number>, laid: ReadonlyMap<string, Laid>,
  approach: ReadonlyMap<string, number> = new Map(),
): Sheet {
  const ax = axes(g);
  const links = linksOf(gid, ax, wires, routes);
  const chainLinks = links.filter((l): l is ChainLink => l.type === "chain");

  // ── layers: one per rank, one per labelled gap, one per used flow wall ────
  const rankCount = Math.max(0, ...g.boxes.map((b) => ranks.get(b.id)! + 1));
  const rankOf = (end: string | "wall", which: "top" | "bottom") =>
    end === "wall" ? (which === "top" ? -1 : rankCount) : ranks.get(end)!;
  /** Where a chain's label sits: half-way. That is a rank when it crosses an
   *  even number of gaps (the label stands in the row it passes through) and
   *  a gap of its own otherwise. */
  const labelSpot = (c: ChainLink): { rank: number } | { gap: number } => {
    const a = rankOf(c.top, "top"), b = rankOf(c.bottom, "bottom");
    return (b - a) % 2 === 0 ? { rank: (a + b) / 2 } : { gap: a + (b - a - 1) / 2 };
  };
  /** A bundle's wires share a trunk most of the way, so a label half-way
   *  would stand on the trunk and split it. Each carries its label on its
   *  own branch instead: the stub at the end that is its alone. */
  const stubEnd = (c: ChainLink): "top" | "bottom" | undefined => {
    if (!c.labelled || !c.wire.bundle || rankOf(c.bottom, "bottom") - rankOf(c.top, "top") < 2) return undefined;
    const sharesFrom = wires.every((w) => w.bundle !== c.wire.bundle || w.from === c.wire.from);
    return sharesFrom !== c.flipped ? "bottom" : "top";
  };
  const inLayers = (c: ChainLink) => c.labelled && !stubEnd(c);
  const labelled = new Set(chainLinks.filter(inLayers).map(labelSpot).flatMap((s) => ("gap" in s ? [s.gap] : [])));
  const layers: Layer[] = [];
  const layerOfRank = new Map<number, number>(), layerOfLabel = new Map<number, number>();
  const add = (kind: Layer["kind"]) => layers.push({ kind, slots: [], f: 0, depth: 0 }) - 1;
  if (chainLinks.some((c) => c.top === "wall")) layerOfRank.set(-1, add("wall"));
  for (let r = 0; r < rankCount; r++) {
    layerOfRank.set(r, add("rank"));
    if (labelled.has(r)) layerOfLabel.set(r, add("label"));
  }
  if (chainLinks.some((c) => c.bottom === "wall")) layerOfRank.set(rankCount, add("wall"));

  const boxSlot = new Map<string, Slot>();
  for (const b of g.boxes) {
    const s: Slot = { kind: "box", id: b.id, box: b, lsize: ax.lsize(b), fsize: ax.fsize(b), after: ax.down ? 0 : b.bleed ?? 0, pos: 0, pinned: true };
    boxSlot.set(b.id, s);
    layers[layerOfRank.get(ranks.get(b.id)!)!].slots.push(s);
  }

  // ── chains: a slot in every layer a wire crosses ──────────────────────────
  const shared = new Map<string, Slot>();
  const chains: Chain[] = chainLinks.map((c) => {
    const from = layerOfRank.get(rankOf(c.top, "top"))!, to = layerOfRank.get(rankOf(c.bottom, "bottom"))!;
    const spot = inLayers(c) ? labelSpot(c) : undefined;
    const labelAt = !spot ? undefined : "gap" in spot ? layerOfLabel.get(spot.gap) : layerOfRank.get(spot.rank);
    const path: Slot[] = [];
    for (let i = from; i <= to; i++) {
      const end = i === from ? c.top : i === to ? c.bottom : undefined;
      if (end !== undefined && end !== "wall") { path.push(boxSlot.get(end)!); continue; }
      const isLabel = i === labelAt;
      // a bundle goes through a rank as one wire
      const shareKey = c.wire.bundle && !isLabel ? `${c.wire.bundle}@${i}` : undefined;
      const sharedSlot = shareKey ? shared.get(shareKey) : undefined;
      if (sharedSlot) { path.push(sharedSlot); continue; }
      const s: Slot = {
        kind: end === "wall" ? "port" : "pass", id: c.wire.id, pos: 0, after: 0, label: isLabel,
        lsize: isLabel ? ax.labelL(c.wire) : 0, fsize: isLabel ? ax.labelF(c.wire) : 0,
      };
      if (shareKey) shared.set(shareKey, s);
      layers[i].slots.push(s);
      path.push(s);
    }
    return { wire: c.wire, path, first: from, flipped: c.flipped, stubLabel: stubEnd(c) };
  });

  // A container follows the flow: once the outside has said which lane each
  // wire arrives on, the ports of its start wall stand in that order and the
  // inside arranges itself to suit. (Its end wall stays the inside's to
  // order — the next container down follows it in turn.)
  const entry = layers[0];
  if (entry?.kind === "wall" && entry.slots.every((s) => approach.has(s.id))) {
    entry.slots.sort((a, b) => approach.get(a.id)! - approach.get(b.id)!);
    for (const s of entry.slots) s.pinned = true;
  }

  const layerIndex = new Map<Slot, number>();
  layers.forEach((layer, i) => layer.slots.forEach((s) => layerIndex.set(s, i)));
  const startAligned = (layer: Layer) => !ax.down || layer.slots.some((s) => s.box?.face !== undefined || s.box?.group);
  const tallest = (layer: Layer) => Math.max(0, ...layer.slots.map((s) => s.fsize));
  return {
    gid, g, ax, wires, links, layers, chains,
    slotOf: (box) => boxSlot.get(box)!,
    layerOf: (s) => layerIndex.get(s)!,
    childPort: (box, wire) => (box.group ? laid.get(box.id)!.wall.get(wire.id) : undefined),
    outermost: (box, wall) => {
      const row = layers[layerIndex.get(boxSlot.get(box)!)!].slots.filter((s) => s.kind === "box");
      return (wall === "low" ? row[0] : row[row.length - 1]).id === box;
    },
    inset: (s) => {
      const layer = layers[layerIndex.get(s)!];
      return startAligned(layer) ? 0 : Math.round((tallest(layer) - s.fsize) / 2);
    },
  };
}
