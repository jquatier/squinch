// Random `Problem`s, below the language: boxes with room beside them, wires
// asked to use a side, containers of either direction, pinned rows, bundles,
// labels — every hard rule held on every one (`legal.ts`). Seeded, so a
// failure names the seed that reproduces it.
import { it, expect } from "vitest";
import { solve } from "../../src/layout/weft/engine.js";
import { audit } from "./legal.js";
import { nestedProblem, randomProblem } from "./random-problem.js";
import { randomDiagram } from "./random.js";
import { draw } from "./sets.js";

for (const [name, n, extensions, arranged] of [["with rooms and asked sides", 400, true, false], ["with neither", 150, false, false], ["with aligned sets and columns that may contradict", 400, true, true]] as const)
  it(`${n} random problems ${name} are legal`, () => {
    const bad: string[] = [];
    let hinted = 0, unhonoured = 0;
    for (let seed = 0; seed < n; seed++) {
      const p = randomProblem(seed, extensions, arranged), s = solve(p);
      for (const line of audit(p, s)) bad.push(`seed ${seed}: ${line}`);
      hinted += p.wires.filter((w) => w.fromSide || w.toSide).length;
      unhonoured += s.unhonoured?.length ?? 0;
      // pure: the same problem solves to the same thing
      if (seed % 50 === 0) expect(JSON.stringify([...solve(randomProblem(seed, extensions, arranged)).wires])).toBe(JSON.stringify([...s.wires]));
    }
    expect(bad.slice(0, 20)).toEqual([]);
    if (extensions) expect(unhonoured).toBeLessThan(hinted / 10); // the fallback is the exception
    else expect(unhonoured).toBe(0);
  }, 120_000);

// A label given room on its wire's line was still crossed where a lane, to
// close a short jog, stepped into that room (`shift` in lay.ts). The sheet
// then holds its rooms firm and is laid out once more (`Sheet.firm`). These
// are the seeds, one of each kind, that have a label under another wire
// without it — outside the ranges above, so they are named.
it("a label given room is not stepped into: the seeds that need the room held firm", () => {
  for (const [seed, extensions, arranged] of [[408, true, false], [1145, false, false], [747, true, true]] as const) {
    const p = randomProblem(seed, extensions, arranged);
    expect(audit(p, solve(p)), `seed ${seed}`).toEqual([]);
  }
});

// A side wall shared by hooks and straight wires found two ways to lay one
// wire along another, both outside the ranges above. 711: a channel whose
// wires could neither step aside nor step twice has an order that keeps every
// stub off every other, which the greedy stacking missed (`stack(…, true)`).
// 1041: a wire stepping in a gutter stood on the lane of a hook on the same
// wall, and now steps beyond it (`Crossing.after`, `before`).
it("wires that share a side wall with hooks are not drawn along one line: the seeds that were", () => {
  for (const seed of [711, 1041]) {
    const p = randomProblem(seed, true, false);
    expect(audit(p, solve(p)), `seed ${seed}`).toEqual([]);
  }
});

// Two wires that could step neither aside nor twice on a line of their own,
// and that no order of the tracks keeps apart: one of them steps twice at
// the middle of its run all the same (lay.ts). Seen once in 3,000 random
// diagrams, with no side asked — beyond the 80 the quality gate draws.
it("a channel with no free line and no clean order still lays no wire along another: random-381", async () => {
  for (const d of await draw({ name: "random-381", src: randomDiagram(381) })) expect(d.illegal, d.view).toEqual([]);
});

// Two wires that run to a container's side wall under (or over) a row-mate
// stand on that wall in the order the box's wall gives them, so where they
// leave the box is chosen in the order the wall outside has them
// (`sideEnd`, lay.ts). Two of the four nested seeds that drew two wires
// along one line were that.
it("wires under a row-mate to a container's side wall leave their box in the order the wall outside has them: the nested seeds that did not", () => {
  for (const seed of [1841, 2271]) {
    const p = nestedProblem(seed);
    expect(audit(p, solve(p)), `seed ${seed}`).toEqual([]);
  }
});

// A wire that ends at a container's side wall is placed in whole steps out
// from the middle of it (`lay.ts`). Searched on the 8 px grid, such a wire
// stood half a step off the line of one through the same wall, and the two
// were drawn along one line outside.
it("wires that end at a container's side wall stand a whole step off the others: the nested seeds that did not", () => {
  for (const seed of [2313, 2385]) {
    const p = nestedProblem(seed);
    expect(audit(p, solve(p)), `seed ${seed}`).toEqual([]);
  }
});

// Two containers side by side, joined by wires straight across the gap:
// both insides order their facing walls by the order those wires are
// declared in out there (`comesAt`), so the two walls agree.
it("two containers side by side put the wires across the gap between them in one order: the nested seed that did not", () => {
  const p = nestedProblem(1605);
  expect(audit(p, solve(p))).toEqual([]);
});

// What `randomProblem` never makes: a container inside a container, sometimes
// of the other direction, and wires that end at a container (`nestedProblem`).
// The rule for a side asked is held on all of it: the box the wire names is
// given that wall or the end is reported, and nothing reported was given.
// Two older weaknesses show at this depth with or without sides asked
// (docs/notes/layout-engine.md §8). A label under another wire may not grow.
// Two wires along one line between fixed ends 16 px apart no longer shows in
// these 600 — two of the 2,400 seeds after them still have it — and may not
// come back.
it("600 random problems nested two deep, with wires that end at containers: every side asked is given or reported", () => {
  const sides: string[] = [], along: string[] = [], labels: string[] = [], other: string[] = [];
  for (let seed = 0; seed < 600; seed++) {
    const p = nestedProblem(seed);
    for (const line of audit(p, solve(p)))
      (/asked|refused|unhonoured/.test(line) ? sides : /along one line/.test(line) ? along : /lies on the wire/.test(line) ? labels : other).push(`seed ${seed}: ${line}`);
  }
  expect(sides).toEqual([]);
  expect(other).toEqual([]);
  expect(along).toEqual([]);
  expect(labels.length, labels.join("\n")).toBeLessThanOrEqual(7);
}, 120_000);
