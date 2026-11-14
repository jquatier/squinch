// The behavioural spec, on problems small enough to read: each tidiness and
// ordering rule on a handful of boxes — no view, no model, no font. Ported
// from `loom/engine.test.ts`; where REQUIREMENTS §4/§5.5 now override a test
// the change is marked "REQUIREMENTS".
import { describe, it, expect } from "vitest";
import { solve, type Box, type Group, type Problem, type Dir } from "./engine.js";

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
