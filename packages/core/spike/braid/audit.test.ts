import { describe, it, expect } from "vitest";
import { audit } from "./audit.js";
import { solve } from "./engine.js";
import { frame, leaf, pin, problem } from "./fixtures.js";

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
