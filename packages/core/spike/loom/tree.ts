// The tree: a Problem indexed — who holds whom, where each wire's two ends
// part company, each box's rank in its container, and which boxes no wire
// touches. Everything later reads this; nothing later changes it.

import { sideOf } from "./axes.js";
import { assignRanks, dense } from "./rank.js";
import type { Box, Group, Problem, Role, Route, Wire } from "./types.js";

export const ROOT = "";

/** A wire, seen from the container where its two ends part company. */
export interface Lifted {
  wire: Wire;
  home: string;                              // that container
  a: string; b: string;                      // its direct children holding `from` and `to`
  fromChain: string[]; toChain: string[];    // containers between each end and `home`, outermost first
}

export interface Tree {
  groups: ReadonlyMap<string, Group>;
  boxes: ReadonlyMap<string, Box>;
  /** Every container, a child always before its parent. */
  inner: readonly string[];
  /** The container holding a container; undefined for the root. */
  parent(id: string): string | undefined;
  lifted: readonly Lifted[];
  /** Wires not drawn: one end contains the other, or is not in the picture. */
  skipped: readonly string[];
  /** Rank of each box within its own container. */
  ranks: ReadonlyMap<string, number>;
  /** Boxes no wire touches, inside or out. */
  idle: ReadonlySet<string>;
  /** Each container's boxes as declared, before any reordering. */
  declared: ReadonlyMap<string, readonly Box[]>;
}

export function grow(problem: Problem): Tree {
  const groups = new Map<string, Group>([[ROOT, problem.root]]);
  const chainOf = new Map<string, string[]>(); // box → containers holding it, outermost first
  const boxes = new Map<string, Box>();
  const index = (g: Group, chain: string[]) => {
    for (const b of g.boxes) {
      boxes.set(b.id, b);
      chainOf.set(b.id, chain);
      if (b.group) { groups.set(b.id, b.group); index(b.group, [...chain, b.id]); }
    }
  };
  index(problem.root, [ROOT]);

  const lifted: Lifted[] = [], skipped: string[] = [];
  for (const wire of problem.wires) {
    const f = chainOf.get(wire.from), t = chainOf.get(wire.to);
    if (!f || !t) { skipped.push(wire.id); continue; }
    const fp = [...f, wire.from], tp = [...t, wire.to];
    let k = 0;
    while (k < fp.length && k < tp.length && fp[k] === tp[k]) k++;
    if (k >= fp.length || k >= tp.length) { skipped.push(wire.id); continue; }
    lifted.push({ wire, home: fp[k - 1], a: fp[k], b: tp[k], fromChain: fp.slice(k, -1), toChain: tp.slice(k, -1) });
  }

  const ranks = new Map<string, number>();
  for (const [id, g] of groups) {
    const edges = lifted.filter((l) => l.home === id).map((l) => [l.a, l.b] as [string, string]);
    for (const [box, r] of dense(assignRanks(g.boxes.map((b) => b.id), edges, g.pins))) ranks.set(box, r);
  }

  const wired = new Set(problem.wires.flatMap((w) => [w.from, w.to, ...(chainOf.get(w.from) ?? []), ...(chainOf.get(w.to) ?? [])]));
  return {
    groups, boxes, lifted, skipped, ranks,
    inner: [...groups.keys()].reverse(), // a child is indexed after its parent
    parent: (id) => (id === ROOT ? undefined : chainOf.get(id)![chainOf.get(id)!.length - 1]),
    idle: new Set([...boxes.keys()].filter((id) => !wired.has(id))),
    declared: new Map([...groups].map(([id, g]) => [id, [...g.boxes]])),
  };
}

/**
 * Which walls each wire uses where its ends part company, given the order
 * the boxes now stand in: down or up between ranks; across the gutter
 * between two neighbours on one rank; round whatever stands between two
 * that are not neighbours.
 */
export function routesOf(tree: Tree): Map<string, Route> {
  const routes = new Map<string, Route>();
  const at = new Map<string, number>();
  for (const g of tree.groups.values()) g.boxes.forEach((b, i) => at.set(b.id, i));
  for (const { wire, home, a, b, fromChain, toChain } of tree.lifted) {
    const g = tree.groups.get(home)!, side = (r: Role) => sideOf(g.dir, r);
    const ra = tree.ranks.get(a)!, rb = tree.ranks.get(b)!, ia = at.get(a)!, ib = at.get(b)!;
    const blocked = () => g.boxes.some((x, i) => i > Math.min(ia, ib) && i < Math.max(ia, ib) && tree.ranks.get(x.id) === ra);
    const walls: Pick<Route, "kind" | "sideFrom" | "sideTo"> =
      ra < rb ? { kind: "down", sideFrom: side("end"), sideTo: side("start") }
      : ra > rb ? { kind: "up", sideFrom: side("start"), sideTo: side("end") }
      : blocked() ? { kind: "around", sideFrom: side("end"), sideTo: side("end") }
      : ia < ib ? { kind: "beside", sideFrom: side("high"), sideTo: side("low") }
      : { kind: "beside", sideFrom: side("low"), sideTo: side("high") };
    routes.set(wire.id, { home, a, b, fromChain, toChain, ...walls });
  }
  return routes;
}
