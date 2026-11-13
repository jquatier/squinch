import { describe, it, expect } from "vitest";
import { frame, leaf, problem } from "./fixtures.js";
import { grow } from "./tree.js";

describe("tree", () => {
  const p = problem([frame("a", [leaf("a.x"), leaf("a.y")]), frame("b", [frame("b.c", [leaf("b.c.z")])]), leaf("lone")], ["a.x>a.y", "a.y>b.c.z", "a>a.x", "a.x>nowhere"]);
  const tree = grow(p);
  const walk = (id: string) => tree.walks.find((w) => w.wire.id === id)!;
  it("finds the container where a wire's two ends part company", () => {
    expect([walk("a.x>a.y").home.id, walk("a.y>b.c.z").home.id]).toEqual(["a", ""]);
  });
  it("lists the boxes that lead from the home down to each end, end first", () => {
    expect(walk("a.y>b.c.z").up.map((n) => n.id)).toEqual(["a.y", "a"]);
    expect(walk("a.y>b.c.z").down.map((n) => n.id)).toEqual(["b.c.z", "b.c", "b"]);
  });
  it("does not draw a wire one of whose ends holds the other, or is not in the picture", () => {
    expect(tree.skipped).toEqual(["a>a.x", "a.x>nowhere"]);
  });
  it("lists every container before the one that holds it", () => {
    const ids = tree.inner.map((n) => n.id);
    expect(ids.indexOf("b.c")).toBeLessThan(ids.indexOf("b"));
    expect(ids[ids.length - 1]).toBe("");
  });
  it("knows which boxes a wire ends at or inside", () => {
    expect(tree.wired.has(tree.nodes.get("lone")!)).toBe(false);
    expect(tree.wired.has(tree.nodes.get("b")!)).toBe(true);
  });
});
