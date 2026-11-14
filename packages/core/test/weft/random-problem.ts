// Seeded random `Problem`s — below the Squinch language, so they can use what
// the language does not reach yet: `room` beside leaves and the sides wires
// are asked to use, mixed with containers of either direction, pinned rows,
// labels, cards' sheets and upward wires. Deterministic: one LCG per seed.
import type { Box, Dir, Group, Problem, Side, Wire } from "../../src/layout/weft/contract.js";

const SIDES: Side[] = ["north", "south", "east", "west"];

export function randomProblem(seed: number, extensions = true): Problem {
  let s = seed * 9973 + 31;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = (n: number) => Math.floor(rnd() * n);
  const chance = (p: number) => rnd() < p;
  const dirOf = (): Dir => (chance(0.3) ? "right" : "down");

  const n = 3 + pick(12), groups = seed % 3 === 0 ? 1 + pick(3) : 0;
  const leaves: Box[] = Array.from({ length: n }, (_, i) => {
    const box: Box = { id: `n${i}`, w: 96 + 8 * pick(10), h: chance(0.15) ? 96 : 64 };
    if (chance(0.1)) box.bleed = 12;
    if (extensions && chance(0.3)) {
      box.room = {};
      for (let k = 1 + pick(2); k > 0; k--) box.room[SIDES[pick(4)]] = 16 + 8 * pick(14);
    }
    return box;
  });
  // the first `groups` containers take a contiguous share of the leaves each; the rest stand at the root
  const group = (boxes: Box[], dir: Dir, frame: boolean): Group => ({
    dir, boxes, pins: new Map(),
    pad: frame ? { top: 44, right: 16, bottom: 16, left: 16 } : { top: 32, right: 32, bottom: 32, left: 32 },
    gap: frame ? { lane: 32, rank: 40 } : { lane: 48, rank: 56 },
  });
  const top: Box[] = [];
  const share = groups ? Math.max(1, Math.floor(n / (groups + 1))) : n;
  for (let g = 0; g < groups; g++) {
    const inner = leaves.slice(g * share, (g + 1) * share);
    top.push({ id: `g${g}`, w: 0, h: 0, minW: 120, title: { w: 80, h: 34 }, group: group(inner, dirOf(), true) });
  }
  top.push(...leaves.slice(groups * share));
  const root = group(top, dirOf(), false);
  // now and then two neighbours are pinned to one rank, so wires between row-mates turn up
  if (chance(0.3) && root.boxes.length > 2) {
    const i = pick(root.boxes.length - 1);
    root.pins.set(root.boxes[i].id, 0); root.pins.set(root.boxes[i + 1].id, 0);
    root.held = [root.boxes[i].id, root.boxes[i + 1].id];
  }

  const wires: Wire[] = [];
  const seen = new Set<string>();
  const add = (from: number, to: number) => {
    if (from === to || seen.has(`${from}>${to}`)) return;
    seen.add(`${from}>${to}`);
    const wire: Wire = { id: `w${wires.length}`, from: `n${from}`, to: `n${to}` };
    if (chance(0.25)) wire.label = { w: 40 + 8 * pick(6), h: 18 };
    if (extensions && chance(0.25)) wire.fromSide = SIDES[pick(4)];
    if (extensions && chance(0.25)) wire.toSide = SIDES[pick(4)];
    wires.push(wire);
  };
  for (let i = 1; i < n; i++) for (let k = 1 + pick(2); k > 0; k--) add(pick(i), i);
  for (let k = Math.floor(n / 6); k > 0; k--) add(1 + pick(n - 1), pick(n - 1)); // a few against the flow
  // one time in eight, every wire out of one box is a bundle: a trunk with branches
  if (chance(0.125)) { const hub = `n${pick(n)}`; for (const w of wires) if (w.from === hub) w.bundle = "trunk"; }
  return { root, wires };
}
