// Each module on its own, with a few lines of input — no view, no model, no
// font, and (below `engine.ts`) no call to `solve`.
import { describe, it, expect } from "vitest";
import type { Box, Group, Problem } from "./contract.js";
import { Count } from "./count.js";
import { ceilTo, framed, pagePt, pageRect, real, snap, turn } from "./frame.js";
import { gutters } from "./gutter.js";
import { order } from "./order.js";
import { place } from "./place.js";
import { settle, wallspace, type End } from "./ports.js";
import { project } from "./project.js";
import { beyond, sideWay, weave } from "./sheet.js";
import { above, pitch, stack, type Net } from "./tracks.js";
import { grow } from "./tree.js";
import type { Sheet } from "./types.js";

const leaf = (id: string, w = 120, h = 64): Box => ({ id, w, h });
const group = (boxes: Box[], over: Partial<Group> = {}): Group => ({
  dir: "down", pad: { top: 32, right: 32, bottom: 32, left: 32 }, gap: { lane: 48, rank: 56 }, boxes, pins: new Map(), ...over,
});
const pad = { top: 44, right: 16, bottom: 16, left: 16 };
const box = (id: string, kids: string[], over: Partial<Group> = {}): Box => ({ id, w: 0, h: 0, group: group(kids.map((k) => leaf(`${id}.${k}`)), { pad, ...over }) });
const wire = (s: string) => { const [from, to] = s.split(">"); return { id: s, from, to }; };
const problem = (boxes: Box[], wires: string[], over: Partial<Group> = {}): Problem => ({ root: group(boxes, over), wires: wires.map(wire) });
const pin = (o: Record<string, number>) => ({ pins: new Map(Object.entries(o)) });
const sheets = (p: Problem) => weave(grow(p));
const names = (s: Sheet, row: number) => s.rows[row].map((i) => s.slots[i].kid?.id ?? `${s.slots[i].kind}:${s.slots[i].key}`);
const sheetOf = (all: Sheet[], id: string) => all.find((s) => s.cell.id === id)!;

describe("frame", () => {
  it("exchanges north with west and south with east, and nothing else", () => {
    expect((["n", "s", "e", "w"] as const).map((w) => turn(w, "down", "right"))).toEqual(["w", "e", "s", "n"]);
    expect(turn("n", "right", "right")).toBe("n");
    expect(real(real("e", "right"), "right")).toBe("e");
  });
  it("puts a rightward sheet's u down the page and its v across", () => {
    expect(pagePt("right", { x: 10, y: 20 }, 1, 2)).toEqual({ x: 12, y: 21 });
    expect(pageRect("right", { x: 0, y: 0 }, { x: 1, y: 2, w: 3, h: 4 })).toEqual({ x: 2, y: 1, w: 4, h: 3 });
    expect(framed("right", 120, 64)).toEqual({ u: 64, v: 120 });
  });
  it("rounds to the grid the same way wherever it starts", () => {
    expect([snap(3), snap(4), snap(-4), snap(12)]).toEqual([0, 8, -0, 16]);
    expect(snap(4 + 80) - snap(4)).toBe(80); // a shift by whole steps commutes with rounding: gaps survive
    expect([ceilTo(17, 8), ceilTo(16, 8)]).toEqual([24, 16]);
  });
});

describe("tree", () => {
  const p = problem([box("a", ["x", "y"]), box("b", ["z"]), leaf("lone")], ["a.x>a.y", "a.y>b.z", "a>a.x", "a.x>nowhere", "a>b.z"]);
  const tree = grow(p);
  const path = (id: string) => tree.paths.find((q) => q.wire.id === id)!;
  it("cuts a wire in the container where its two ends part company", () => {
    expect([path("a.x>a.y").lca.id, path("a.x>a.y").a, path("a.x>a.y").b]).toEqual(["a", "a.x", "a.y"]);
    const across = path("a.y>b.z");
    expect([across.lca.id, across.a, across.b]).toEqual(["", "a", "b"]);
    expect([across.from.map((s) => [s.cell.id, s.kid]), across.to.map((s) => [s.cell.id, s.kid])]).toEqual([[["a", "a.y"]], [["b", "b.z"]]]);
  });
  it("lets a wire end at a container itself", () => {
    expect(path("a>b.z").from.map((s) => [s.cell.id, s.kid])).toEqual([["a", null]]);
  });
  it("does not draw a wire one of whose ends holds the other, or is missing", () => {
    expect(tree.skipped).toEqual(["a>a.x", "a.x>nowhere"]);
  });
  it("knows which boxes a wire touches, inside or out", () => {
    expect([tree.wired.has("a"), tree.wired.has("b.z"), tree.wired.has("lone")]).toEqual([true, true, false]);
  });
});

describe("project", () => {
  const chain = (gaps: number[]) => gaps.map((gap, i) => ({ left: i, right: i + 1, gap }));
  it("leaves everything where it wants to be when nothing collides", () => {
    expect(project([0, 100, 300], [1, 1, 1], chain([50, 50]))).toEqual([0, 100, 300]);
  });
  it("splits a collision about its weighted centre", () => {
    expect(project([100, 100], [1, 1], chain([40]))).toEqual([80, 120]);
    expect(project([100, 100], [3, 1], chain([40]))).toEqual([90, 130]);
  });
  it("never reorders, and a heavy variable hardly gives way", () => {
    const out = project([300, 0], [1, 1], chain([10]));
    expect(out[1] - out[0]).toBe(10);
    const held = project([100, 100], [1e9, 1], chain([40]));
    expect(Math.round(held[0])).toBe(100);
  });
  it("joins block to block as far back as it has to", () => {
    expect(project([0, 0, 0], [1, 1, 1], chain([10, 10]))).toEqual([-10, 0, 10]);
  });
  it("holds constraints across rows: two rows sharing one variable", () => {
    // 0 is shared; 1 stands after it in one row, 2 after it in the other
    const out = project([50, 0, 200], [1, 1, 1], [{ left: 0, right: 1, gap: 100 }, { left: 0, right: 2, gap: 100 }]);
    expect(out[1] - out[0]).toBeGreaterThanOrEqual(100);
    expect(out[2] - out[0]).toBeGreaterThanOrEqual(100);
  });
});

describe("tracks", () => {
  const net = (id: string, tops: number[], bots: number[], thick = 0): Net => ({ id, tops, bots, lo: Math.min(...tops, ...bots), hi: Math.max(...tops, ...bots), thick });
  it("shares a track between runs that do not overlap", () => {
    const s = stack([net("a", [0], [50]), net("b", [100], [150])]);
    expect([s.track.get("a"), s.track.get("b"), s.count]).toEqual([0, 0, 1]);
  });
  it("stacks two runs the same way so that they do not cross", () => {
    // both run rightward and overlap: the one further right goes above
    const a = net("a", [0], [100]), b = net("b", [50], [150]);
    expect([above(a, b), above(b, a)]).toEqual([2, 0]);
    const s = stack([a, b]);
    expect(s.track.get("b")).toBeLessThan(s.track.get("a")!);
  });
  it("nests a short go-around inside a long one, both hugging the row above", () => {
    const s = stack([net("long", [0, 300], []), net("short", [100, 200], [])]);
    expect(s.track.get("short")).toBeLessThan(s.track.get("long")!);
  });
  it("never lays one wire's stub along another's", () => {
    // `a` comes down at 100 and `b` goes down from 100: `a` must be the upper
    const s = stack([net("b", [0], [100]), net("a", [100], [200])]);
    expect(s.track.get("a")).toBeLessThan(s.track.get("b")!);
    expect(s.clash).toBeUndefined();
  });
  it("says so when two wires trade places between the same two lines", () => {
    const s = stack([net("a", [0], [100]), net("b", [100], [0])]);
    expect(s.clash?.at).toBeDefined();
  });
  it("sinks a run with no stub upward to the row below", () => {
    const s = stack([net("a", [0], [100]), net("b", [50], [150]), net("side", [], [300])]);
    expect(s.track.get("side")).toBe(s.count - 1);
  });
  it("spaces tracks 16 apart, and wider round a label", () => {
    const nets = [net("a", [0], [100]), net("b", [50], [150], 18)], s = stack(nets);
    const at = pitch(nets, s);
    expect(at[1] - at[0]).toBe(25);
    expect(pitch([net("a", [0], [100]), net("b", [50], [150])], stack([net("a", [0], [100]), net("b", [50], [150])]))).toEqual([0, 16]);
  });
});

describe("sheet", () => {
  it("gives a wire a lane in every rank it passes", () => {
    const [root] = sheets(problem([leaf("a"), leaf("b"), leaf("c")], ["a>b", "b>c", "a>c"]));
    expect(root.R).toBe(3);
    expect(names(root, 2)).toEqual(["b", "lane:a>c"]);
    expect(root.chan.map((c) => c.length)).toEqual([0, 2, 2, 0]);
  });
  it("takes a wire out through the wall facing where it is headed, as a port", () => {
    const all = sheets(problem([box("s", ["x", "y"]), leaf("t")], ["s.x>s.y", "s.x>t"]));
    const s = sheetOf(all, "s");
    expect(names(s, s.R + 1)).toEqual(["port:s.x>t"]);       // t is ranked below s: the south wall
    expect(names(s, 2)).toEqual(["s.y", "lane:s.x>t"]);       // and past s.y on the way
  });
  it("draws a wire that runs upward as one that runs down, marked", () => {
    const [root] = sheets(problem([leaf("a"), leaf("b")], ["b>a"], pin({ a: 0, b: 1 })));
    expect(root.chan[1].map((l) => [root.slots[l.up].kid!.id, root.slots[l.down].kid!.id, l.back])).toEqual([["a", "b", true]]);
  });
  it("runs a same-rank wire straight between neighbours, round under the row otherwise", () => {
    const [near] = sheets(problem([leaf("a"), leaf("b")], ["a>b"], pin({ a: 0, b: 0 })));
    expect([near.flats[0].straight, near.glue.length]).toEqual([true, 1]);
    const [far] = sheets(problem([leaf("a"), leaf("m"), leaf("b")], ["a>b"], { ...pin({ a: 0, m: 0, b: 0 }), held: ["a", "m", "b"] }));
    expect([far.flats[0].straight, far.before.length, far.glue.length]).toEqual([false, 1, 0]);
  });
  it("sends a wire to a side wall straight if its box is last, else by the quieter channel", () => {
    const inner = box("s", ["x", "y", "z"], pin({ "s.x": 0, "s.y": 0, "s.z": 1 }));
    const all = sheets(problem([inner, leaf("t")], ["s.y>s.z", "s.x>t"], pin({ s: 0, t: 0 })));
    const s = sheetOf(all, "s"), side = s.sides[0];
    expect([side.wall, beyond(s, side).map((i) => s.slots[i].kid!.id), sideWay(s, side)]).toEqual(["e", ["s.y"], "over"]); // s.y has a wire below
    const alone = sheetOf(sheets(problem([box("s", ["x"]), leaf("t")], ["s.x>t"], pin({ s: 0, t: 0 }))), "s");
    expect(sideWay(alone, alone.sides[0])).toBe("straight");
  });
  it("stands a box no wire touches after its row-mates, unless the author placed it", () => {
    const row = (held: string[]) => names(sheets(problem([leaf("idle"), leaf("a"), leaf("b")], ["a>b"], { ...pin({ idle: 0, a: 0, b: 1 }), held }))[0], 1);
    expect([row([]), row(["idle", "a"])]).toEqual([["a", "idle"], ["idle", "a"]]);
  });
  it("makes one trunk of a bundle: one lane where they pass together, one link out of the shared box", () => {
    const p = problem([leaf("hub"), leaf("n"), leaf("f1"), leaf("f2")], ["hub>n", "hub>f1", "hub>f2"], pin({ hub: 0, n: 1, f1: 2, f2: 2 }));
    for (const w of p.wires) if (w.to.startsWith("f")) w.bundle = "far";
    const [root] = sheets(p);
    expect(names(root, 2)).toEqual(["n", "lane:far"]);
    expect(root.chan[1].filter((l) => l.key === "far").map((l) => l.wires)).toEqual([["hub>f1", "hub>f2"]]);
    expect(new Set(root.chan[2].map((l) => l.net)).size).toBe(1);
  });
  it("puts a label in the middle gap, or on the lane in the middle rank", () => {
    const p = problem([leaf("a"), leaf("b"), leaf("c")], ["a>b", "b>c", "a>c"]);
    p.wires[0].label = { w: 60, h: 18 }; p.wires[2].label = { w: 40, h: 18 };
    const [root] = sheets(p);
    expect(root.chan[1].find((l) => l.key === "a>b")!.label).toMatchObject({ u: 60, at: "bottom" });
    expect(root.slots.find((x) => x.kind === "lane")!.label).toMatchObject({ u: 40, wire: "a>c" });
  });
});

describe("count", () => {
  it("counts two wires whose ends stand in opposite orders, and no others", () => {
    const crossed = new Count(sheets(problem([leaf("a"), leaf("b"), leaf("x"), leaf("y")], ["a>y", "b>x"])));
    const clear = new Count(sheets(problem([leaf("a"), leaf("b"), leaf("x"), leaf("y")], ["a>x", "b>y", "a>y"])));
    expect([crossed.cross, clear.cross]).toEqual([1, 0]);
  });
  it("places an end at a container by where the wire meets that container's wall", () => {
    // the two wires leave one box and enter one container: they cross only if its ports stand the other way round
    const all = sheets(problem([leaf("a"), box("s", ["x", "y"], pin({ "s.x": 0, "s.y": 0 }))], ["a>s.x", "a>s.y"]));
    expect(new Count(all).cross).toBe(0);
    const s = sheetOf(all, "s");
    s.rows[0].reverse(); s.rows[0].forEach((slot, i) => { s.at[slot] = i; });
    expect(new Count(all).cross).toBe(1); // counted inside the wall — outside, one box's own ports never cross
  });
  it("corrects itself on a swap to what a fresh count says", () => {
    const all = sheets(problem([leaf("a"), leaf("b"), leaf("c"), leaf("x"), leaf("y"), leaf("z")], ["a>z", "b>x", "c>y", "a>x"]));
    const count = new Count(all), t = count.tallies[0];
    count.swap(t, 2, 0); count.swap(t, 2, 1); count.swap(t, 1, 1);
    count.settle();
    const fresh = new Count(all);
    expect([count.cross, Math.round(count.rough)]).toEqual([fresh.cross, Math.round(fresh.rough)]);
  });
  it("counts a wire along a row against the lanes it passes", () => {
    const p = problem([leaf("top"), leaf("a"), leaf("b"), leaf("low")], ["a>b", "top>low"], pin({ top: 0, a: 1, b: 1, low: 2 }));
    const all = sheets(p), root = all[0];
    const lane = root.slots.find((x) => x.kind === "lane")!.i, a = root.slots.find((x) => x.kid?.id === "a")!.i, b = root.slots.find((x) => x.kid?.id === "b")!.i;
    root.rows[2] = [a, lane, b]; root.rows[2].forEach((slot, i) => { root.at[slot] = i; });
    expect(new Count(all).cross).toBe(1);
  });
});

describe("order", () => {
  const xs = (p: Problem) => { const all = sheets(p); const count = order(all); return { all, count }; };
  it("leaves declaration order alone when nothing crosses", () => {
    const { all, count } = xs(problem([leaf("a"), leaf("b"), leaf("x"), leaf("y")], ["a>x", "b>y"]));
    expect([names(all[0], 1), names(all[0], 2), count.cross]).toEqual([["a", "b"], ["x", "y"], 0]);
  });
  it("moves a box to remove a crossing — unless the author placed it", () => {
    expect(xs(problem([leaf("a"), leaf("b"), leaf("x"), leaf("y")], ["a>y", "b>x"])).count.cross).toBe(0);
    const held = xs(problem([leaf("a"), leaf("b"), leaf("x"), leaf("y")], ["a>y", "b>x"], { held: ["a", "b", "x", "y"] }));
    expect([names(held.all[0], 1), names(held.all[0], 2), held.count.cross]).toEqual([["a", "b"], ["x", "y"], 1]);
  });
  it("never lets `columns` interleave", () => {
    const { all } = xs(problem([leaf("a"), leaf("b"), leaf("x"), leaf("y")], ["a>y", "b>x"], { columns: [["a", "x"], ["b", "y"]] }));
    expect([names(all[0], 1), names(all[0], 2)]).toEqual([["a", "b"], ["x", "y"]]);
  });
  it("orders a container's wall for the wires outside it as well as those inside", () => {
    for (const held of [["l", "r"], ["r", "l"]]) {
      const { count } = xs(problem([box("top", ["a", "b"]), ...held.map((o) => leaf(o))], ["top.a>top.b", "top.a>r", "top.b>l"], { held }));
      expect(count.cross).toBe(0);
    }
  });
  it("moves a lane and the port it enters by together", () => {
    const data = box("data", ["db", "cache", "replica"], pin({ "data.db": 0, "data.cache": 0, "data.replica": 1 }));
    const { all, count } = xs(problem([leaf("svc"), data], ["svc>data.db", "svc>data.cache", "svc>data.replica", "data.db>data.replica"]));
    const s = sheetOf(all, "data");
    expect(count.cross).toBe(0);
    expect(names(s, 1)).toEqual(["data.db", "lane:svc>data.replica", "data.cache"]);   // between the two, where it runs straight
    expect(names(s, 0)).toEqual(["port:svc>data.db", "port:svc>data.replica", "port:svc>data.cache"]);
  });
  it("takes a wire that passes several ranks to the other side whole", () => {
    // `a>z` starts right of everything; every lane has to change sides at once
    const { count } = xs(problem([leaf("a"), leaf("b"), leaf("c"), leaf("d"), leaf("z")], ["b>c", "c>d", "a>z", "b>d", "d>z"], pin({ b: 0, a: 0, c: 1, d: 2, z: 3 })));
    expect(count.cross).toBe(0);
  });
});

describe("place", () => {
  const at = (p: Problem) => {
    const all = sheets(p); order(all);
    const s = all[0], w = s.slots.map((x) => x.kid?.w ?? 0);
    const { u } = place(s, { w, bleed: w.map(() => 0), gutter: new Map(), off: () => 0 });
    return (id: string) => u[s.slots.find((x) => x.kid?.id === id || x.key === id)!.i];
  };
  it("stands a box over the middle of the boxes it fans out to", () => {
    const u = at(problem([leaf("p"), leaf("a"), leaf("b"), leaf("c"), leaf("d")], ["p>a", "p>b", "p>c", "p>d"]));
    expect(u("p")).toBe((u("a") + u("d")) / 2);
  });
  it("stands it straight over the middle one of an odd number", () => {
    const u = at(problem([leaf("p"), leaf("a", 200), leaf("b"), leaf("c")], ["p>a", "p>b", "p>c"]));
    expect(u("p")).toBe(u("b"));
  });
  it("keeps a single chain a straight line", () => {
    const u = at(problem([leaf("a", 200), leaf("b"), leaf("c", 160)], ["a>b", "b>c"]));
    expect([u("b"), u("c")]).toEqual([u("a"), u("a")]);
  });
  it("lets the side with more wires decide, whatever feeds the box", () => {
    const u = at(problem([leaf("a"), leaf("b"), leaf("p"), leaf("c1"), leaf("c2")], ["a>p", "a>b", "p>c1", "p>c2"], pin({ a: 0, b: 1, p: 1, c1: 2, c2: 2 })));
    expect(u("p")).toBe((u("c1") + u("c2")) / 2);
  });
  it("sets two children one grid step wider so their parent is exactly between them, on the grid", () => {
    const u = at(problem([leaf("hub"), leaf("l"), leaf("r")], ["hub>l", "hub>r"]));
    expect([(u("r") - u("l")) % 16, u("hub") % 8, u("hub")]).toEqual([0, 0, (u("l") + u("r")) / 2]);
  });
  it("does not let a wire running back up the page lead its box", () => {
    const u = at(problem([leaf("top"), leaf("hub"), leaf("a"), leaf("b"), leaf("c"), leaf("d")],
      ["top>hub", "hub>a", "hub>b", "hub>c", "hub>d", "d>top"], pin({ top: 0, hub: 1, a: 2, b: 2, c: 2, d: 2 })));
    expect(u("d") - u("c")).toBe(168);
  });
  it("keeps row-mates side by side where no wire holds them apart", () => {
    const u = at(problem([leaf("a"), leaf("b"), leaf("idle"), leaf("x")], ["a>x", "b>x"], pin({ a: 0, b: 0, idle: 0, x: 1 })));
    expect(u("idle") - u("b")).toBe(168);
  });
  it("puts aligned boxes on one line and every centre on the grid", () => {
    const u = at(problem([leaf("a", 200), leaf("b"), leaf("c"), leaf("d", 160)], ["a>b", "a>c", "b>d", "c>d"], { aligned: [["a", "c", "d"]] }));
    expect([u("c"), u("d")]).toEqual([u("a"), u("a")]);
    for (const id of ["a", "b", "c", "d"]) expect(u(id) % 8).toBe(0);
  });
  it("keeps each band of `columns` wholly before the next, in every rank", () => {
    const u = at(problem([leaf("a", 240), leaf("b"), leaf("x"), leaf("y")], ["a>x", "b>y"], { columns: [["a", "x"], ["b", "y"]] }));
    expect(u("y") - 60).toBeGreaterThanOrEqual(u("a") + 120);
  });
});

describe("ports", () => {
  const space = { lo: 16, hi: 112, mid: 64 };
  const end = (far: number, meet?: number): End => ({ id: `${far}`, slot: 0, wall: "s", far, meet, at: 0 });
  it("measures the stretch of a wall a wire may land on, 8 px in from each corner and on the grid", () => {
    const [root] = sheets(problem([leaf("a")], []));
    expect(wallspace(root, 0, 96, 120)).toEqual({ lo: 48, hi: 144, mid: 96 });
  });
  it("puts a wall's only wire in the middle, and several evenly about it", () => {
    const one = [end(0)]; settle(one, space);
    const three = [end(0), end(1), end(2)]; settle(three, space);
    expect([one[0].at, three.map((e) => e.at)]).toEqual([64, [32, 64, 96]]);
  });
  it("slides a port to where its wire runs straight, without passing a neighbour", () => {
    const ends = [end(0), end(1, 20), end(2)]; settle(ends, space);
    expect(ends[1].at).toBeLessThan(64);            // toward 20, as far as the first port lets it
    expect(ends[1].at - ends[0].at).toBeGreaterThanOrEqual(16);
    expect(ends[0].at).toBeGreaterThanOrEqual(space.lo);
  });
});

describe("gutter", () => {
  const plan = (labels: number[] = []) => {
    const p = problem([leaf("a"), leaf("b", 120, 96)], ["a>b", "b>a"], pin({ a: 0, b: 0 }));
    labels.forEach((w, i) => { p.wires[i].label = { w, h: 18 }; });
    const [root] = sheets(p);
    return { root, g: gutters(root, [16, 0], () => undefined) };
  };
  it("gives each wire between two neighbours its own level place on both walls", () => {
    const { root, g } = plan();
    const [first, second] = root.flats.map((f) => g.of.get(f)!);
    expect([first.va, second.va]).toEqual([first.vb, second.vb]);
    expect(Math.abs(first.va - second.va)).toBe(16);
    expect(Math.min(first.va, second.va)).toBeGreaterThanOrEqual(16 + 8); // on the shorter box's wall
  });
  it("asks for room for the labels: side by side where they would collide", () => {
    const { root, g } = plan([60, 40]);
    expect(g.room.get(root.flats[0].a)).toBe(12 + 60 + 8 + 40 + 12);
  });
});
