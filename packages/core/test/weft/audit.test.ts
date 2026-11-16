// Random `Problem`s, below the language: boxes with room beside them, wires
// asked to use a side, containers of either direction, pinned rows, bundles,
// labels — every hard rule held on every one (`legal.ts`). Seeded, so a
// failure names the seed that reproduces it.
import { it, expect } from "vitest";
import { solve } from "../../src/layout/weft/engine.js";
import { audit } from "./legal.js";
import { randomProblem } from "./random-problem.js";

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
