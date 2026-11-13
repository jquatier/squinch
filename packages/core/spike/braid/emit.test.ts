import { describe, it, expect } from "vitest";
import { tidy } from "./emit.js";
import { solve } from "./engine.js";
import { frame, leaf, problem } from "./fixtures.js";
import type { Dir } from "../contract.js";

describe("emit", () => {
  it("drops repeated points and the middle of three in a line", () => {
    expect(tidy([{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 20 }, { x: 5, y: 20 }])).toEqual([{ x: 0, y: 0 }, { x: 0, y: 20 }, { x: 5, y: 20 }]);
  });
  it("joins a wire's pieces at a container's wall without a step", () => {
    const s = solve(problem([leaf("a"), frame("s", [leaf("s.x")])], ["a>s.x"]));
    expect(s.wires.get("a>s.x")!.points).toHaveLength(2);
  });
  it("turns a rightward picture into the downward one transposed — containers, labels and all", () => {
    const even = { top: 16, right: 16, bottom: 16, left: 16 }; // a problem that is its own transpose
    const build = (dir: Dir) => solve(problem([leaf("a", 64, 64), frame("s", [leaf("s.x", 64, 64), leaf("s.y", 64, 64)], { dir, pad: even }), leaf("z", 64, 64)], ["a>s.x:18", "s.x>s.y", "s.y>z", "a>z"], { dir }));
    const down = build("down"), right = build("right");
    for (const [id, d] of down.boxes) expect(right.boxes.get(id)).toEqual({ x: d.y, y: d.x, w: d.h, h: d.w });
    for (const [id, d] of down.wires) expect(right.wires.get(id)!.points).toEqual(d.points.map((p) => ({ x: p.y, y: p.x })));
    expect([right.width, right.height]).toEqual([down.height, down.width]);
  });
  it("reports each box's rank in its own container", () => {
    const s = solve(problem([leaf("a"), frame("s", [leaf("s.x"), leaf("s.y")])], ["a>s.x", "s.x>s.y"]));
    expect(["a", "s", "s.x", "s.y"].map((id) => s.ranks.get(id))).toEqual([0, 1, 0, 1]);
  });
});
