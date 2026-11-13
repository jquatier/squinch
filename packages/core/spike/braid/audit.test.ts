import { describe, it, expect } from "vitest";
import { audit } from "./audit.js";
import { solve } from "./engine.js";
import { frame, leaf, pin, problem } from "./fixtures.js";

describe("legal on awkward inputs (§3.7)", () => {
  const cases = {
    "a wire that ends at a container, and one that leaves it": problem([leaf("a"), frame("s", [leaf("s.x"), leaf("s.y")])], ["a>s", "s.x>s.y", "s>a"]),
    "a container beside the box that feeds it and its inside": problem([leaf("a"), frame("s", [leaf("s.x"), leaf("s.y")])], ["a>s", "s.x>s.y", "a>s.y"], pin({ a: 0, s: 0 })),
    "containers wired to each other along one rank": problem([frame("t", [leaf("t.x")]), frame("s", [leaf("s.x"), leaf("s.y")]), leaf("q")], ["t>s", "s>q", "t.x>s", "q>t"], pin({ t: 0, s: 0, q: 0 })),
    "an empty container": problem([leaf("a"), frame("s", [])], ["a>s"]),
    "a rightward container in a downward one, wired up, down and sideways": problem([leaf("a"), frame("s", [leaf("s.x"), leaf("s.y"), leaf("s.z")], { dir: "right", ...pin({ "s.x": 0, "s.y": 0, "s.z": 1 }) }), leaf("b")], ["a>s.y", "s.x>b", "s.z>a", "a>s", "s.y>s.z"]),
    "wires out of a nested container's side": problem([frame("o", [frame("o.i", [leaf("o.i.x"), leaf("o.i.y")], pin({ "o.i.x": 0, "o.i.y": 0 })), leaf("o.k")], pin({ "o.i": 0, "o.k": 0 })), leaf("t")], ["o.i.x>t", "o.i.y>t", "o.k>t", "o.i.x>o.k"], pin({ o: 0, t: 0 })),
    "an upward wire, a mutual pair and a ring": problem([leaf("a"), leaf("b"), leaf("c")], ["a>b", "b>a", "b>c", "c>a"], pin({ a: 0, b: 1, c: 2 })),
  };
  for (const [name, p] of Object.entries(cases))
    it(name, () => {
      const s = solve(p);
      expect(audit(p, s)).toEqual([]);
      expect(s.skipped).toEqual([]);
    });
});

describe("audit", () => {
  const p = problem([leaf("a"), leaf("mid"), frame("s", [leaf("s.x"), leaf("s.y")]), leaf("z")], ["a>mid", "a>s.y", "s.x>s.y", "mid>z", "a>z:60"], { ...pin({ a: 0 }), aligned: [["a", "z"]] });
  it("passes what the engine draws", () => {
    expect(audit(p, solve(p))).toEqual([]);
  });
  it("catches a wire through a box, two wires along one line, and a broken promise", () => {
    const s = solve(p);
    const through = { ...s, wires: new Map(s.wires) };
    const a = s.boxes.get("a")!, z = s.boxes.get("z")!;
    through.wires.set("a>mid", { points: [{ x: a.x + 60, y: a.y + 64 }, { x: a.x + 60, y: z.y + 200 }, { x: z.x + 60, y: z.y + 200 }, { x: z.x + 60, y: z.y + 64 }] });
    expect(audit(p, through).some((b) => /ends at|through/.test(b))).toBe(true);
    const doubled = { ...s, wires: new Map(s.wires) };
    doubled.wires.set("mid>z", s.wires.get("a>z")!);
    expect(audit(p, doubled).some((b) => /run along one line|meet .* at one point/.test(b))).toBe(true);
    const moved = { ...s, boxes: new Map(s.boxes) };
    moved.boxes.set("z", { ...z, x: z.x + 8 });
    expect(audit(p, moved).some((b) => /aligned/.test(b))).toBe(true);
  });
});
