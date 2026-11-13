// The engine's parts are plain functions, so each is tested on its own with
// a few lines of input — no view, no model, no font, no layout call.
import { describe, it, expect } from "vitest";
import { acyclic, assignRanks, dense } from "./rank.js";
import { spread } from "./isotonic.js";
import { assignTracks } from "./channel.js";
import { crossings, orderBoxes } from "./order.js";
import { median, solve, type Box, type Group, type Problem, type Dir } from "./engine.js";

const ranks = (ids: string, edges: string[], pins: Record<string, number> = {}) =>
  Object.fromEntries(dense(assignRanks(ids.split(" "), edges.map((e) => e.split(">") as [string, string]), new Map(Object.entries(pins)))));

describe("rank", () => {
  it("puts a target below its source", () => {
    expect(ranks("a b c", ["a>b", "b>c"])).toEqual({ a: 0, b: 1, c: 2 });
  });
  it("keeps a pinned band whole when an unlisted member sits between two band-mates", () => {
    // ELK: scaffolds are lower bounds, the band splits, and the author gets an error
    expect(ranks("a k b", ["a>k", "k>b"], { a: 0, b: 0 })).toEqual({ a: 0, b: 0, k: 1 });
  });
  it("breaks a mutual pair once, first edge wins", () => {
    expect(acyclic([["a", "b"], ["b", "a"]])).toEqual([["a", "b"]]);
    expect(ranks("a b", ["a>b", "b>a"])).toEqual({ a: 0, b: 1 });
  });
  it("lets two members joined by an edge share a pinned rank", () => {
    expect(ranks("a b", ["a>b"], { a: 0, b: 0 })).toEqual({ a: 0, b: 0 });
  });
  it("floats an unpinned feeder above a pinned target", () => {
    expect(ranks("ctx a b", ["ctx>a", "a>b"], { a: 0, b: 1 })).toEqual({ ctx: 0, a: 1, b: 2 });
  });
  it("drops a lone source to just above what it feeds", () => {
    expect(ranks("a b c mon", ["a>b", "b>c", "mon>c"])).toEqual({ a: 0, b: 1, mon: 1, c: 2 });
  });
});

describe("rank is the least total wire", () => {
  // every DAG on five nodes drawn from a fixed sequence, against brute force
  it("matches exhaustive search on small graphs", () => {
    let seed = 7;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const ids = ["a", "b", "c", "d", "e"];
    for (let trial = 0; trial < 60; trial++) {
      const edges: [string, string][] = [];
      for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) if (next() < 0.4) edges.push([ids[i], ids[j]]);
      const got = assignRanks(ids, edges);
      const length = (r: (id: string) => number) => edges.reduce((a, [x, y]) => a + r(y) - r(x), 0);
      for (const [x, y] of edges) expect(got.get(y)!).toBeGreaterThan(got.get(x)!);
      let best = Infinity;
      const r = [0, 0, 0, 0, 0];
      const walk = (i: number) => {
        if (i === 5) {
          if (edges.every(([x, y]) => r[ids.indexOf(y)] > r[ids.indexOf(x)])) best = Math.min(best, length((id) => r[ids.indexOf(id)]));
          return;
        }
        for (r[i] = 0; r[i] < 5; r[i]++) walk(i + 1);
      };
      walk(0);
      expect(length((id) => got.get(id)!)).toBe(best);
    }
  });
});

describe("spread", () => {
  it("leaves everything where it wants to be when nothing collides", () => {
    expect(spread([0, 100, 300], [1, 1, 1], [50, 50, 0])).toEqual([0, 100, 300]);
  });
  it("splits a collision around its weighted centre", () => {
    expect(spread([100, 100], [1, 1], [40, 0])).toEqual([80, 120]);
    expect(spread([100, 100], [3, 1], [40, 0])).toEqual([90, 130]);
  });
  it("never reorders", () => {
    const out = spread([300, 0], [1, 1], [10, 0]);
    expect(out[1] - out[0]).toBe(10);
  });
});

describe("median", () => {
  it("follows one wire, centres between two on a side, follows the middle of three", () => {
    expect(median([{ value: 7, weight: 1 }])).toBe(7);
    expect(median([{ value: 0, weight: 1 }, { value: 10, weight: 1 }])).toBe(5);
    expect(median([{ value: 0, weight: 1 }, { value: 4, weight: 1 }, { value: 10, weight: 1 }])).toBe(4);
  });
});

describe("tracks", () => {
  const lo = (pos: number) => ({ at: "lo" as const, pos }), hi = (pos: number) => ({ at: "hi" as const, pos });
  it("shares a track between runs that do not overlap", () => {
    const t = assignTracks([{ id: "a", a: lo(0), b: hi(50) }, { id: "b", a: lo(100), b: hi(150) }]);
    expect([t.get("a"), t.get("b")]).toEqual([0, 0]);
  });
  it("nests a short go-around inside a long one", () => {
    const t = assignTracks([{ id: "long", a: lo(0), b: lo(300) }, { id: "short", a: lo(100), b: lo(200) }]);
    expect(t.get("short")).toBeLessThan(t.get("long")!);
  });
  it("never draws one wire's stub along another's", () => {
    // a comes down at 100 and b goes down from 100: a's track must be the upper
    const t = assignTracks([{ id: "b", a: lo(0), b: hi(100) }, { id: "a", a: lo(100), b: hi(200) }]);
    expect(t.get("a")).toBeLessThan(t.get("b")!);
  });
});

describe("order", () => {
  const rank = new Map([["a", 0], ["b", 0], ["x", 1], ["y", 1]]);
  it("counts a crossing and removes it", () => {
    const edges: [string, string][] = [["a", "y"], ["b", "x"]];
    expect(crossings(["a", "b", "x", "y"], rank, edges)).toBe(1);
    const order = orderBoxes(["a", "b", "x", "y"], rank, edges);
    expect(crossings(order, rank, edges)).toBe(0);
  });
  it("leaves an order alone when nothing crosses", () => {
    expect(orderBoxes(["a", "b", "x", "y"], rank, [["a", "x"], ["b", "y"]])).toEqual(["a", "b", "x", "y"]);
  });
});

describe("a net", () => {
  it("shares one track however its branches overlap", () => {
    const lo = (pos: number) => ({ at: "lo" as const, pos }), hi = (pos: number) => ({ at: "hi" as const, pos });
    const t = assignTracks([
      { id: "p", a: lo(100), b: hi(0), net: "n" }, { id: "q", a: lo(100), b: hi(200), net: "n" }, { id: "r", a: lo(100), b: hi(50), net: "n" },
    ]);
    expect(new Set(t.values()).size).toBe(1);
  });
});

// ── the whole engine, on problems small enough to read ───────────────────────
const leaf = (id: string, w = 120, h = 64): Box => ({ id, w, h });
const group = (boxes: Box[], over: Partial<Group> = {}): Group => ({
  dir: "down", pad: { top: 32, right: 32, bottom: 32, left: 32 }, gap: { lane: 48, rank: 56 }, boxes, pins: new Map(), ...over,
});
const wire = (s: string) => { const [from, to] = s.split(">"); return { id: s, from, to }; };
const problem = (boxes: Box[], wires: string[], over: Partial<Group> = {}): Problem => ({ root: group(boxes, over), wires: wires.map(wire) });
const pin = (o: Record<string, number>) => ({ pins: new Map(Object.entries(o)) });

describe("solve", () => {
  it("draws a wire between two ranks as one straight line", () => {
    const s = solve(problem([leaf("a"), leaf("b")], ["a>b"]));
    const a = s.boxes.get("a")!, b = s.boxes.get("b")!, pts = s.wires.get("a>b")!.points;
    expect(pts).toHaveLength(2);
    expect(pts[0]).toEqual({ x: a.x + 60, y: a.y + 64 }); // out of the middle of a's bottom
    expect(pts[1]).toEqual({ x: b.x + 60, y: b.y });      // into the middle of b's top
    expect([a.x, b.y - (a.y + 64)]).toEqual([b.x, 56]);   // b under a, one rank gap below
  });
  it("puts every box's centre line on the 8-pixel grid", () => {
    const s = solve(problem([leaf("a", 200), leaf("b"), leaf("c", 160), leaf("d")], ["a>b", "a>c", "b>d", "c>d"]));
    for (const r of s.boxes.values()) expect((r.x + r.w / 2) % 8).toBe(0);
  });
  it("draws a same-rank wire straight across the gutter", () => {
    const s = solve(problem([leaf("a"), leaf("b")], ["a>b"], pin({ a: 0, b: 0 })));
    const [p, q] = s.wires.get("a>b")!.points;
    expect([p.y, q.y, q.x - p.x]).toEqual([64, 64, 48]);
  });
  it("takes a same-rank wire round whatever stands between its ends", () => {
    const s = solve(problem([leaf("a"), leaf("mid"), leaf("b")], ["a>b"], pin({ a: 0, mid: 0, b: 0 })));
    const pts = s.wires.get("a>b")!.points;
    expect(pts).toHaveLength(4);
    const mid = s.boxes.get("mid")!;
    expect(pts[1].y).toBeGreaterThan(mid.y + mid.h); // under the row, not through it
  });
  it("passes a long wire between the boxes of the rank it crosses", () => {
    const s = solve(problem([leaf("a"), leaf("b"), leaf("c")], ["a>b", "b>c", "a>c"]));
    const b = s.boxes.get("b")!;
    for (const p of s.wires.get("a>c")!.points) expect(p.x < b.x || p.x > b.x + b.w || p.y <= b.y || p.y >= b.y + b.h).toBe(true);
  });
  it("gives a label room on its own wire", () => {
    const p = problem([leaf("a"), leaf("b")], ["a>b"]);
    p.wires[0].label = { w: 60, h: 18 };
    const s = solve(p);
    const { points, label } = s.wires.get("a>b")!;
    expect(label!.x + 30).toBe(points[0].x);           // centred on the wire
    expect(label!.y).toBeGreaterThan(96);              // clear of the source
    expect(label!.y + 18).toBeLessThan(s.boxes.get("b")!.y);
  });
  it("lays out `direction right` as the same picture with the axes swapped", () => {
    const build = (dir: Dir) => solve(problem([leaf("a", 64, 64), leaf("b", 64, 64), leaf("c", 64, 64)], ["a>b", "a>c"], { dir }));
    const down = build("down"), right = build("right");
    for (const id of ["a", "b", "c"]) {
      const d = down.boxes.get(id)!, r = right.boxes.get(id)!;
      expect([r.x, r.y]).toEqual([d.y, d.x]);
    }
    expect(right.wires.get("a>c")!.points).toEqual(down.wires.get("a>c")!.points.map((p) => ({ x: p.y, y: p.x })));
  });
  it("carries a wire through a container wall to the box inside", () => {
    const inner: Box = { id: "sys", w: 0, h: 0, group: group([leaf("sys.x"), leaf("sys.y")], { pad: { top: 44, right: 16, bottom: 16, left: 16 } }) };
    const s = solve(problem([leaf("a"), inner], ["a>sys.y", "sys.x>sys.y"]));
    const y = s.boxes.get("sys.y")!, pts = s.wires.get("a>sys.y")!.points;
    const end = pts[pts.length - 1];
    expect(end.y).toBe(y.y);                                     // on its top wall
    expect(end.x).toBeGreaterThan(y.x); expect(end.x).toBeLessThan(y.x + y.w);
    const x = s.boxes.get("sys.x")!;                             // and round the box above it
    for (const p of pts) expect(p.x > x.x && p.x < x.x + x.w && p.y > x.y && p.y < x.y + x.h).toBe(false);
  });
  it("gives a container its own direction with no special case", () => {
    const pipe: Box = { id: "p", w: 0, h: 0, group: group([leaf("p.a"), leaf("p.b"), leaf("p.c")], { dir: "right" }) };
    const s = solve(problem([leaf("src"), pipe], ["src>p.a", "p.a>p.b", "p.b>p.c"]));
    const [a, b, c] = ["p.a", "p.b", "p.c"].map((id) => s.boxes.get(id)!);
    expect(a.y).toBe(b.y); expect(b.y).toBe(c.y);                // one baseline
    expect(a.x).toBeLessThan(b.x); expect(b.x).toBeLessThan(c.x);
  });
  it("draws a bundle as one trunk: one port, one lane through the rank between", () => {
    const boxes = [leaf("hub"), leaf("n1"), leaf("n2"), leaf("f1"), leaf("f2")];
    const p = problem(boxes, ["hub>n1", "hub>n2", "hub>f1", "hub>f2"], pin({ hub: 0, n1: 1, n2: 1, f1: 2, f2: 2 }));
    for (const w of p.wires) if (w.to.startsWith("f")) w.bundle = "far";
    const s = solve(p);
    const [a, b] = ["hub>f1", "hub>f2"].map((id) => s.wires.get(id)!.points);
    expect(a[0]).toEqual(b[0]);                       // one port on the hub
    const through = (pts: typeof a) => pts.find((q) => q.y > s.boxes.get("n1")!.y)!.x;
    expect(through(a)).toBe(through(b));              // one lane past n1 and n2
  });
  it("reorders boxes to uncross wires, except the ones the author placed", () => {
    const build = (free: boolean) => solve(problem([leaf("a"), leaf("b"), leaf("x"), leaf("y")], ["a>y", "b>x"], { held: free ? [] : ["a", "b", "x", "y"] }));
    const x = (s: ReturnType<typeof build>, id: string) => s.boxes.get(id)!.x;
    const kept = build(false), freed = build(true);
    expect(x(kept, "x")).toBeLessThan(x(kept, "y"));   // declaration order, wires cross
    expect((x(freed, "a") - x(freed, "b")) * (x(freed, "y") - x(freed, "x"))).toBeGreaterThan(0); // uncrossed
  });
  it("puts aligned boxes on one centre line, whatever their widths", () => {
    const boxes = [leaf("a", 200), leaf("b"), leaf("c"), leaf("d", 160)];
    const s = solve(problem(boxes, ["a>b", "a>c", "b>d", "c>d"], { aligned: [["a", "c", "d"]] }));
    const centre = (id: string) => s.boxes.get(id)!.x + s.boxes.get(id)!.w / 2;
    expect(centre("c")).toBe(centre("a"));
    expect(centre("d")).toBe(centre("a"));
  });
  // ── what makes a layout tidy, one rule at a time ───────────────────────────
  const centre = (s: ReturnType<typeof solve>, id: string) => s.boxes.get(id)!.x + s.boxes.get(id)!.w / 2;
  const crossed = (s: ReturnType<typeof solve>) => {
    const segs = [...s.wires].flatMap(([id, w]) => w.points.slice(1).map((b, i) => ({ id, a: w.points[i], b })));
    let n = 0;
    for (const h of segs) for (const v of segs)
      if (h.id !== v.id && h.a.y === h.b.y && v.a.x === v.b.x
        && v.a.x > Math.min(h.a.x, h.b.x) && v.a.x < Math.max(h.a.x, h.b.x)
        && h.a.y > Math.min(v.a.y, v.b.y) && h.a.y < Math.max(v.a.y, v.b.y)) n++;
    return n;
  };
  const sys = (title?: { w: number; h: number }): Box =>
    ({ id: "sys", w: 0, h: 0, title, group: group([leaf("sys.x"), leaf("sys.y")], { pad: { top: 44, right: 16, bottom: 16, left: 16 } }) });

  it("centres a parent over its children, whatever feeds it", () => {
    // `a` feeds `p` and a sibling beside it: one wire above `p`, two below
    const s = solve(problem([leaf("a"), leaf("b"), leaf("p"), leaf("c1"), leaf("c2")], ["a>p", "a>b", "p>c1", "p>c2"], pin({ a: 0, b: 1, p: 1, c1: 2, c2: 2 })));
    expect(Math.abs(centre(s, "p") - (centre(s, "c1") + centre(s, "c2")) / 2)).toBeLessThanOrEqual(4); // to the grid
    expect(s.wires.get("a>p")!.points).toHaveLength(2); // and what feeds it comes to meet it
  });
  it("sends a wide box's ports to meet its wires", () => {
    const s = solve(problem([leaf("a", 320), leaf("b"), leaf("c")], ["a>b", "a>c"]));
    for (const w of s.wires.values()) expect(w.points).toHaveLength(2);
  });
  it("takes a wire round a titled container's boxes on the side away from the title", () => {
    const s = solve(problem([leaf("a"), sys({ w: 80, h: 34 })], ["a>sys.y", "sys.x>sys.y"]));
    const x = s.boxes.get("sys.x")!, pts = s.wires.get("a>sys.y")!.points;
    expect(pts.find((p) => p.y > x.y)!.x).toBeGreaterThan(x.x + x.w);
    expect(pts[0].x).toBeGreaterThan(s.boxes.get("sys")!.x + 80); // and enters clear of the title
  });
  it("reserves room for a label only where it is drawn", () => {
    const build = (label?: { w: number; h: number }) => {
      const p = problem([leaf("a"), leaf("b"), sys()], ["a>b", "b>sys.y", "sys.x>sys.y"]);
      p.wires[1].label = label;
      return solve(p);
    };
    const plain = build(), labelled = build({ w: 60, h: 18 });
    expect(labelled.boxes.get("sys")).toEqual(plain.boxes.get("sys"));       // the container it enters is no bigger
    const l = labelled.wires.get("b>sys.y")!.label!, box = labelled.boxes.get("sys")!;
    expect(l.y + l.h).toBeLessThanOrEqual(box.y);                            // the label stands outside it
  });
  it("sends a wire leaving a container round the side it is headed for", () => {
    for (const order of [["o1", "o2"], ["o2", "o1"]]) {
      const s = solve(problem([sys(), ...order.map((o) => leaf(o))], ["sys.x>sys.y", "sys.x>o2", "sys.y>o1"], { held: order }));
      expect(crossed(s)).toBe(0);
      expect(s.wires.get("sys.x>o2")!.points).toHaveLength(4); // round `sys.y` and straight down
    }
  });
  it("moves a box to straighten a wire only when nothing else pays for it", () => {
    // `top` has one child, which shares its row with a pair under `hub`:
    // the pair stays centred under `hub`, and `top` comes to stand over `only`
    const s = solve(problem([leaf("hub"), leaf("top"), leaf("l"), leaf("r"), leaf("only")], ["hub>l", "hub>r", "top>only"]));
    expect(centre(s, "hub")).toBe((centre(s, "l") + centre(s, "r")) / 2);
    expect(s.wires.get("top>only")!.points).toHaveLength(2);
  });
  it("orders a nested container's exits by the box each wire finally reaches", () => {
    // two levels down on one side, one level down on the other, and the
    // author has put the stores the other way round from the declaration
    const pad = { top: 44, right: 16, bottom: 16, left: 16 };
    const api: Box = { id: "api", w: 0, h: 0, group: group([leaf("api.g"), leaf("api.r")], { pad }) };
    const apps: Box = { id: "apps", w: 0, h: 0, group: group([api], { pad }) };
    for (const order of [["data.pg", "data.s3"], ["data.s3", "data.pg"]]) {
      const data: Box = { id: "data", w: 0, h: 0, group: group(order.map((id) => leaf(id)), { pad, held: order }) };
      const s = solve(problem([apps, data], ["api.g>api.r", "api.r>data.pg", "api.r>data.s3"]));
      expect(crossed(s)).toBe(0);
    }
  });
  it("takes a wire to a side wall along whichever channel is quieter", () => {
    // `x` reaches out past `y`; `y` has a wire going down, so `x`'s goes over the top
    const pad = { top: 44, right: 16, bottom: 16, left: 16 };
    const inner: Box = { id: "sys", w: 0, h: 0, group: group([leaf("sys.x"), leaf("sys.y"), leaf("sys.z")], { pad, ...pin({ "sys.x": 0, "sys.y": 0, "sys.z": 1 }) }) };
    const s = solve(problem([inner, leaf("t")], ["sys.y>sys.z", "sys.x>t"], pin({ sys: 0, t: 0 })));
    const y = s.boxes.get("sys.y")!, pts = s.wires.get("sys.x>t")!.points;
    expect(crossed(s)).toBe(0);
    expect(Math.min(...pts.map((p) => p.y))).toBeLessThan(y.y); // over `y`, not under it
  });
  it("is a pure function", () => {
    const make = () => problem([leaf("a"), leaf("b"), leaf("c"), leaf("d")], ["a>b", "a>c", "b>d", "c>d", "a>d"]);
    expect(JSON.stringify([...solve(make()).wires])).toBe(JSON.stringify([...solve(make()).wires]));
  });
});
