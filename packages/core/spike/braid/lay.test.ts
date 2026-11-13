import { describe, it, expect } from "vitest";
import { solve } from "./engine.js";
import { frame, leaf, pin, problem } from "./fixtures.js";

describe("lay", () => {
  it("stands a label in the middle of its gap, which stays as deep as stated when the label fits", () => {
    const plain = solve(problem([leaf("a"), leaf("b")], ["a>b"])), labelled = solve(problem([leaf("a"), leaf("b")], ["a>b:60"]));
    expect(labelled.boxes.get("b")).toEqual(plain.boxes.get("b"));
    const l = labelled.wires.get("a>b")!.label!, a = labelled.boxes.get("a")!, b = labelled.boxes.get("b")!;
    expect(l.y - (a.y + a.h)).toBe(b.y - (l.y + l.h));
  });
  it("deepens a channel for the wires that turn in it, a track apiece, 16 apart", () => {
    const kids = ["b", "c", "d", "e", "f", "g"];
    const s = solve(problem([leaf("a", 64), ...kids.map((k) => leaf(k, 64))], [...kids.map((k) => `a>${k}`)], { held: kids }));
    const gap = s.boxes.get("b")!.y - (s.boxes.get("a")!.y + 64);
    expect(gap).toBeGreaterThanOrEqual(56);
    for (const w of s.wires.values()) if (w.points.length > 2) {
      expect(w.points[1].y - w.points[0].y).toBeGreaterThanOrEqual(16);
      expect(w.points[3].y - w.points[2].y).toBeGreaterThanOrEqual(16);
    }
  });
  it("top-aligns a rank that holds a container, and centres one that does not", () => {
    const mixed = solve(problem([leaf("a"), frame("s", [leaf("s.x"), leaf("s.y")]), leaf("z")], ["a>z", "s.x>s.y"], pin({ a: 0, s: 0, z: 1 })));
    expect(mixed.boxes.get("a")!.y).toBe(mixed.boxes.get("s")!.y);
    const plain = solve(problem([leaf("a", 120, 64), leaf("b", 120, 96)], [], pin({ a: 0, b: 0 })));
    expect(plain.boxes.get("a")!.y - plain.boxes.get("b")!.y).toBe(16);
  });
  it("keeps clear of what hangs below a box", () => {
    const card = { ...leaf("card"), bleed: 12 };
    const s = solve(problem([leaf("a"), card, leaf("b")], ["a>b"], { ...pin({ card: 0, a: 0, b: 0 }), held: ["a", "card", "b"] }));
    const turn = s.wires.get("a>b")!.points[1].y, c = s.boxes.get("card")!;
    expect(turn).toBeGreaterThanOrEqual(c.y + c.h + 12 + 16);
  });
  it("turns a wire that has to turn just inside a titled container below the title", () => {
    const sys = frame("sys", [leaf("sys.x")], {}, { title: { w: 150, h: 34 }, minW: 400 });
    // two wires into one box: they cannot both stand over it and clear of the title
    const s = solve(problem([leaf("a"), leaf("b"), sys], ["a>sys.x", "b>sys.x"]));
    const box = s.boxes.get("sys")!;
    for (const w of s.wires.values())
      for (let i = 0; i + 1 < w.points.length; i++) {
        const p = w.points[i], q = w.points[i + 1];
        const crossesTitle = Math.min(p.x, q.x) < box.x + 150 && Math.max(p.x, q.x) > box.x && p.y === q.y && p.y > box.y && p.y < box.y + 34;
        expect(crossesTitle).toBe(false);
      }
  });
  it("draws wires across one gutter level, each at its own height", () => {
    const s = solve(problem([leaf("a"), leaf("b")], ["a>b", "b>a"], pin({ a: 0, b: 0 })));
    const [p, q] = [s.wires.get("a>b")!.points, s.wires.get("b>a")!.points];
    expect(p).toHaveLength(2); expect(q).toHaveLength(2);
    expect(Math.abs(p[0].y - q[0].y)).toBeGreaterThanOrEqual(16);
  });
  it("puts labels across one gutter in columns, each on its own wire", () => {
    const s = solve(problem([leaf("a"), leaf("b")], ["a>b:60", "b>a:60"], pin({ a: 0, b: 0 })));
    const l1 = s.wires.get("a>b")!.label!, l2 = s.wires.get("b>a")!.label!;
    expect(l1.x + l1.w <= l2.x || l2.x + l2.w <= l1.x).toBe(true);
    expect(s.boxes.get("b")!.x - (s.boxes.get("a")!.x + 120)).toBeGreaterThanOrEqual(60 + 60 + 16);
  });
});
