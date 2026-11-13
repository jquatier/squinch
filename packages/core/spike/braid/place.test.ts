import { describe, it, expect } from "vitest";
import { frame, leaf, pin, problem } from "./fixtures.js";
import { lay } from "./lay.js";
import { order } from "./order.js";
import { plan } from "./plan.js";
import { apart } from "./place.js";
import type { Problem } from "../contract.js";

/** Centres along the row, by box id, after the whole picture is laid out. */
const centres = (pr: Problem) => {
  const p = plan(pr);
  order(p);
  for (const c of p.cells) lay(c);
  const x = (id: string) => [...p.cells].flatMap((c) => [...c.boxes.values()]).find((i) => i.node!.id === id)!.x;
  return { x, p };
};

describe("place", () => {
  it("lines boxes up on their centres, whatever their widths", () => {
    const { x } = centres(problem([leaf("a", 200), leaf("b"), leaf("c", 160)], ["a>b", "b>c"]));
    expect([x("b"), x("c")]).toEqual([x("a"), x("a")]);
  });
  it("stands a box over two exactly between them, and over three on the middle one", () => {
    const two = centres(problem([leaf("p"), leaf("l"), leaf("r")], ["p>l", "p>r"]));
    expect(two.x("p")).toBe((two.x("l") + two.x("r")) / 2);
    const three = centres(problem([leaf("p"), leaf("l", 200), leaf("m"), leaf("r")], ["p>l", "p>m", "p>r"]));
    expect(three.x("p")).toBe(three.x("m"));
  });
  it("keeps a stage in line with its successor; the side lookup hangs beside it", () => {
    const { x } = centres(problem([leaf("in"), leaf("stage"), leaf("next"), leaf("lookup"), leaf("out")], ["in>stage", "stage>next", "stage>lookup", "next>out"]));
    expect(x("stage")).toBe(x("next"));
  });
  it("does not let a wire running back against the flow lead its box", () => {
    const { x } = centres(problem([leaf("a"), leaf("b"), leaf("c"), leaf("d")], ["a>b", "b>c", "b>d", "d>a"], pin({ a: 0, b: 1, c: 2, d: 2 })));
    expect(x("b")).toBe((x("c") + x("d")) / 2); // d is not dragged under a
  });
  it("puts every centre line on the 8-pixel grid, in every container", () => {
    const { p } = centres(problem([leaf("a", 200), frame("s", [leaf("s.x", 160), leaf("s.y")]), leaf("z", 280)], ["a>s.x", "s.x>s.y", "s.y>z", "a>z"]));
    for (const c of p.cells) for (const it of c.boxes.values()) expect(it.x % 8).toBe(0);
    expect(p.cellOf.get("s")!.w % 16).toBe(0);
  });
  it("gives aligned boxes one centre line, where the wires of all of them put it", () => {
    const { x } = centres(problem([leaf("a", 200), leaf("b"), leaf("c"), leaf("d", 160)], ["a>b", "a>c", "b>d", "c>d"], { aligned: [["a", "c", "d"]] }));
    expect([x("c"), x("d")]).toEqual([x("a"), x("a")]);
  });
  it("stands every box of one column band wholly before the next, in every rank", () => {
    const { x } = centres(problem([leaf("a", 320), leaf("b"), leaf("c"), leaf("d", 320)], ["a>c", "b>d"],
      { ...pin({ a: 0, b: 0, c: 1, d: 1 }), held: ["a", "b", "c", "d"], columns: [["a", "c"], ["b", "d"]] }));
    expect(x("a") + 160).toBeLessThanOrEqual(x("d") - 160);
    expect(x("c") + 60).toBeLessThanOrEqual(x("b") - 60);
  });
  it("closes a gap nothing holds open, and makes a cell as small as its inside allows", () => {
    const { x, p } = centres(problem([leaf("a"), leaf("b"), leaf("lone")], ["a>b"], pin({ a: 0, lone: 0, b: 1 })));
    expect(x("lone") - x("a")).toBe(168);
    expect(p.root.w).toBeLessThanOrEqual(32 + 120 + 48 + 120 + 32 + 16); // …to the grid: centres on 8, width on 16
  });
  it("centres a rank with no wire up or down on its neighbours", () => {
    const { x, p } = centres(problem([leaf("a", 320), leaf("b", 320), leaf("lone")], ["a>b"], pin({ a: 0, b: 1, lone: 2 })));
    expect(Math.abs(x("lone") - p.root.w / 2)).toBeLessThanOrEqual(8);
  });
  it("keeps a wire passing a box half a gutter off it, and two wires a lane apart", () => {
    const { p } = centres(problem([leaf("a"), leaf("b"), leaf("c")], ["a>b", "b>c", "a>c"]));
    const lane = p.threads.get("w:a>c")!.items[0], b = p.root.boxes.get("b")!;
    expect(Math.abs(lane.x - b.x)).toBe(apart(b, lane));
    expect(apart(b, lane)).toBe(88); // half the box, half the gutter, up to the grid
    expect(apart(lane, lane)).toBe(16);
  });
});
