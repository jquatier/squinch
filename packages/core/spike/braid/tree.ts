// The picture as a tree, and each wire as a walk through it.
//
// Nothing here decides anything. It indexes the `Problem`: who holds whom,
// and for every wire the container where its two ends part company (its
// *home*) with the chain of boxes on either side that lead down from the
// home to the end itself. Every later stage reads wires through these
// walks, so "a wire between boxes in two different children counts as a wire
// between those children" is stated once, here.

import type { Box, Group, Problem, Wire } from "../contract.js";

export interface Node {
  id: string;
  /** Absent for the root, which is a group with no box around it. */
  box?: Box;
  group?: Group;
  parent?: Node;
  kids: Node[];
  /** Position among its siblings, as declared. */
  index: number;
}

export interface Walk {
  wire: Wire;
  /** Position in `problem.wires`: the order every tie is broken in. */
  index: number;
  home: Node;
  /** From the `from` box up to the home's child that holds it (last). */
  up: Node[];
  /** From the `to` box up to the home's child that holds it (last). */
  down: Node[];
}

export interface Tree {
  root: Node;
  nodes: Map<string, Node>;
  walks: Walk[];
  /** Wires not drawn: an end is missing, or one end holds the other. */
  skipped: string[];
  /** Boxes some wire ends at or inside. */
  wired: Set<Node>;
  /** Every container, each before the container that holds it. */
  inner: Node[];
}

export function grow(problem: Problem): Tree {
  const nodes = new Map<string, Node>();
  const root: Node = { id: "", group: problem.root, kids: [], index: 0 };
  const inner: Node[] = [];
  const fill = (n: Node) => {
    n.group!.boxes.forEach((box, index) => {
      const kid: Node = { id: box.id, box, group: box.group, parent: n, kids: [], index };
      nodes.set(box.id, kid);
      n.kids.push(kid);
      if (kid.group) fill(kid);
    });
    inner.push(n);
  };
  fill(root);

  const chain = (n: Node): Node[] => {
    const out: Node[] = [];
    for (let c: Node | undefined = n; c; c = c.parent) out.push(c);
    return out; // n … root
  };
  const walks: Walk[] = [], skipped: string[] = [];
  const wired = new Set<Node>();
  problem.wires.forEach((wire, index) => {
    const a = nodes.get(wire.from), b = nodes.get(wire.to);
    if (!a || !b || a === b) { skipped.push(wire.id); return; }
    const ca = chain(a), cb = chain(b);
    if (ca.includes(b) || cb.includes(a)) { skipped.push(wire.id); return; }
    // strip the shared tail: what is left on each side ends at a child of the home
    let i = ca.length - 1, j = cb.length - 1;
    while (ca[i] === cb[j]) { i--; j--; }
    const walk: Walk = { wire, index, home: ca[i + 1], up: ca.slice(0, i + 1), down: cb.slice(0, j + 1) };
    walks.push(walk);
    for (const n of [...walk.up, ...walk.down]) wired.add(n);
  });
  return { root, nodes, walks, skipped, wired, inner };
}
