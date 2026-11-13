import { describe, it, expect } from "vitest";
import { frame, leaf, pin, problem } from "./fixtures.js";
import { plan, wallIn } from "./plan.js";

const kinds = (p: ReturnType<typeof plan>, id: string) => p.routes.get(id)!.map((r) => r.piece.kind);
const rowIds = (p: ReturnType<typeof plan>, cell = "") => p.cellOf.get(cell)!.rows.map((r) => `${r.kind}:${r.items.map((i) => i.node?.id ?? i.kind).join(",")}`);

describe("plan", () => {
  it("gives a cell its two walls and a row for each rank", () => {
    const p = plan(problem([leaf("a"), leaf("b")], ["a>b"]));
    expect(rowIds(p)).toEqual(["wall:", "rank:a", "rank:b", "wall:"]);
  });
  it("gives a wire a lane in every rank it passes", () => {
    const p = plan(problem([leaf("a"), leaf("b"), leaf("c")], ["a>b", "b>c", "a>c"]));
    expect(kinds(p, "a>c")).toEqual(["seg", "seg"]);
    expect(p.threads.get("w:a>c")!.items.map((i) => [i.kind, i.row])).toEqual([["lane", 2]]);
  });
  it("puts a row for labels in a gap that carries one, and the label half-way along its wire", () => {
    const odd = plan(problem([leaf("a"), leaf("b")], ["a>b:60"]));
    expect(odd.cellOf.get("")!.rows.map((r) => r.kind)).toEqual(["wall", "rank", "label", "rank", "wall"]);
    expect(odd.labels.get("a>b")!.item!.row).toBe(2);
    // two gaps: the label rides the lane in the rank between
    const even = plan(problem([leaf("a"), leaf("b"), leaf("c")], ["a>b", "b>c", "a>c:60"]));
    expect(even.cellOf.get("")!.rows.map((r) => r.kind)).toEqual(["wall", "rank", "rank", "rank", "wall"]);
    expect(even.labels.get("a>c")!.item!.row).toBe(2);
  });
  it("carries a wire into a container through a port on its wall", () => {
    const p = plan(problem([leaf("a"), frame("s", [leaf("s.x"), leaf("s.y")])], ["a>s.y", "s.x>s.y"]));
    expect(kinds(p, "a>s.y")).toEqual(["seg", "seg", "seg"]); // a to the wall; port to a lane past s.x; lane to s.y
    // (lanes and ports join their rows when the order is searched: order.ts)
    expect(p.threads.get("w:a>s.y")!.items.map((i) => [i.cell.id, i.kind, i.row])).toEqual([["s", "port", 0], ["s", "lane", 1]]);
  });
  it("glues rank-mates a wire joins, and sends a third partner round", () => {
    const p = plan(problem([leaf("a"), leaf("b"), leaf("c")], ["a>b", "b>c", "a>c"], pin({ a: 0, b: 0, c: 0 })));
    expect([kinds(p, "a>b"), kinds(p, "b>c"), kinds(p, "a>c")]).toEqual([["glued"], ["glued"], ["turn"]]);
  });
  it("brings a box the author did not place next to its partner, and leaves placed ones where they are", () => {
    const free = plan(problem([leaf("a"), leaf("mid"), leaf("b"), leaf("z")], ["a>b", "mid>z"], pin({ a: 0, mid: 0, b: 0, z: 1 })));
    expect(rowIds(free)[1]).toBe("rank:a,b,mid");
    const held = plan(problem([leaf("a"), leaf("mid"), leaf("b")], ["a>b"], { ...pin({ a: 0, mid: 0, b: 0 }), held: ["a", "mid", "b"] }));
    expect(kinds(held, "a>b")).toEqual(["turn"]);
  });
  it("stands a box no wire touches after its row-mates, unless the author placed it", () => {
    expect(rowIds(plan(problem([leaf("idle"), leaf("a"), leaf("b")], ["a>b"], pin({ idle: 0, a: 0, b: 1 }))))[1]).toBe("rank:a,idle");
    expect(rowIds(plan(problem([leaf("idle"), leaf("a"), leaf("b")], ["a>b"], { ...pin({ idle: 0, a: 0, b: 1 }), held: ["idle"] })))[1]).toBe("rank:idle,a");
  });
  it("takes a wire out of a container of the other direction through a side wall", () => {
    // seen from a `down` parent, the north wall of a `right` child is its own west wall
    const pipe = frame("p", [leaf("p.a"), leaf("p.b")], { dir: "right" });
    const p = plan(problem([leaf("src"), pipe], ["src>p.b", "p.a>p.b"]));
    expect(wallIn(p.cellOf.get("p")!, p.root, "N")).toBe("W");
    expect(kinds(p, "src>p.b")).toEqual(["seg", "side"]);
  });
  it("gives the wires of a bundle one lane through each rank they all pass", () => {
    const pr = problem([leaf("hub"), leaf("n"), leaf("f1"), leaf("f2")], ["hub>n", "hub>f1", "hub>f2"], pin({ hub: 0, n: 1, f1: 2, f2: 2 }));
    for (const w of pr.wires) if (w.to.startsWith("f")) w.bundle = "far";
    const p = plan(pr);
    expect(p.threads.get("b:far")!.items).toHaveLength(1);
    expect(p.routes.get("hub>f1")![0].piece).toBe(p.routes.get("hub>f2")![0].piece); // one trunk
  });
});
