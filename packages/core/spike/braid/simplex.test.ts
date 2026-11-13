import { describe, it, expect } from "vitest";
import { feasible, solve, type Arc } from "./simplex.js";

describe("simplex", () => {
  it("finds the least weighted length on random constraint graphs", () => {
    let seed = 11;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let trial = 0; trial < 80; trial++) {
      const n = 4 + Math.floor(next() * 3);
      const arcs: Arc[] = [];
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++)
        if (next() < 0.5) arcs.push({ tail: i, head: j, min: Math.floor(next() * 3), weight: Math.floor(next() * 4) });
      const y = solve(n, arcs);
      for (const a of arcs) expect(y[a.head] - y[a.tail]).toBeGreaterThanOrEqual(a.min);
      const cost = (v: number[]) => arcs.reduce((s, a) => s + a.weight * (v[a.head] - v[a.tail]), 0);
      // exhaustive over a small box of integer assignments
      let best = Infinity;
      const v = new Array(n).fill(0);
      const walk = (i: number) => {
        if (i === n) { if (arcs.every((a) => v[a.head] - v[a.tail] >= a.min)) best = Math.min(best, cost(v)); return; }
        for (v[i] = 0; v[i] <= 2 * n; v[i]++) walk(i + 1);
      };
      if (n <= 5) { walk(0); expect(cost(y)).toBe(best); }
    }
  });
});

describe("simplex, by hand", () => {
  it("says so when the constraints contradict each other", () => {
    expect(feasible(2, [{ tail: 0, head: 1, min: 1, weight: 1 }, { tail: 1, head: 0, min: 1, weight: 1 }])).toBeUndefined();
  });
  it("pulls a heavier arc tight before a lighter one", () => {
    // 1 must be 10 above 0 or 10 below 2; the heavy arc wins
    const y = solve(3, [{ tail: 0, head: 1, min: 0, weight: 5 }, { tail: 1, head: 2, min: 0, weight: 1 }, { tail: 0, head: 2, min: 10, weight: 0 }]);
    expect([y[1] - y[0], y[2] - y[1]]).toEqual([0, 10]);
  });
  it("keeps answers on the grid its distances are on", () => {
    const y = solve(4, [{ tail: 0, head: 1, min: 16, weight: 1 }, { tail: 1, head: 2, min: 24, weight: 2 }, { tail: 0, head: 3, min: 8, weight: 1 }, { tail: 3, head: 2, min: 8, weight: 1 }]);
    for (const v of y) expect(v % 8).toBe(0);
  });
});
