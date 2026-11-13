// Order: every container's slots, for the whole picture at once.
//
// A container's wall ports are the one thing two containers share. Inside,
// their order decides which of its own wires cross; outside, the same order
// decides which wires cross on their way to it. So no container is ordered
// alone. Each is settled on its own first; then each again with what its
// wall ports cost the container outside counted in, outermost first and
// back, while the total falls; then each container nobody arranged is tried
// turned about. The best arrangement seen is the one kept.
//
// The search is small moves over an exact cost (`order-one.ts`), so a new
// move is a few lines here and is judged by the same number as the rest.

import type { SlotOrder } from "./order-one.js";
import type { Sheet } from "./sheet.js";

const ROUNDS = 2;

/** Orders every sheet in place; returns the cost left (whole crossings, and a fraction for straightness). */
export function orderAll(
  /** every container, a child before its parent */
  sheets: readonly Sheet[], parent: (id: string) => string | undefined, order: (id: string) => SlotOrder,
): number {
  const settle = (sh: Sheet) => {
    const up = parent(sh.gid);
    order(sh.gid).settle(up === undefined ? undefined : { now: () => order(up).cost(), settled: () => order(up).costSettled() });
  };
  const everything = () => {
    for (const sh of [...sheets].reverse()) settle(sh); // outermost first: each child against its settled surroundings
    for (const sh of sheets) settle(sh);                // and back: each container against its settled children
  };
  const cost = () => sheets.reduce((n, sh) => n + order(sh.gid).cost(), 0);
  const snapshot = () => sheets.map((sh) => sh.layers.map((l) => [...l.slots]));

  for (const sh of sheets) order(sh.gid).settle();
  let best = snapshot(), least = cost();
  const restore = () => sheets.forEach((sh, i) => sh.layers.forEach((l, k) => { l.slots = [...best[i][k]]; }));
  /** Keep what the last move made of the picture, or put it back. */
  const judge = (): boolean => {
    const now = cost();
    if (now < least) { best = snapshot(); least = now; return true; }
    restore();
    return false;
  };
  if (sheets.length < 2) return least;

  for (let round = 0; round < ROUNDS && least > 0; round++) {
    everything();
    if (!judge()) break;
  }
  // One move the sweeps cannot make a step at a time: a container turned
  // about, every row of it mirrored.
  for (const sh of sheets) {
    if (least < 1) break; // nothing crosses: not worth turning anything about
    if (parent(sh.gid) === undefined || sh.layers.some((l) => l.slots.some((s) => s.kind === "box" && !s.loose))) continue;
    for (const l of sh.layers) l.slots.reverse();
    // only what touches it needs to settle again: the containers inside it, itself, the one outside
    const near = sheets.filter((o) => o === sh || o.gid === parent(sh.gid) || parent(o.gid) === sh.gid);
    for (let twice = 0; twice < 2; twice++) for (const o of near) settle(o);
    judge();
  }
  return least;
}
