import { describe, it, expect } from "vitest";
import { solve } from "./engine.js";
import { leaf, pin, problem } from "./fixtures.js";

const ends = (s: ReturnType<typeof solve>, id: string) => { const p = s.wires.get(id)!.points; return [p[0], p[p.length - 1]]; };
const mid = (s: ReturnType<typeof solve>, id: string) => s.boxes.get(id)!.x + s.boxes.get(id)!.w / 2;

describe("ports", () => {
  it("meets a wall's only wire in the middle", () => {
    const s = solve(problem([leaf("a", 200), leaf("b")], ["a>b"]));
    expect(ends(s, "a>b").map((p) => p.x)).toEqual([mid(s, "a"), mid(s, "b")]);
  });
  it("orders a wall's ports so that its own wires do not cross", () => {
    const s = solve(problem([leaf("a"), leaf("l"), leaf("m"), leaf("r")], ["a>r", "a>l", "a>m"], { held: ["l", "m", "r"] }));
    const x = (id: string) => ends(s, id)[0].x;
    expect(x("a>l")).toBeLessThan(x("a>m"));
    expect(x("a>m")).toBeLessThan(x("a>r"));
  });
  it("slides a port along its wall to meet a wire that can then run straight", () => {
    const s = solve(problem([leaf("a", 320), leaf("b"), leaf("c")], ["a>b", "a>c"]));
    for (const id of ["a>b", "a>c"]) expect(s.wires.get(id)!.points).toHaveLength(2);
  });
  it("keeps ports 16 apart and 8 from the corners", () => {
    const kids = ["b", "c", "d", "e", "f"];
    const s = solve(problem([leaf("a", 120), ...kids.map((k) => leaf(k))], kids.map((k) => `a>${k}`)));
    const xs = kids.map((k) => ends(s, `a>${k}`)[0].x).sort((p, q) => p - q), a = s.boxes.get("a")!;
    for (let i = 0; i + 1 < xs.length; i++) expect(xs[i + 1] - xs[i]).toBeGreaterThanOrEqual(16);
    expect(xs[0]).toBeGreaterThanOrEqual(a.x + 8);
    expect(xs[xs.length - 1]).toBeLessThanOrEqual(a.x + a.w - 8);
  });
  it("lands only on a table's face", () => {
    // side by side, the wire meets the table's east wall within its head
    const table = { ...leaf("t", 200, 200), face: 64 };
    const s = solve(problem([table, leaf("u")], ["t>u"], pin({ t: 0, u: 0 })));
    const [from] = ends(s, "t>u"), t = s.boxes.get("t")!;
    expect(from.y).toBeLessThanOrEqual(t.y + 64 - 8);
  });
  it("leaves a jog it cannot close a clear one, never a few pixels", () => {
    // b is held 8 off a's line by its neighbour: the wire either runs straight or steps 16
    const s = solve(problem([leaf("a", 64), leaf("n", 200), leaf("b", 64), leaf("c", 200)], ["a>b", "n>c"], { ...pin({ a: 0, n: 0, c: 1, b: 1 }), held: ["a", "n", "c", "b"] }));
    for (const w of s.wires.values())
      for (let i = 1; i + 2 < w.points.length; i++) expect(Math.abs(w.points[i].x - w.points[i + 1].x) + Math.abs(w.points[i].y - w.points[i + 1].y)).toBeGreaterThanOrEqual(16);
  });
});
