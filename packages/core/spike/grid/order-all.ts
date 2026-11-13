// Order the whole picture: every container's slots, together.
//
// A container's wall ports are the one thing two containers share. Inside,
// their order decides which of its own wires cross; outside, the same order
// decides which wires cross on their way to it. Ordered one container at a
// time, innermost first, the inside always wins and the outside lives with
// it. Here every container is ordered on its own first; then each in turn
// is ordered again with what its wall ports cost the container outside
// counted in, down the tree and back up, for as long as the picture as a
// whole crosses less. The best arrangement seen is the one kept.

import type { Sheet } from "./sheet.js";
import type { SlotOrder } from "./order-slots.js";

const ROUNDS = 2;

export function orderAll(
  /** every container, innermost first */
  sheets: readonly Sheet[], parent: (id: string) => string | undefined, order: (id: string) => SlotOrder,
): void {
  const settle = (sh: Sheet) => {
    const up = parent(sh.gid);
    order(sh.gid).settle(up === undefined ? undefined : () => order(up).cost());
  };
  const cost = () => sheets.reduce((n, sh) => n + order(sh.gid).cost(), 0);
  const snapshot = () => sheets.map((sh) => sh.layers.map((l) => [...l.slots]));

  for (const sh of sheets) order(sh.gid).settle();
  if (sheets.length < 2) return;
  let best = snapshot(), least = cost();
  for (let round = 0; round < ROUNDS && least > 0; round++) {
    for (const sh of [...sheets].reverse()) settle(sh); // outermost first: each child against its settled surroundings
    for (const sh of sheets) settle(sh);                // and back: each container against its settled children
    const now = cost();
    if (now >= least) break;
    best = snapshot(); least = now;
  }
  const restore = () => sheets.forEach((sh, i) => sh.layers.forEach((l, k) => { l.slots = [...best[i][k]]; }));
  restore();

  // One move the sweeps cannot make a step at a time: a container turned
  // about, every row of it mirrored. Where nobody placed its boxes, try it,
  // let everything settle round it, and keep it if the picture crosses less.
  for (const sh of sheets) {
    if (least === 0) break;
    if (parent(sh.gid) === undefined || sh.layers.some((l) => l.slots.some((s) => s.kind === "box" && !s.loose))) continue;
    for (const l of sh.layers) l.slots.reverse();
    for (const other of [...sheets].reverse()) settle(other);
    for (const other of sheets) settle(other);
    const now = cost();
    if (now < least) { best = snapshot(); least = now; } else restore();
  }
}
