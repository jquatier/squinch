import { describe, it, expect } from "vitest";
import { rankBoxes } from "./rank.js";
import { solve, type Arc } from "./simplex.js";

const ranks = (ids: string, edges: string[], pins: Record<string, number> = {}) =>
  Object.fromEntries(rankBoxes(ids.split(" "), edges.map((e) => e.split(">") as [string, string]), new Map(Object.entries(pins))));

describe("rank", () => {
  it("puts a target below its source", () => {
    expect(ranks("a b c", ["a>b", "b>c"])).toEqual({ a: 0, b: 1, c: 2 });
  });
  it("keeps a pinned band whole when an unlisted member sits between two band-mates", () => {
    expect(ranks("a k b", ["a>k", "k>b"], { a: 0, b: 0 })).toEqual({ a: 0, b: 0, k: 1 });
  });
  it("breaks a mutual pair once, first edge wins", () => {
    expect(ranks("a b", ["a>b", "b>a"])).toEqual({ a: 0, b: 1 });
  });
  it("lets two members joined by an edge share a pinned rank", () => {
    expect(ranks("a b", ["a>b"], { a: 0, b: 0 })).toEqual({ a: 0, b: 0 });
  });
  it("floats an unpinned feeder above a pinned target", () => {
    expect(ranks("ctx a b", ["ctx>a", "a>b"], { a: 0, b: 1 })).toEqual({ ctx: 0, a: 1, b: 2 });
  });
  it("drops a lone source to just above what it feeds", () => {
    expect(ranks("a b c mon", ["a>b", "b>c", "mon>c"])).toEqual({ a: 0, b: 1, mon: 1, c: 2 });
  });
  it("breaks a longer cycle at the wire declared last", () => {
    expect(ranks("a b c", ["a>b", "b>c", "c>a"])).toEqual({ a: 0, b: 1, c: 2 });
  });
  it("starts boxes tied to nothing at the top", () => {
    expect(ranks("a b lone", ["a>b"])).toEqual({ a: 0, b: 1, lone: 0 });
  });
});

describe("rank is the least total wire", () => {
  it("matches exhaustive search on small graphs", () => {
    let seed = 7;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const ids = ["a", "b", "c", "d", "e"];
    for (let trial = 0; trial < 60; trial++) {
      const edges: [string, string][] = [];
      for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) if (next() < 0.4) edges.push([ids[i], ids[j]]);
      const got = rankBoxes(ids, edges);
      const length = (r: (id: string) => number) => edges.reduce((a, [x, y]) => a + r(y) - r(x), 0);
      for (const [x, y] of edges) expect(got.get(y)!).toBeGreaterThan(got.get(x)!);
      let best = Infinity;
      const r = [0, 0, 0, 0, 0];
      const walk = (i: number) => {
        if (i === 5) {
          if (edges.every(([x, y]) => r[ids.indexOf(y)] > r[ids.indexOf(x)])) best = Math.min(best, length((id) => r[ids.indexOf(id)]));
          return;
        }
        for (r[i] = 0; r[i] < 5; r[i]++) walk(i + 1);
      };
      walk(0);
      expect(length((id) => got.get(id)!)).toBe(best);
    }
  });
});

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
