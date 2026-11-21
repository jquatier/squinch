// `Wire.tips` — something drawn on a wire's end where it meets a box (a
// relationship mark) — on random Problems. Each seed is solved twice: as it
// is, and with tips on about six in ten of its leaf-to-leaf wires. With tips
// on, the picture breaks no rule it did not break before, and no label
// stands on a tip.
//
// Measured over 4,000 seeds of each kind when this was written (12,000
// Problems, 77,669 tipped wires, 32,325 labels): 37 Problems with a broken
// rule against 35 without tips, and 3 labels on a tip against 8,135 that
// stand where a tip would be when the engine is not told of them. The three
// Problems newly broken (seeds 819 and 1316 with rooms and sides, 30
// arranged; one other is newly whole) are each a label under another wire on
// a wire asked to use a side — the engine's known weak spot
// (docs/notes/layout-engine.md §8), reached because a tipped port keeps a
// full 16 px from its neighbours and the label's old place is now a mark's.
// (Since a label's room is held firm where it was stepped into — `Sheet.firm`
// — 819 and 1316 are whole again; 30 remains, and is the one named below.)
import { it, expect } from "vitest";
import { solve } from "../../src/layout/weft/engine.js";
import { audit } from "./legal.js";
import { randomProblem } from "./random-problem.js";
import { onTips, withTips } from "./tips-audit.js";

for (const [name, extensions, arranged] of [["with rooms and asked sides", true, false], ["with neither", false, false], ["with aligned sets and columns", true, true]] as const)
  it(`300 random problems ${name}: tips break no rule and carry no label`, () => {
    const worse: string[] = [], on: string[] = [];
    let tipped = 0, before = 0;
    for (let seed = 0; seed < 300; seed++) {
      const base = randomProblem(seed, extensions, arranged), plain = solve(base);
      const p = withTips(randomProblem(seed, extensions, arranged), seed), s = solve(p);
      if (!audit(base, plain).length) for (const line of audit(p, s)) worse.push(`seed ${seed}: ${line}`);
      for (const line of onTips(p, s)) on.push(`seed ${seed}: ${line}`);
      tipped += p.wires.filter((w) => w.tips).length;
      before += onTips(p, plain).length;
      // a problem without tips is solved exactly as it was
      if (seed % 50 === 0) expect(JSON.stringify([...solve({ root: randomProblem(seed, extensions, arranged).root, wires: p.wires.map(({ tips: _t, ...w }) => w) }).wires])).toBe(JSON.stringify([...plain.wires]));
    }
    expect(tipped).toBeGreaterThan(1000);
    expect(before).toBeGreaterThan(100); // the audit can see what it is looking for
    // the one of the three above that falls in these 900
    expect(worse).toEqual(arranged ? ["seed 30: label of w19 lies on the wire w16"] : []);
    expect(on, on.join("\n")).toEqual([]);
  }, 120_000);
