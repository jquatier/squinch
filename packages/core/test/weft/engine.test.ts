// The behavioural spec, on problems small enough to read: each tidiness and
// ordering rule on a handful of boxes — no view, no model, no font. Ported
// from `loom/engine.test.ts`; where REQUIREMENTS §4/§5.5 now override a test
// the change is marked "REQUIREMENTS".
import { describe, it, expect } from "vitest";
import { solve, type Box, type Group, type Problem, type Dir } from "../../src/layout/weft/engine.js";
import type { Side, Wire } from "../../src/layout/weft/contract.js";
import { audit, roomRect, wallAt } from "./legal.js";

// ── the whole engine, on problems small enough to read ───────────────────────
const leaf = (id: string, w = 120, h = 64): Box => ({ id, w, h });
const group = (boxes: Box[], over: Partial<Group> = {}): Group => ({
  dir: "down", pad: { top: 32, right: 32, bottom: 32, left: 32 }, gap: { lane: 48, rank: 56 }, boxes, pins: new Map(), ...over,
});
const wire = (s: string) => { const [from, to] = s.split(">"); return { id: s, from, to }; };
const problem = (boxes: Box[], wires: string[], over: Partial<Group> = {}): Problem => ({ root: group(boxes, over), wires: wires.map(wire) });
const pin = (o: Record<string, number>) => ({ pins: new Map(Object.entries(o)) });

/** How many times two different wires cross. */
const crossed = (s: ReturnType<typeof solve>) => {
  const segs = [...s.wires].flatMap(([id, w]) => w.points.slice(1).map((b, i) => ({ id, a: w.points[i], b })));
  let n = 0;
  for (const h of segs) for (const v of segs)
    if (h.id !== v.id && h.a.y === h.b.y && v.a.x === v.b.x
      && v.a.x > Math.min(h.a.x, h.b.x) && v.a.x < Math.max(h.a.x, h.b.x)
      && h.a.y > Math.min(v.a.y, v.b.y) && h.a.y < Math.max(v.a.y, v.b.y)) n++;
  return n;
};

describe("solve", () => {
  it("stands a box beside a container level with the wire between them", () => {
    // a sideways row inside a zone, and a monitor beside it probing the middle stage:
    // the wire has to pass over the last stage, so it meets the zone's wall high up
    const pad = { top: 48, right: 16, bottom: 16, left: 16 };
    const pipe: Box = { id: "p", w: 0, h: 0, group: group([leaf("p.a"), leaf("p.b"), leaf("p.c")], { dir: "right", pad }) };
    const zone: Box = { id: "z", w: 0, h: 0, group: group([pipe], { pad: { top: 28, right: 24, bottom: 20, left: 24 } }) };
    const s = solve({ root: group([zone, leaf("mon", 160)], pin({ z: 0, mon: 0 })), wires: ["p.a>p.b", "p.b>p.c", "mon>p.b"].map(wire) });
    const mon = s.boxes.get("mon")!, pts = s.wires.get("mon>p.b")!.points;
    expect(pts[0]).toEqual({ x: mon.x, y: mon.y + 32 });      // out of the middle of its wall
    expect(pts[1].y).toBe(pts[0].y);                          // and straight on — no step in the gutter
    expect(pts[1].x).toBeLessThan(s.boxes.get("z")!.x + s.boxes.get("z")!.w); // well inside the zone before it turns
  });

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
    // the author put `mid` between them (`rows [a mid b]`), so it stays there
    const s = solve(problem([leaf("a"), leaf("mid"), leaf("b")], ["a>b"], { ...pin({ a: 0, mid: 0, b: 0 }), held: ["a", "mid", "b"] }));
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
      // REQUIREMENTS §4.4: `sys.x` has two wires down, so it stands between
      // them and both run straight — the old test wanted it over `sys.y` and
      // this wire bent round. What still holds: the wire passes `sys.y` on
      // the side it is headed for.
      const y = s.boxes.get("sys.y")!, pts = s.wires.get("sys.x>o2")!.points;
      const passing = pts.find((p) => p.y > y.y)!.x, o2 = s.boxes.get("o2")!.x, o1 = s.boxes.get("o1")!.x;
      expect(passing >= y.x + y.w || passing <= y.x).toBe(true);
      expect(passing > y.x === o2 > o1).toBe(true);
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
  it("stands a box no wire touches after its row-mates that have one, unless the author placed it", () => {
    const x = (s: ReturnType<typeof solve>, id: string) => s.boxes.get(id)!.x;
    const free = solve(problem([leaf("idle"), leaf("a"), leaf("b")], ["a>b"], pin({ idle: 0, a: 0, b: 1 })));
    expect(x(free, "a")).toBeLessThan(x(free, "idle"));
    const placed = solve(problem([leaf("idle"), leaf("a"), leaf("b")], ["a>b"], { ...pin({ idle: 0, a: 0, b: 1 }), held: ["idle", "a"] }));
    expect(x(placed, "idle")).toBeLessThan(x(placed, "a"));
  });
  it("lines up two containers whose wired boxes were declared on opposite sides", () => {
    const pad = { top: 44, right: 16, bottom: 16, left: 16 };
    const top: Box = { id: "top", w: 0, h: 0, group: group([leaf("top.pg"), leaf("top.mq")], { pad, ...pin({ "top.pg": 0, "top.mq": 0 }) }) };
    const bottom: Box = { id: "bottom", w: 0, h: 0, group: group([leaf("bottom.aks"), leaf("bottom.sql")], { pad, ...pin({ "bottom.aks": 0, "bottom.sql": 0 }) }) };
    const s = solve(problem([top, leaf("sync"), bottom], ["top.pg>sync", "sync>bottom.sql"]));
    expect(s.boxes.get("top")!.x).toBe(s.boxes.get("bottom")!.x);
    for (const w of s.wires.values()) expect(w.points).toHaveLength(2);
  });
  it("keeps two containers joined by several wires in a column", () => {
    // every wire leans a different way; lining up on any one of them would stagger the two
    const pad = { top: 44, right: 16, bottom: 16, left: 16 };
    const row = (id: string) => group(["a", "b", "c"].map((k) => leaf(`${id}.${k}`)), { pad, ...pin({ [`${id}.a`]: 0, [`${id}.b`]: 0, [`${id}.c`]: 0 }), held: ["a", "b", "c"].map((k) => `${id}.${k}`) });
    const s = solve(problem([{ id: "top", w: 0, h: 0, group: row("top") }, { id: "low", w: 0, h: 0, group: row("low") }], ["top.a>low.b", "top.b>low.c", "top.c>low.a"]));
    const mid = (id: string) => s.boxes.get(id)!.x + s.boxes.get(id)!.w / 2;
    expect(Math.abs(mid("top") - mid("low"))).toBeLessThanOrEqual(8);
  });
  it("closes a gap that nothing is holding open", () => {
    // `lone` is fed from outside and tied to nothing else in its row
    const pad = { top: 44, right: 16, bottom: 16, left: 16 };
    const inner: Box = { id: "sys", w: 0, h: 0, group: group([leaf("sys.a"), leaf("sys.b"), leaf("sys.lone"), leaf("sys.z")], { pad, ...pin({ "sys.a": 0, "sys.b": 0, "sys.lone": 0, "sys.z": 1 }) }) };
    const s = solve(problem([leaf("src"), inner], ["src>sys.lone", "sys.a>sys.z", "sys.b>sys.z"]));
    const b = s.boxes.get("sys.b")!, lone = s.boxes.get("sys.lone")!;
    expect(Math.min(Math.abs(lone.x - (b.x + b.w)), Math.abs(b.x - (lone.x + lone.w)))).toBeLessThanOrEqual(56);
  });
  it("does not let a wire running back up the page draw its box out of the row", () => {
    // `hub` feeds four; the last of them also reports back up to `top`
    const s = solve(problem([leaf("top"), leaf("hub"), leaf("a"), leaf("b"), leaf("c"), leaf("d")],
      ["top>hub", "hub>a", "hub>b", "hub>c", "hub>d", "d>top"], pin({ top: 0, hub: 1, a: 2, b: 2, c: 2, d: 2 })));
    const c = s.boxes.get("c")!, d = s.boxes.get("d")!;
    expect(d.x - (c.x + c.w)).toBeLessThanOrEqual(64); // beside its row-mate, not off on its own
  });
  it("keeps a wire that turns inside a titled container clear of the title, and lets a straight one pass", () => {
    const pad = { top: 44, right: 16, bottom: 16, left: 16 };
    const sys = (): Box => ({ id: "sys", w: 0, h: 0, minW: 166, title: { w: 150, h: 34 }, group: group([leaf("sys.x"), leaf("sys.y")], { pad }) });
    // straight down into the first box: it runs on, past the end of the title
    const direct = solve(problem([leaf("a"), sys()], ["a>sys.x", "sys.x>sys.y"]));
    expect(direct.wires.get("a>sys.x")!.points).toHaveLength(2);
    // round the first box to the second: it has to turn, so it comes in right of the title
    const round = solve(problem([leaf("a"), sys()], ["a>sys.y", "sys.x>sys.y"]));
    expect(round.wires.get("a>sys.y")!.points[0].x).toBeGreaterThanOrEqual(round.boxes.get("sys")!.x + 150);
  });
  it("is a pure function", () => {
    const make = () => problem([leaf("a"), leaf("b"), leaf("c"), leaf("d")], ["a>b", "a>c", "b>d", "c>d", "a>d"]);
    expect(JSON.stringify([...solve(make()).wires])).toBe(JSON.stringify([...solve(make()).wires]));
  });
});

describe("ordering the whole picture", () => {
  const pad = { top: 44, right: 16, bottom: 16, left: 16 };
  it("moves a wire and the port it enters by together, when neither could move alone", () => {
    // `svc` writes to `db` and `cache`, and reads from `replica` below them.
    // Run round the end of the row the read crosses nothing either — but
    // between the two it runs straight. Getting there takes two changes at
    // once: its port on the wall, and its place in the row.
    const data: Box = { id: "data", w: 0, h: 0, group: group([leaf("data.db"), leaf("data.cache"), leaf("data.replica")], { pad, ...pin({ "data.db": 0, "data.cache": 0, "data.replica": 1 }) }) };
    const s = solve(problem([leaf("svc"), data], ["svc>data.db", "svc>data.cache", "svc>data.replica", "data.db>data.replica"]));
    const read = s.wires.get("svc>data.replica")!.points, db = s.boxes.get("data.db")!, cache = s.boxes.get("data.cache")!;
    const passing = read.find((q) => q.y > db.y && q.y < db.y + db.h) ?? read.find((q) => q.y >= db.y + db.h)!;
    expect(passing.x).toBeGreaterThan(db.x + db.w);   // between the two…
    expect(passing.x).toBeLessThan(cache.x);
    expect(crossed(s)).toBe(0);                       // …crossing nothing
  });
  it("orders a container's wall for the wires outside it as well as those inside", () => {
    // inside `top` nothing prefers either order; outside, the wires to `l` and `r` do
    const top: Box = { id: "top", w: 0, h: 0, group: group([leaf("top.a"), leaf("top.b")], { pad }) };
    for (const order of [["l", "r"], ["r", "l"]]) {
      const s = solve(problem([top, ...order.map((o) => leaf(o))], ["top.a>top.b", "top.a>r", "top.b>l"], { held: order }));
      expect(crossed(s)).toBe(0);
    }
  });
});

// ── the two contract extensions ──────────────────────────────────────────────
describe("room beside a box", () => {
  const roomy = (id: string, room: Box["room"], w = 120, h = 64): Box => ({ id, w, h, room });
  const rectOf = (s: ReturnType<typeof solve>, id: string) => s.boxes.get(id)!;
  // a parent over two children, the first with room on one side; a third box beside them, wired to nothing
  const fan = (side: Side, dir: Dir = "down") =>
    problem([leaf("p"), roomy("a", { [side]: 80 }), leaf("b"), leaf("c")], ["p>a", "p>b", "p>c"], { dir });

  for (const dir of ["down", "right"] as const)
    for (const side of ["north", "south", "east", "west"] as const)
      it(`keeps the room ${side} of a box clear, in a ${dir}ward container`, () => {
        const p = fan(side, dir), s = solve(p);
        expect(audit(p, s)).toEqual([]);
        const a = rectOf(s, "a"), room = roomRect(a, side, 80);
        // inside the canvas: the container's walls stay outside the room
        expect([room.x >= 0, room.y >= 0, room.x + room.w <= s.width, room.y + room.h <= s.height]).toEqual([true, true, true, true]);
        // the box is the box: its size is its own
        expect([a.w, a.h]).toEqual([120, 64]);
      });

  it("keeps a neighbour out of it", () => {
    const plain = solve(problem([leaf("a"), leaf("b")], ["a>b"], pin({ a: 0, b: 0 })));
    const p = problem([roomy("a", { east: 80 }), leaf("b")], ["a>b"], pin({ a: 0, b: 0 })), s = solve(p);
    const gap = (x: ReturnType<typeof solve>) => rectOf(x, "b").x - (rectOf(x, "a").x + 120);
    expect(gap(plain)).toBe(48);
    expect(gap(s)).toBe(80 + 48);                      // the room, and then the gap any two neighbours keep
    expect(audit(p, s)).toEqual([]);
  });
  it("keeps the next rank, and the tracks between, out of room below a box", () => {
    const p = problem([roomy("a", { south: 80 }), leaf("x"), leaf("b"), leaf("c")], ["a>b", "x>c", "x>b", "a>c"]), s = solve(p);
    expect(audit(p, s)).toEqual([]);
    expect(rectOf(s, "b").y - (rectOf(s, "a").y + 64)).toBeGreaterThanOrEqual(80 + 56);
    expect(rectOf(s, "x").y).toBe(rectOf(s, "a").y);   // row-mates keep one line
  });
  it("lets the box's own wire cross the room straight", () => {
    const p = problem([roomy("a", { south: 80 }), leaf("b")], ["a>b"]), s = solve(p);
    const a = rectOf(s, "a"), pts = s.wires.get("a>b")!.points;
    expect(pts[0]).toEqual({ x: a.x + 60, y: a.y + 64 });
    expect(pts[1].x).toBe(pts[0].x);
    expect(pts[1].y).toBeGreaterThanOrEqual(a.y + 64 + 80);
    const q = problem([roomy("a", { east: 80 }), leaf("b")], ["a>b"], pin({ a: 0, b: 0 })), t = solve(q);
    expect(t.wires.get("a>b")!.points).toHaveLength(2); // straight across room and gutter
    expect(audit(q, t)).toEqual([]);
  });
  it("leaves the box on the middle of its fan: the room is not part of it", () => {
    for (const side of ["east", "west", "north", "south"] as const) {
      const s = solve(problem([leaf("p"), leaf("l"), roomy("m", { [side]: 96 }), leaf("r")], ["p>l", "p>m", "p>r"]));
      const mid = (id: string) => rectOf(s, id).x + 60;
      expect(mid("p")).toBe(mid("m"));                   // straight over the middle one of three
      const t = solve(problem([roomy("p", { [side]: 96 }), leaf("l"), leaf("r")], ["p>l", "p>r"]));
      const at = (id: string) => rectOf(t, id).x + 60;
      expect(at("p")).toBe((at("l") + at("r")) / 2);     // and a box with room of its own stands between its two
    }
  });
  it("takes the deeper of a card's sheets and the room below it", () => {
    const depth = (box: Box) => { const s = solve(problem([box, leaf("b")], ["a>b"])); return rectOf(s, "b").y - (rectOf(s, "a").y + 64); };
    expect(depth({ id: "a", w: 120, h: 64, bleed: 12, room: { south: 40 } })).toBe(depth({ id: "a", w: 120, h: 64, room: { south: 40 } }));
    expect(depth({ id: "a", w: 120, h: 64, bleed: 12 })).toBe(56);
  });
  it("changes nothing where no box asks for room", () => {
    const make = (room?: Box["room"]) => solve(problem([{ ...leaf("a"), room }, leaf("b"), leaf("c")], ["a>b", "a>c"]));
    expect(JSON.stringify([...make({}).boxes, ...make({}).wires])).toBe(JSON.stringify([...make().boxes, ...make().wires]));
  });
});

describe("sides a wire is asked to use", () => {
  const two = (hint: Partial<Wire>, over: Partial<Group> = {}): Problem => ({ root: group([leaf("a"), leaf("b")], over), wires: [{ id: "ab", from: "a", to: "b", ...hint }] });
  const cases: [string, Partial<Wire>, "from" | "to", Side][] = [
    ["from east", { fromSide: "east" }, "from", "east"], ["from west", { fromSide: "west" }, "from", "west"],
    ["to east", { toSide: "east" }, "to", "east"], ["to west", { toSide: "west" }, "to", "west"],
    ["from north, against the flow", { fromSide: "north" }, "from", "north"], ["to south, against the flow", { toSide: "south" }, "to", "south"],
  ];
  for (const [name, hint, end, side] of cases)
    it(`draws a wire ${name}, the long way round`, () => {
      const p = two(hint), s = solve(p), pts = s.wires.get("ab")!.points;
      expect(audit(p, s)).toEqual([]);                  // legal, and by the wall asked
      expect(s.unhonoured).toBeUndefined();
      const [at, next, box] = end === "from" ? [pts[0], pts[1], s.boxes.get("a")!] : [pts[pts.length - 1], pts[pts.length - 2], s.boxes.get("b")!];
      expect(wallAt(box, at)).toBe(side);
      expect(Math.abs(next.x - at.x) + Math.abs(next.y - at.y)).toBeGreaterThanOrEqual(16); // straight out before it turns
      // the other end is untouched: out of the bottom of `a`, or into the top of `b`
      expect(end === "from" ? wallAt(s.boxes.get("b")!, pts[pts.length - 1]) : wallAt(s.boxes.get("a")!, pts[0])).toBe(end === "from" ? "north" : "south");
    });
  it("takes both ends round at once", () => {
    const p = two({ fromSide: "west", toSide: "east" }), s = solve(p), pts = s.wires.get("ab")!.points;
    expect(audit(p, s)).toEqual([]);
    expect([wallAt(s.boxes.get("a")!, pts[0]), wallAt(s.boxes.get("b")!, pts[pts.length - 1])]).toEqual(["west", "east"]);
  });
  it("reads the sides as screen sides in a rightward container", () => {
    for (const [hint, end, side] of [[{ fromSide: "south" }, "from", "south"], [{ toSide: "north" }, "to", "north"], [{ fromSide: "west" }, "from", "west"], [{ toSide: "east" }, "to", "east"]] as [Partial<Wire>, string, Side][]) {
      const p = two(hint, { dir: "right" }), s = solve(p), pts = s.wires.get("ab")!.points;
      expect(audit(p, s)).toEqual([]);
      expect(end === "from" ? wallAt(s.boxes.get("a")!, pts[0]) : wallAt(s.boxes.get("b")!, pts[pts.length - 1])).toBe(side);
    }
  });
  it("changes nothing for the natural side", () => {
    const plain = solve(two({})), asked = solve(two({ fromSide: "south", toSide: "north" }));
    expect(JSON.stringify([...asked.boxes, ...asked.wires])).toBe(JSON.stringify([...plain.boxes, ...plain.wires]));
    expect(asked.unhonoured).toBeUndefined();
  });
  it("ignores the side between two row-mates", () => {
    const plain = solve(two({}, pin({ a: 0, b: 0 }))), asked = solve(two({ fromSide: "north", toSide: "south" }, pin({ a: 0, b: 0 })));
    expect(asked.wires.get("ab")!.points).toEqual(plain.wires.get("ab")!.points);
    expect(asked.unhonoured).toBeUndefined();          // the caller warns: it can see they are row-mates
  });
  it("keeps the hook's lane beside its box while the box is moved to uncross", () => {
    const p: Problem = { root: group([leaf("a"), leaf("b"), leaf("x"), leaf("y")]), wires: [{ id: "ay", from: "a", to: "y", fromSide: "east" }, { id: "bx", from: "b", to: "x", toSide: "west" }] };
    const s = solve(p);
    expect(audit(p, s)).toEqual([]);
    expect(crossed(s)).toBe(0);
  });
  it("works through a container's wall, on the leaf inside", () => {
    const inner: Box = { id: "sys", w: 0, h: 0, group: group([leaf("sys.x"), leaf("sys.y")], { pad: { top: 44, right: 16, bottom: 16, left: 16 } }) };
    const p: Problem = { root: group([leaf("a"), inner]), wires: [{ id: "in", from: "a", to: "sys.x", toSide: "east" }, wire("sys.x>sys.y")] };
    const s = solve(p), pts = s.wires.get("in")!.points;
    expect(audit(p, s)).toEqual([]);
    expect(wallAt(s.boxes.get("sys.x")!, pts[pts.length - 1])).toBe("east");
  });
  it("falls back to the natural side, and says so, where the hook cannot be drawn", () => {
    // a wire of a bundle shares its port and its lanes: it cannot go round on its own
    const p = problem([leaf("hub"), leaf("x"), leaf("y")], ["hub>x", "hub>y"]);
    for (const w of p.wires) w.bundle = "trunk";
    p.wires[0].fromSide = "east";
    const s = solve(p);
    expect(s.unhonoured).toEqual([{ wire: "hub>x", end: "from", why: "trunk" }]);
    expect(wallAt(s.boxes.get("hub")!, s.wires.get("hub>x")!.points[0])).toBe("south");
    expect(audit(p, s)).toEqual([]);
    // the far wall of a box whose wire leaves its container sideways
    const inner: Box = { id: "sys", w: 0, h: 0, group: group([leaf("sys.x")], { pad: { top: 44, right: 16, bottom: 16, left: 16 } }) };
    const q: Problem = { root: group([inner, leaf("t")], pin({ sys: 0, t: 0 })), wires: [{ id: "out", from: "sys.x", to: "t", fromSide: "west" }] };
    const t = solve(q);
    expect(t.unhonoured).toEqual([{ wire: "out", end: "from", why: "far", by: "east", open: ["north", "south"] }]);
    expect(audit(q, t)).toEqual([]);
    // …told in screen sides: in a container that flows rightward, the ways over and under the row are west and east
    const turned: Box = { id: "sys", w: 0, h: 0, group: group([leaf("sys.x"), leaf("sys.y")], { dir: "right", pad: { top: 44, right: 16, bottom: 16, left: 16 }, ...pin({ "sys.x": 0, "sys.y": 0 }) }) };
    const v: Problem = { root: group([turned, leaf("t")], { dir: "right", ...pin({ sys: 0, t: 0 }) }), wires: [{ id: "out", from: "sys.x", to: "t", fromSide: "north" }] };
    expect(solve(v).unhonoured).toEqual([{ wire: "out", end: "from", why: "far", by: "south", open: ["west", "east"] }]);
    // a box in one rank with the container the other end is in: the wire runs along the rank
    const m: Problem = { root: group([leaf("u"), { ...inner, id: "sys" }], pin({ u: 0, sys: 0 })), wires: [{ id: "in", from: "u", to: "sys.x", fromSide: "south" }] };
    expect(solve(m).unhonoured).toEqual([{ wire: "in", end: "from", why: "row", mate: "sys" }]);
    // …and so does a container the wire ends at, beside the container the other end is in
    const cd: Problem = { root: group([{ ...inner, id: "sys" }, { id: "d", w: 0, h: 0, group: group([leaf("d.y")], { pad: { top: 44, right: 16, bottom: 16, left: 16 } }) }], pin({ sys: 0, d: 0 })), wires: [{ id: "over", from: "sys", to: "d.y", fromSide: "north" }] };
    const drawn = solve(cd);
    expect(drawn.unhonoured).toEqual([{ wire: "over", end: "from", why: "row", mate: "d" }]);
    expect(audit(cd, drawn)).toEqual([]);
  });

  // ── the side carries on through the walls of the containers around the box ──
  const pad = { top: 44, right: 16, bottom: 16, left: 16 };
  const sys = (boxes: Box[], over: Partial<Group> = {}, id = "sys"): Box => ({ id, w: 0, h: 0, group: group(boxes, { pad, ...over }) });
  /** The wall of `box` a wire crosses on its way between a point inside and one outside. */
  const crosses = (s: ReturnType<typeof solve>, box: string, wireId: string): Side | undefined => {
    const r = s.boxes.get(box)!, pts = s.wires.get(wireId)!.points;
    const inside = (q: { x: number; y: number }) => q.x > r.x && q.x < r.x + r.w && q.y > r.y && q.y < r.y + r.h;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [a, b] = inside(pts[i]) ? [pts[i], pts[i + 1]] : [pts[i + 1], pts[i]];
      if (!inside(a) || inside(b)) continue;
      return b.x >= r.x + r.w ? "east" : b.x <= r.x ? "west" : b.y <= r.y ? "north" : "south";
    }
    return undefined;
  };
  it("carries the side through a container's wall while the box has a clear run to it", () => {
    for (const side of ["east", "west"] as Side[]) {
      const p: Problem = { root: group([sys([leaf("sys.x"), leaf("sys.y")]), leaf("t")]), wires: [wire("sys.x>sys.y"), { id: "out", from: "sys.x", to: "t", fromSide: side }] };
      const s = solve(p);
      expect(audit(p, s)).toEqual([]);
      expect(s.unhonoured).toBeUndefined();
      expect(wallAt(s.boxes.get("sys.x")!, s.wires.get("out")!.points[0])).toBe(side);
      expect(crosses(s, "sys", "out")).toBe(side);
    }
    // into a container, by the wall its box was asked to be entered by
    const q: Problem = { root: group([leaf("a"), sys([leaf("sys.x"), leaf("sys.y")])]), wires: [wire("sys.x>sys.y"), { id: "in", from: "a", to: "sys.x", toSide: "east" }] };
    const t = solve(q);
    expect(audit(q, t)).toEqual([]);
    expect(crosses(t, "sys", "in")).toBe("east");
  });
  it("carries it through every container on the way out, past whatever stands in the row", () => {
    const deep = (inner: Box[], over: Partial<Group> = {}): Problem => ({
      root: group([sys([sys(inner, over, "sys.in"), leaf("sys.z")], pin({ "sys.in": 0, "sys.z": 1 })), leaf("t")]),
      wires: [{ id: "out", from: "sys.in.x", to: "t", fromSide: "east" }],
    });
    const p = deep([leaf("sys.in.x")]), s = solve(p);
    expect(audit(p, s)).toEqual([]);
    expect([crosses(s, "sys.in", "out"), crosses(s, "sys", "out")]).toEqual(["east", "east"]);
    // a row-mate east of the box: the wire leaves by the east all the same, goes over or under it, and out of both east walls
    const q = deep([leaf("sys.in.x"), leaf("sys.in.y")], pin({ "sys.in.x": 0, "sys.in.y": 0 })), t = solve(q);
    expect(audit(q, t)).toEqual([]);
    expect(wallAt(t.boxes.get("sys.in.x")!, t.wires.get("out")!.points[0])).toBe("east");
    expect([crosses(t, "sys.in", "out"), crosses(t, "sys", "out")]).toEqual(["east", "east"]);
    expect(t.unhonoured).toBeUndefined();
    // …a container with a row-mate east of it, likewise: out of its east wall, round the row-mate, out of the one around it
    const r: Problem = { root: group([sys([sys([leaf("s.k.x")], {}, "s.k"), leaf("s.y")], pin({ "s.k": 0, "s.y": 0 }), "s"), leaf("t")]), wires: [{ id: "out", from: "s.k.x", to: "t", fromSide: "east" }] };
    const u = solve(r);
    expect(audit(r, u)).toEqual([]);
    expect([crosses(u, "s.k", "out"), crosses(u, "s", "out")]).toEqual(["east", "east"]);
  });
  it("turns a wire asked back against its way beside the innermost box it can", () => {
    // north, for a wire headed down: from a box with nothing above it, out of the container's north wall and round the container…
    const top: Problem = { root: group([sys([leaf("s.a"), leaf("s.b")], pin({ "s.a": 0, "s.b": 1 }), "s"), leaf("t")]), wires: [wire("s.a>s.b"), { id: "out", from: "s.a", to: "t", fromSide: "north" }] };
    const u = solve(top);
    expect(audit(top, u)).toEqual([]);
    expect(wallAt(u.boxes.get("s.a")!, u.wires.get("out")!.points[0])).toBe("north");
    expect(crosses(u, "s", "out")).toBe("north");
    // …but from a box in a lower rank, round the box: it does not climb past the rank above to go round the whole container
    const low: Problem = { root: top.root, wires: [wire("s.a>s.b"), { id: "out", from: "s.b", to: "t", fromSide: "north" }] };
    const v = solve(low);
    expect(audit(low, v)).toEqual([]);
    expect(wallAt(v.boxes.get("s.b")!, v.wires.get("out")!.points[0])).toBe("north");
    expect(crosses(v, "s", "out")).toBe("south");
    expect(v.unhonoured).toBeUndefined();
  });
  it("gives a wire that ends at a container the wall of it that was asked", () => {
    const p: Problem = { root: group([sys([leaf("sys.x")]), leaf("t")]), wires: [{ id: "out", from: "sys", to: "t", fromSide: "east" }, { id: "back", from: "t", to: "sys", toSide: "west" }] };
    const s = solve(p);
    expect(audit(p, s)).toEqual([]);
    expect(s.unhonoured).toBeUndefined();
    expect(wallAt(s.boxes.get("sys")!, s.wires.get("out")!.points[0])).toBe("east");
    const back = s.wires.get("back")!.points;
    expect(wallAt(s.boxes.get("sys")!, back[back.length - 1])).toBe("west");
    // …also where that wall carries a wire straight across to a neighbour: a side wall takes one more
    const q: Problem = { root: group([sys([leaf("sys.x")]), leaf("n"), leaf("t")], pin({ sys: 0, n: 0, t: 1 })), wires: [wire("sys>n"), { id: "out", from: "sys", to: "t", fromSide: "east" }] };
    const t = solve(q);
    expect(audit(q, t)).toEqual([]);
    expect(t.unhonoured).toBeUndefined();
    expect(wallAt(t.boxes.get("sys")!, t.wires.get("out")!.points[0])).toBe("east");
    expect(crossed(t)).toBe(0);
  });
  // ── a side wall takes any number of wires, of any kind (`sides.ts`) ─────────
  /** The level a wire meets `box` at, on the wall it uses there. */
  const levelAt = (s: ReturnType<typeof solve>, id: string, box: string): number => { const pts = s.wires.get(id)!.points, r = s.boxes.get(box)!; const on = (q: { x: number; y: number }) => q.x === r.x || q.x === r.x + r.w; return on(pts[0]) ? pts[0].y : pts[pts.length - 1].y; };
  it("shares a side wall between a wire straight across to a neighbour and a wire asked out of it", () => {
    // 0.21.0 refused the second: the wall was "taken"
    const p: Problem = { root: group([leaf("a"), leaf("c"), leaf("b")], pin({ a: 0, c: 0, b: 1 })), wires: [wire("a>c"), { id: "ab", from: "a", to: "b", fromSide: "east" }] };
    const s = solve(p);
    expect(audit(p, s)).toEqual([]);
    expect(s.unhonoured).toBeUndefined();
    expect(wallAt(s.boxes.get("a")!, s.wires.get("ab")!.points[0])).toBe("east");
    expect(crossed(s)).toBe(0);
    // the wire that goes on down stands below the one straight across, a step apart
    expect(levelAt(s, "ab", "a") - levelAt(s, "a>c", "a")).toBe(16);
  });
  it("orders a side wall so that none of its wires crosses another: lanes that come down above, straight wires between, lanes that go down below", () => {
    // t arrives at a's east wall from the row above; a→r runs straight across; a→d leaves by the east and goes down
    const p: Problem = { root: group([leaf("t"), leaf("a"), leaf("r"), leaf("d")], pin({ t: 0, a: 1, r: 1, d: 2 })), wires: [{ id: "in", from: "t", to: "a", toSide: "east" }, wire("a>r"), { id: "out", from: "a", to: "d", fromSide: "east" }] };
    const s = solve(p);
    expect(audit(p, s)).toEqual([]);
    expect(s.unhonoured).toBeUndefined();
    const [arrives, across, leaves] = [levelAt(s, "in", "a"), levelAt(s, "a>r", "a"), levelAt(s, "out", "a")];
    expect(arrives).toBeLessThan(across);
    expect(across).toBeLessThan(leaves);
    expect(crossed(s)).toBe(0);
  });
  it("nests two wires that arrive at one side wall from the row above: the nearer lane's wire the higher", () => {
    const p: Problem = { root: group([leaf("t"), leaf("u"), leaf("a"), leaf("r")], pin({ t: 0, u: 0, a: 1, r: 1 })), wires: [{ id: "t", from: "t", to: "a", toSide: "east" }, { id: "u", from: "u", to: "a", toSide: "east" }, wire("a>r")] };
    const s = solve(p);
    expect(audit(p, s)).toEqual([]);
    expect(s.unhonoured).toBeUndefined();
    const lane = (id: string) => { const pts = s.wires.get(id)!.points; return pts[pts.length - 2].x; };
    const [near, far] = lane("t") < lane("u") ? ["t", "u"] : ["u", "t"];
    expect(levelAt(s, near, "a")).toBeLessThan(levelAt(s, far, "a"));
    expect(levelAt(s, far, "a")).toBeLessThan(levelAt(s, "a>r", "a"));
    expect(crossed(s)).toBe(0);
  });
  it("keeps room on a side wall for its hooks: the wires straight across stand clear of them by a step", () => {
    // three wires between a and c fill a 64 px wall at a step apart; the fourth arrives from above and has the top of it
    const p: Problem = { root: group([leaf("t"), leaf("a"), leaf("c")], pin({ t: 0, a: 1, c: 1 })), wires: [{ id: "in", from: "t", to: "a", toSide: "east" }, { id: "f1", from: "a", to: "c" }, { id: "f2", from: "c", to: "a" }, { id: "f3", from: "a", to: "c" }] };
    const s = solve(p);
    expect(audit(p, s)).toEqual([]);
    const levels = ["in", "f1", "f2", "f3"].map((id) => levelAt(s, id, "a")).sort((x, y) => x - y);
    expect(levels[0]).toBe(levelAt(s, "in", "a"));
    expect(levels.slice(1).map((v, i) => v - levels[i])).toEqual([16, 16, 16]);
  });
  it("orders a container's side wall the same way: a wire taken over the row outside stands above one straight across", () => {
    // in.x → t leaves `in` by its east wall and goes over big.m; in.x → big.m runs straight across below it
    const inner = sys([leaf("in.x")], {}, "in");
    const big = sys([inner, leaf("big.m"), leaf("big.low")], pin({ in: 0, "big.m": 0, "big.low": 1 }), "big");
    const p: Problem = { root: group([big, leaf("t")], pin({ big: 0, t: 0 })), wires: [wire("in.x>big.m"), { id: "out", from: "in.x", to: "t", fromSide: "east" }, wire("big.m>big.low")] };
    const s = solve(p);
    expect(audit(p, s)).toEqual([]);
    expect(s.unhonoured).toBeUndefined();
    for (const box of ["in.x", "in", "big"]) expect(crosses(s, box, "out") ?? wallAt(s.boxes.get(box)!, s.wires.get("out")!.points[0])).toBe("east");
    expect(levelAt(s, "out", "in.x")).toBeLessThan(levelAt(s, "in.x>big.m", "in.x"));
    expect(crossed(s)).toBe(0);
  });
  it("does not slide a port along a wall that also carries a hook", () => {
    // x → z would come in level with z's port by sliding 16 px down x's wall — onto the wire hooked out of it to y
    const s1: Box = sys([leaf("s1.x"), leaf("s1.y")], pin({ "s1.x": 0, "s1.y": 1 }), "s1");
    const s2: Box = { id: "s2", w: 0, h: 0, group: group([leaf("s2.z", 120, 24), leaf("s2.q")], { pad: { ...pad, top: 52 } }) };
    const p: Problem = { root: group([s1, s2], pin({ s1: 0, s2: 0 })), wires: [wire("s1.x>s2.z"), { id: "h", from: "s1.x", to: "s1.y", fromSide: "east" }, wire("s1.y>s2.q")] };
    const s = solve(p);
    expect(audit(p, s)).toEqual([]);
    expect(levelAt(s, "h", "s1.x") - levelAt(s, "s1.x>s2.z", "s1.x")).toBe(16);
  });
  it("nests several wires asked out of one side wall: the nearer lane's wire nearer the middle of the wires that go on down", () => {
    const p: Problem = { root: group([sys([leaf("s.x")], {}, "s"), leaf("a"), leaf("b"), leaf("c"), leaf("d")], pin({ s: 0, a: 1, b: 1, c: 1, d: 1 })), wires: ["a", "b"].map((t) => ({ id: t, from: "s.x", to: t, fromSide: "west" as Side })).concat(["c", "d"].map((t) => ({ id: t, from: "s.x", to: t, fromSide: "east" as Side }))) };
    const s = solve(p);
    expect(audit(p, s)).toEqual([]);
    expect(s.unhonoured).toBeUndefined();
    for (const id of ["a", "b"]) expect([wallAt(s.boxes.get("s.x")!, s.wires.get(id)!.points[0]), crosses(s, "s", id)]).toEqual(["west", "west"]);
    for (const id of ["c", "d"]) expect([wallAt(s.boxes.get("s.x")!, s.wires.get(id)!.points[0]), crosses(s, "s", id)]).toEqual(["east", "east"]);
    expect(crossed(s)).toBe(0);
  });
  it("holds more wires than a side wall has steps for, each at a place of its own", () => {
    const targets = ["a", "b", "c", "d", "e", "f"];
    const p: Problem = { root: group([leaf("x"), ...targets.map((t) => leaf(t))], pin({ x: 0, ...Object.fromEntries(targets.map((t) => [t, 1])) })), wires: targets.map((t) => ({ id: t, from: "x", to: t, fromSide: "east" as Side })) };
    const s = solve(p);
    expect(audit(p, s)).toEqual([]);
    expect(s.unhonoured).toBeUndefined();
    expect(new Set(targets.map((t) => levelAt(s, t, "x"))).size).toBe(6); // six wires on a wall with room for four at a step apart
    expect(crossed(s)).toBe(0);
  });
  it("takes a wire out of a north wall round a side that a straight wire leaves by, when both sides have one", () => {
    // 0.21.0 refused: no side to go round by. The lane now stands in a gutter, and the wire it crosses there is counted.
    const p: Problem = { root: group([leaf("l"), leaf("a"), leaf("c"), leaf("b")], pin({ l: 0, a: 0, c: 0, b: 1 })), wires: [wire("l>a"), wire("a>c"), { id: "ab", from: "a", to: "b", fromSide: "north" }] };
    const s = solve(p);
    expect(audit(p, s)).toEqual([]);
    expect(s.unhonoured).toBeUndefined();
    expect(wallAt(s.boxes.get("a")!, s.wires.get("ab")!.points[0])).toBe("north");
    expect(crossed(s)).toBe(1);
  });
  it("carries a side through a container's wall that already carries a wire, and the box's own side beside the wire that carried", () => {
    // the container's east wall has the wire straight across to n, and now sys.x's too
    const p: Problem = { root: group([sys([leaf("sys.x")]), leaf("n"), leaf("t")], pin({ sys: 0, n: 0, t: 1 })), wires: [wire("sys>n"), { id: "out", from: "sys.x", to: "t", fromSide: "east" }] };
    const s = solve(p);
    expect(audit(p, s)).toEqual([]);
    expect(s.unhonoured).toBeUndefined();
    expect(wallAt(s.boxes.get("sys.x")!, s.wires.get("out")!.points[0])).toBe("east");
    expect(crosses(s, "sys", "out")).toBe("east");
    // two wires asked out of one side of a box, one to a box below and one to a row-mate inside: both by that side
    // (0.21.0 gave both and turned both inside; the version between refused the second)
    const q: Problem = { root: group([sys([leaf("s.x"), leaf("s.y")], pin({ "s.x": 0, "s.y": 1 }), "s"), leaf("t")]), wires: [{ id: "in", from: "s.x", to: "s.y", fromSide: "west" }, { id: "out", from: "s.x", to: "t", fromSide: "west" }] };
    const t = solve(q);
    expect(audit(q, t)).toEqual([]);
    expect(t.unhonoured).toBeUndefined();
    for (const id of ["in", "out"]) expect(wallAt(t.boxes.get("s.x")!, t.wires.get(id)!.points[0])).toBe("west");
    expect(crosses(t, "s", "out")).toBe("west");
    expect(crossed(t)).toBe(0);
  });
  it("takes a container that leaves its own container sideways over the row, when its box was asked for the north", () => {
    // s and t stand in one rank, so the wire leaves s by its east wall; inside, k is not last in its row
    const inside = (hint: Partial<Wire>): Problem => ({
      root: group([sys([sys([leaf("s.k.x")], {}, "s.k"), leaf("s.y")], pin({ "s.k": 0, "s.y": 0 }), "s"), leaf("t")], pin({ s: 0, t: 0 })),
      wires: [{ id: "out", from: "s.k.x", to: "t", ...hint }],
    });
    const plain = solve(inside({})), asked = solve(inside({ fromSide: "north" }));
    expect(crosses(plain, "s.k", "out")).toBe("south");   // in the first rank a tie goes under: over is where the title is
    expect(audit(inside({ fromSide: "north" }), asked)).toEqual([]);
    expect(crosses(asked, "s.k", "out")).toBe("north");
    expect(asked.unhonoured).toBeUndefined();
    // a wire that ends at that container is the box named: its far wall is reported; its near wall, with a row-mate before it, is given
    const ends = (side: Side): Problem => ({ root: inside({}).root, wires: [{ id: "out", from: "s.k", to: "t", fromSide: side }] });
    expect(solve(ends("west")).unhonoured).toEqual([{ wire: "out", end: "from", why: "far", by: "east", open: ["north", "south"] }]);
    const near = solve(ends("east"));
    expect(audit(ends("east"), near)).toEqual([]);
    expect(near.unhonoured).toBeUndefined();
    expect(wallAt(near.boxes.get("s.k")!, near.wires.get("out")!.points[0])).toBe("east");
  });
  it("brings two wires asked of one wall of a container in at places that keep their order, through a container of the other direction", () => {
    // c flows down inside g, which flows rightward: its east wall lies along g's last row
    const g: Box = { id: "g", w: 0, h: 0, group: group([sys([leaf("g.c.x")], {}, "g.c")], { dir: "right", pad }) };
    for (const hints of [[{ toSide: "east" }, { toSide: "east" }], [{ toSide: "west" }, { toSide: "west" }]] as Partial<Wire>[][]) {
      const p: Problem = { root: group([leaf("a"), leaf("b"), g], pin({ a: 0, b: 0, g: 1 })), wires: [{ id: "a>c", from: "a", to: "g.c", ...hints[0] }, { id: "b>c", from: "b", to: "g.c", ...hints[1] }] };
      expect(audit(p, solve(p))).toEqual([]);          // …and not along one line, which they were
    }
  });
  it("puts the port of a wire hooked round a container at the end of the wall its lane stands beside", () => {
    // c's three wires share the north wall of its container: the one hooked round to b must not cross the two coming in
    const p: Problem = { root: group([leaf("x"), leaf("y"), sys([leaf("s.c")], {}, "s"), leaf("a"), leaf("b")], pin({ x: 0, y: 0, s: 1, a: 2, b: 2 })), wires: [wire("x>s.c"), wire("y>s.c"), wire("s>a"), { id: "hook", from: "s.c", to: "b", fromSide: "north" }] };
    const s = solve(p);
    expect(audit(p, s)).toEqual([]);
    expect(crosses(s, "s", "hook")).toBe("north");
    expect(crossed(s)).toBe(0);
  });
  it("counts two hooks of one box against each other, and takes them round opposite sides", () => {
    // into a from above by its south wall, out of a downward by its north: round one side they cross
    const p: Problem = { root: group([leaf("t"), leaf("a"), leaf("b")], pin({ t: 0, a: 1, b: 2 })), wires: [{ id: "down", from: "a", to: "b", fromSide: "north" }, { id: "up", from: "t", to: "a", toSide: "south" }] };
    const s = solve(p);
    expect(audit(p, s)).toEqual([]);
    expect(crossed(s)).toBe(0);
  });
  it("at a tie on crossings, takes a hook round the side nearer where its wire is going", () => {
    // b hangs between p and a; either way round a crosses nothing, and the west is the shorter
    const p: Problem = { root: group([leaf("p"), leaf("a"), leaf("b")], pin({ p: 0, a: 0, b: 1 })), wires: [wire("p>b"), { id: "hook", from: "a", to: "b", fromSide: "north" }] };
    const s = solve(p), pts = s.wires.get("hook")!.points;
    expect(audit(p, s)).toEqual([]);
    expect(crossed(s)).toBe(0);
    expect(pts[2].x).toBeLessThan(s.boxes.get("a")!.x);
  });
  it("reads the side as a screen side through a container that flows the other way", () => {
    const p: Problem = { root: group([sys([leaf("sys.x"), leaf("sys.y")], { dir: "right" }), leaf("t")]), wires: [wire("sys.x>sys.y"), { id: "out", from: "sys.y", to: "t", fromSide: "east" }] };
    const s = solve(p);
    expect(audit(p, s)).toEqual([]);
    expect(wallAt(s.boxes.get("sys.y")!, s.wires.get("out")!.points[0])).toBe("east");
    expect(crosses(s, "sys", "out")).toBe("east");
  });
  it("leaves a picture with no asked side as it was", () => {
    const p = (hint: Partial<Wire>): Problem => ({ root: group([sys([leaf("sys.x"), leaf("sys.y")]), leaf("t")]), wires: [wire("sys.x>sys.y"), { id: "out", from: "sys.x", to: "t", ...hint }] });
    // the natural wall, asked for: nothing changes
    expect(JSON.stringify([...solve(p({ fromSide: "south" })).wires])).toBe(JSON.stringify([...solve(p({})).wires]));
  });
  it("takes a wire out of the north wall round the side of its box nearer where it is going", () => {
    // `b` stands below and to the west of `a`, `c` below and to the east: each hook goes round its own way, and crosses nothing
    const p = (to: string): Problem => ({
      root: group([leaf("x"), leaf("a"), leaf("z"), leaf("b"), leaf("y"), leaf("c")], pin({ x: 0, a: 0, z: 0, b: 1, y: 1, c: 1 })),
      wires: [wire("x>b"), wire("a>y"), wire("z>c"), { id: "hook", from: "a", to, fromSide: "north" }],
    });
    for (const [to, west] of [["b", true], ["c", false]] as const) {
      const q = p(to), s = solve(q), pts = s.wires.get("hook")!.points, a = s.boxes.get("a")!;
      expect(audit(q, s)).toEqual([]);
      expect(wallAt(a, pts[0])).toBe("north");
      expect(pts[2].x < a.x).toBe(west);            // the lane it comes down stands on that side of `a`
      expect(pts[2].x > a.x + a.w).toBe(!west);
      expect(crossed(s)).toBe(0);
    }
  });
  it("goes round a box's own room, not through it", () => {
    const p: Problem = { root: group([{ ...leaf("a"), room: { east: 64, north: 40 } }, leaf("b")]), wires: [{ id: "e", from: "a", to: "b", fromSide: "east" }, { id: "n", from: "a", to: "b", fromSide: "north" }] };
    const s = solve(p);
    expect(audit(p, s)).toEqual([]);
    expect(s.unhonoured).toBeUndefined();
  });
});

// ── statements that cannot all hold: the picture stays legal, and says what gave ──
describe("an aligned set that names two boxes of one rank", () => {
  const overlapping = (s: ReturnType<typeof solve>, a: string, b: string) => {
    const p = s.boxes.get(a)!, q = s.boxes.get(b)!;
    return p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
  };
  it("takes the first member of the rank and leaves the other out, side by side", () => {
    const p = problem([leaf("a"), leaf("b"), leaf("c")], ["a>b", "a>c"], { aligned: [["b", "c"]] }), s = solve(p);
    expect(overlapping(s, "b", "c")).toBe(false);
    expect(s.unaligned).toEqual(["c"]);
    expect(audit(p, s)).toEqual([]);
    // and the picture is the one drawn without the statement
    expect([...s.boxes]).toEqual([...solve(problem([leaf("a"), leaf("b"), leaf("c")], ["a>b", "a>c"])).boxes]);
  });
  it("does so with no wire at all, in a rightward container", () => {
    const p = problem([leaf("a"), leaf("b"), leaf("c")], [], { aligned: [["b", "c"]], dir: "right" }), s = solve(p);
    expect(overlapping(s, "b", "c")).toBe(false);
    expect(s.unaligned).toEqual(["c"]);
    expect(audit(p, s)).toEqual([]);
  });
  it("does so when one of the two is a container", () => {
    const sys: Box = { id: "sys", w: 0, h: 0, group: group([leaf("sys.x"), leaf("sys.y")], { pad: { top: 44, right: 16, bottom: 16, left: 16 } }) };
    const p = problem([leaf("a"), sys, leaf("c")], ["a>sys.x", "a>c", "sys.x>sys.y"], { aligned: [["sys", "c"]] }), s = solve(p);
    expect(overlapping(s, "sys", "c")).toBe(false);
    expect(s.unaligned).toEqual(["c"]);
    expect(audit(p, s)).toEqual([]);
  });
  it("still lines up the members that are in different ranks", () => {
    const p = problem([leaf("a", 200), leaf("b"), leaf("c"), leaf("d", 160)], ["a>b", "a>c", "b>d", "c>d"], { aligned: [["a", "b", "c", "d"]] }), s = solve(p);
    const mid = (id: string) => s.boxes.get(id)!.x + s.boxes.get(id)!.w / 2;
    expect([mid("b"), mid("d")]).toEqual([mid("a"), mid("a")]);
    expect(s.unaligned).toEqual(["c"]);
    expect(audit(p, s)).toEqual([]);
  });
  it("makes one set of two that share a member, on the same terms", () => {
    const p = problem([leaf("a"), leaf("b"), leaf("c")], ["a>b", "a>c"], { aligned: [["a", "b"], ["c", "a"]] }), s = solve(p);
    expect(overlapping(s, "b", "c")).toBe(false);
    expect(s.unaligned).toEqual(["a"]); // joining the second set would put `c` on `b`'s line: `a` stays out of it
    expect(audit(p, s)).toEqual([]);
  });
  it("says nothing when every member is on its line", () => {
    expect(solve(problem([leaf("a"), leaf("b")], ["a>b"], { aligned: [["a", "b"]] })).unaligned).toBeUndefined();
  });
  it("gives way, and says so, where a held row contradicts two sets", () => {
    // a over d and b over c, but the author held a before b and c before d
    const p = problem([leaf("a"), leaf("b"), leaf("c"), leaf("d")], ["a>c", "b>d"], { aligned: [["a", "d"], ["b", "c"]], held: ["a", "b", "c", "d"] }), s = solve(p);
    expect(audit(p, s)).toEqual([]);
    expect(s.unaligned?.length).toBeGreaterThan(0);
    for (const [x, y] of [["a", "b"], ["c", "d"]]) expect(overlapping(s, x, y)).toBe(false);
  });
  it("keeps `columns` and an aligned set that cut across each other legal", () => {
    const p = problem([leaf("a"), leaf("b"), leaf("x"), leaf("y")], ["a>x", "b>y"], { columns: [["a", "y"], ["b", "x"]], aligned: [["a", "y"], ["b", "x"]] }), s = solve(p);
    expect(audit(p, s)).toEqual([]);
  });
});

// ── a label is crossed by nothing but its own wire (§5.6) ────────────────────
describe("a label and the wires beside it", () => {
  const labelled = (boxes: Box[], wires: [string, number?][], over: Partial<Group> = {}): Problem =>
    ({ root: group(boxes, over), wires: wires.map(([s, w]) => ({ ...wire(s), id: `${s}${w ?? ""}`, label: w ? { w, h: 18 } : undefined })) });
  /** Labels another wire runs through. */
  const covered = (s: ReturnType<typeof solve>) => {
    const hit: string[] = [];
    for (const [id, { label }] of s.wires) {
      if (!label) continue;
      for (const [other, { points }] of s.wires)
        if (other !== id && points.slice(1).some((q, i) => Math.min(points[i].x, q.x) < label.x + label.w && Math.max(points[i].x, q.x) > label.x && Math.min(points[i].y, q.y) < label.y + label.h && Math.max(points[i].y, q.y) > label.y)) hit.push(`${id} under ${other}`);
    }
    return hit;
  };
  it("stands two parallel labelled wires far enough apart for both labels", () => {
    // `read` and `write` between the same two boxes: 16 px apart, each label would lie on the other wire
    const p = labelled([leaf("a"), leaf("b")], [["a>b", 44], ["a>b", 52]]), s = solve(p);
    expect(covered(s)).toEqual([]);
    expect(audit(p, s)).toEqual([]);
    const [x1, x2] = [...s.wires.values()].map((w) => w.points[0].x);
    expect(Math.abs(x1 - x2)).toBeGreaterThanOrEqual(52 / 2);     // half the wider label, at least
    for (const w of s.wires.values()) expect(w.points).toHaveLength(2); // and both still straight
  });
  it("does the same for a wire and its return (a mutual pair)", () => {
    const p = labelled([leaf("a"), leaf("b")], [["a>b", 60], ["b>a", 60]]), s = solve(p);
    expect(covered(s)).toEqual([]);
    expect(audit(p, s)).toEqual([]);
  });
  it("keeps an unlabelled neighbour off a label too", () => {
    const p = labelled([leaf("a"), leaf("b")], [["a>b", 70], ["a>b"]]), s = solve(p);
    expect(covered(s)).toEqual([]);
    expect(audit(p, s)).toEqual([]);
  });
  it("finds room for the labels of three wires into one box", () => {
    const p = labelled([leaf("x"), leaf("y"), leaf("z"), leaf("bus", 160)], [["x>bus", 80], ["y>bus", 80], ["z>bus", 80]]), s = solve(p);
    expect(covered(s)).toEqual([]);
    expect(audit(p, s)).toEqual([]);
  });
  it("moves a label along its own wire before it moves any wire", () => {
    // the labelled wire turns: its label goes onto the run, and the boxes and wires stand where they would without the label's trouble
    const boxes = () => [leaf("a"), leaf("b"), leaf("c"), leaf("d")];
    const p = labelled(boxes(), [["a>c"], ["a>d"], ["b>d", 90], ["b>c"]]), s = solve(p);
    expect(covered(s)).toEqual([]);
    expect(audit(p, s)).toEqual([]);
  });
  it("carries the room through a container's wall to the box inside", () => {
    const sys = (): Box => ({ id: "sys", w: 0, h: 0, group: group([leaf("sys.x")], { pad: { top: 44, right: 16, bottom: 16, left: 16 } }) });
    const p = labelled([leaf("a"), leaf("b"), sys()], [["a>sys.x", 60], ["b>sys.x", 60]], pin({ a: 0, b: 0, sys: 1 })), s = solve(p);
    expect(covered(s)).toEqual([]);
    expect(audit(p, s)).toEqual([]);
  });
  it("leaves a picture whose labels are clear exactly as it was", () => {
    const p = labelled([leaf("a"), leaf("b"), leaf("c")], [["a>b", 40], ["b>c", 40]]), s = solve(p);
    const { label } = s.wires.get("a>b40")!, a = s.boxes.get("a")!;
    expect(label!.x + 20).toBe(a.x + 60);              // centred on its wire, in the gap, where it always stood
    expect(s.boxes.get("b")!.y - (a.y + 64)).toBe(56); // and the gap no deeper for it
  });
});
