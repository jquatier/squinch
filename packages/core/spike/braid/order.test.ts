import { describe, it, expect } from "vitest";
import { frame, leaf, pin, problem } from "./fixtures.js";
import { order, rethread } from "./order.js";
import { plan, reindex, type Plan } from "./plan.js";

const row = (p: Plan, cell: string, k: number) => p.cellOf.get(cell)!.rows[k].items.map((i) => i.node?.id ?? i.kind);

describe("order", () => {
  it("leaves declaration order alone when nothing crosses", () => {
    const p = plan(problem([leaf("a"), leaf("b"), leaf("x"), leaf("y")], ["a>x", "b>y"]));
    expect(order(p)).toMatchObject({ crossings: 0, moved: 0 });
    expect([row(p, "", 1), row(p, "", 2)]).toEqual([["a", "b"], ["x", "y"]]);
  });
  it("moves a box to remove a crossing", () => {
    const p = plan(problem([leaf("a"), leaf("b"), leaf("x"), leaf("y")], ["a>y", "b>x"]));
    expect(order(p).crossings).toBe(0);
  });
  it("never moves a box the author placed, and never moves one merely to straighten a wire", () => {
    const placed = plan(problem([leaf("a"), leaf("b"), leaf("x"), leaf("y")], ["a>y", "b>x"], { held: ["a", "b", "x", "y"] }));
    expect(order(placed)).toMatchObject({ crossings: 1, moved: 0 });
    // c sits under b's end of the row; swapping a and b would straighten its wire and uncross nothing
    const idle = plan(problem([leaf("a"), leaf("b"), leaf("x"), leaf("y"), leaf("c")], ["a>x", "x>c"], pin({ a: 0, b: 0, x: 1, y: 1, c: 2 })));
    expect(order(idle).moved).toBe(0);
  });
  it("swaps two boxes in one container to uncross wires that end in another", () => {
    const pair = (id: string) => frame(id, [leaf(`${id}.a`), leaf(`${id}.b`)], pin({ [`${id}.a`]: 0, [`${id}.b`]: 0 }));
    const p = plan(problem([pair("top"), pair("low")], ["top.a>low.b", "top.b>low.a"]));
    expect(order(p).crossings).toBe(0);
  });
  it("puts a lifted thread back along the path that crosses least, port and lanes together", () => {
    // the wire to `far` must pass `mid`'s row: left of it crosses mid's own wire from `l`
    const p = plan(problem([leaf("l"), leaf("a"), leaf("mid"), leaf("far")], ["l>mid", "a>far"], { ...pin({ l: 0, a: 0, mid: 1, far: 2 }), held: ["l", "a"] }));
    order(p);
    const lane = p.threads.get("w:a>far")!.items[0], r = p.root.rows[lane.row];
    r.items = [lane, ...r.items.filter((i) => i !== lane)];
    reindex(r);
    rethread(p.threads.get("w:a>far")!);
    expect(row(p, "", 2)).toEqual(["mid", "lane"]);
  });
});
