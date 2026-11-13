import { describe, it, expect } from "vitest";
import { crossings, sideMode, sideOrder, sub } from "./count.js";
import { frame, leaf, pin, problem } from "./fixtures.js";
import { order } from "./order.js";
import { plan, reindex, type Plan, type Side } from "./plan.js";

/** Put a row in the order given (by box id; lanes keep their places after). */
const arrange = (p: Plan, cell: string, row: number, ids: string[]) => {
  const r = p.cellOf.get(cell)!.rows[row];
  r.items.sort((a, b) => ids.indexOf(a.node?.id ?? "~") - ids.indexOf(b.node?.id ?? "~"));
  reindex(r);
};
const held = (ids: string[]) => ({ held: ids });

describe("count", () => {
  it("counts two wires between two ranks that change places", () => {
    const p = plan(problem([leaf("a"), leaf("b"), leaf("x"), leaf("y")], ["a>y", "b>x"], held(["a", "b", "x", "y"])));
    order(p);
    expect(crossings(p)).toBe(1);
    arrange(p, "", 2, ["y", "x"]);
    expect(crossings(p)).toBe(0);
  });
  it("counts nothing between wires that share a plain box's wall", () => {
    const p = plan(problem([leaf("a"), leaf("x"), leaf("y")], ["a>x", "a>y"]));
    order(p);
    arrange(p, "", 2, ["y", "x"]);
    expect(crossings(p)).toBe(0);
  });
  it("counts a wire going round under a row against the wires that come down into it", () => {
    // a → b goes under mid; mid's wire down to z stands in its way, mid's wire up from top does not
    const p = plan(problem([leaf("top"), leaf("a"), leaf("mid"), leaf("b"), leaf("z")], ["a>b", "top>mid", "mid>z"],
      { ...pin({ top: 0, a: 1, mid: 1, b: 1, z: 2 }), ...held(["a", "mid", "b"]) }));
    order(p);
    expect(crossings(p)).toBe(1);
  });
  it("reads a container's wall off the order of its ports, so inside and outside are one count", () => {
    // top.a → r and top.b → l: as the ports stand on top's south wall, so the wires leave it
    const top = frame("top", [leaf("top.a"), leaf("top.b")], pin({ "top.a": 0, "top.b": 0 }));
    const p = plan(problem([top, leaf("l"), leaf("r")], ["top.a>r", "top.b>l"], held(["l", "r"])));
    order(p);
    expect(crossings(p)).toBe(0); // the search has swapped a and b inside
    const item = p.root.boxes.get("top")!;
    expect(sub({ item, wall: "S" }, "w:top.b>l")).toBeLessThan(sub({ item, wall: "S" }, "w:top.a>r"));
    arrange(p, "top", 1, ["top.a", "top.b"]);
    expect(crossings(p)).toBe(1); // ports as they were, boxes changed places: now they cross, inside
  });
  it("takes a wire to a side wall straight out, or along the quieter channel", () => {
    const sys = frame("sys", [leaf("sys.x"), leaf("sys.y"), leaf("sys.z")], pin({ "sys.x": 0, "sys.y": 0, "sys.z": 1 }));
    const p = plan(problem([sys, leaf("t")], ["sys.y>sys.z", "sys.x>t"], pin({ sys: 0, t: 0 })));
    order(p);
    const side = p.cellOf.get("sys")!.sides[0] as Side;
    expect(sideMode(side)).toBe("over");       // sys.y has a wire below it and none above
    arrange(p, "sys", 1, ["sys.y", "sys.x"]);
    expect(sideMode(side)).toBe("direct");     // nothing between sys.x and the wall
    expect(sideOrder(p.cellOf.get("sys")!, "E")).toEqual(["w:sys.x>t"]);
  });
});
