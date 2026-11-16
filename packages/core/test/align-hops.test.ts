// align (SPEC §6): an EXACT shared axis — a few pixels off is the one thing
// DESIGN §1.4 forbids, so the layout solves it as a constraint. Crossing hops (DESIGN
// §4): crossings break the later edge so they can't read as junctions.
import { describe, it, expect } from "vitest";
import { buildModel, layoutView, render, themes } from "../src/index.js";
import { validateSVG } from "../src/render/validate.js";
import { checkLayout } from "./invariants.js";

const SRC = `pack aws
system s "S" {
  gw = aws/api-gateway "Gateway Service"
  a  = aws/lambda "A"
  b  = aws/lambda "B"
  c  = aws/lambda "C"
  db = aws/dynamodb "Orders" datastore
  gw -> a, b, c
  b -> db
}
view s {
  layout {
    rows [gw] [a b c] [db]
    align gw db
  }
}
`;

const centre = (n: { x: number; w: number }) => n.x + Math.round(n.w / 2);

describe("align", () => {
  it("puts the aligned node on the anchor's axis exactly", async () => {
    const built = buildModel(SRC);
    expect(built.ok).toBe(true);
    const view = built.model.views.find((v) => v.name === "s")!;
    const { positioned } = await layoutView(built.model, view);
    const gw = positioned.nodes.find((n) => n.path === "s.gw")!;
    const db = positioned.nodes.find((n) => n.path === "s.db")!;
    expect(centre(db)).toBe(centre(gw)); // exact, not "close"
  });

  it("keeps edges attached to the node it moved", async () => {
    const r = await render(SRC, { view: "s", theme: "light" });
    expect(r.ok).toBe(true);
    expect(validateSVG(r.svg!).ok).toBe(true);
    const built = buildModel(SRC);
    const { positioned } = await layoutView(built.model, built.model.views.find((v) => v.name === "s")!);
    const db = positioned.nodes.find((n) => n.path === "s.db")!;
    const into = positioned.edges.find((e) => e.to === "s.db")!;
    const tip = into.points[into.points.length - 1];
    // the arrow still lands on the node's top edge
    expect(tip.x).toBeGreaterThanOrEqual(db.x);
    expect(tip.x).toBeLessThanOrEqual(db.x + db.w);
    expect(Math.abs(tip.y - db.y)).toBeLessThanOrEqual(2);
    // and every segment stayed axis-aligned (no diagonals introduced)
    for (const e of positioned.edges)
      for (let i = 0; i < e.points.length - 1; i++) {
        const p = e.points[i], q = e.points[i + 1];
        expect(p.x === q.x || p.y === q.y, `diagonal in ${e.id}`).toBe(true);
      }
  });

  it("aligns onto a node that has row-mates without overlapping anything", async () => {
    // `a` shares a row with `b` and `c`. Sliding `a` under gw would drop it on
    // `b`; the layout moves what is free to move instead, and the axis is exact.
    const src = SRC.replace("align gw db", "align gw a");
    const built = buildModel(src);
    const { positioned, diagnostics } = await layoutView(built.model, built.model.views.find((v) => v.name === "s")!);
    expect(diagnostics).toEqual([]);
    const at = (path: string) => positioned.nodes.find((n) => n.path === path)!;
    expect(centre(at("s.a"))).toBe(centre(at("s.gw")));
    expect(checkLayout(positioned)).toEqual([]);
    // the row is still a row, in the order written
    expect(at("s.a").x + at("s.a").w).toBeLessThanOrEqual(at("s.b").x);
    expect(at("s.b").x + at("s.b").w).toBeLessThanOrEqual(at("s.c").x);
  });

  it("align with one element warns", () => {
    const r = buildModel(SRC.replace("align gw db", "align gw"));
    expect(r.diagnostics.some((d) => d.message.includes("needs at least two"))).toBe(true);
  });
});

describe("cols", () => {
  const SRC = `pack aws
system s "S" {
  gw = aws/api-gateway "Gateway"
  a1 = aws/lambda "Alpha API"
  a2 = aws/dynamodb "Alpha DB" datastore
  b1 = aws/lambda "Beta API"
  b2 = aws/dynamodb "Beta DB" datastore
  gw -> a1, b1
  a1 -> a2
  b1 -> b2
}
view s {
  layout {
    rows [gw] [a1 b1] [a2 b2]
    cols [a1 a2] [b1 b2]
  }
}
`;

  it("gives each column one exact axis, ordered left to right", async () => {
    const built = buildModel(SRC);
    expect(built.ok).toBe(true);
    const { positioned } = await layoutView(built.model, built.model.views.find((v) => v.name === "s")!);
    const c = (id: string) => {
      const n = positioned.nodes.find((x) => x.path === `s.${id}`)!;
      return n.x + Math.round(n.w / 2);
    };
    expect(c("a1")).toBe(c("a2")); // exact, like align
    expect(c("b1")).toBe(c("b2"));
    expect(c("a1")).toBeLessThan(c("b1")); // declaration order = left to right
  });

  it("composes with rows — they pin different axes", async () => {
    const built = buildModel(SRC);
    const { positioned } = await layoutView(built.model, built.model.views.find((v) => v.name === "s")!);
    const y = (id: string) => positioned.nodes.find((x) => x.path === `s.${id}`)!.y;
    expect(y("a1")).toBe(y("b1")); // same row
    expect(y("a2")).toBeGreaterThan(y("a1")); // next row down
  });

  it("rejects a node listed in two columns", () => {
    const r = buildModel(SRC.replace("cols [a1 a2] [b1 b2]", "cols [a1 a2] [a1 b2]"));
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0].message).toContain("appears in `cols` twice");
  });
});

describe("crossing hops", () => {
  it("breaks the later edge where two unrelated wires cross", async () => {
    // a deliberate crossing: two independent pairs whose wires must cross
    const src = `pack aws
system s "S" {
  a1 = aws/lambda "A1"
  b1 = aws/lambda "B1"
  a2 = aws/lambda "A2"
  b2 = aws/lambda "B2"
  a1 -> b2
  a2 -> b1
}
view s { layout { rows [a1 a2] [b1 b2] } }
`;
    const r = await render(src, { view: "s", theme: "light" });
    expect(r.ok).toBe(true);
    expect(validateSVG(r.svg!).ok).toBe(true);
    // 2 edges but 3 path elements — one edge was split by a hop
    const edgePaths = r.svg!.match(new RegExp(`<path d="M[^"]*" fill="none" stroke="${themes.light.edge}"`, "g")) ?? [];
    expect(edgePaths.length).toBeGreaterThan(2);
  });

  it("never hops where edges merely share a node", async () => {
    const src = `pack aws
system s "S" {
  gw = aws/lambda "GW"
  a = aws/lambda "A"
  b = aws/lambda "B"
  gw -> a
  gw -> b
}
view s { layout { rows [gw] [a b] } }
`;
    const r = await render(src, { view: "s", theme: "light" });
    const edgePaths = r.svg!.match(new RegExp(`<path d="M[^"]*" fill="none" stroke="${themes.light.edge}"`, "g")) ?? [];
    expect(edgePaths.length).toBe(2); // untouched — a junction, not a crossing
  });
});

// ── `place` honours its direction ──────────────────────────────────────────
// It didn't. `relpos` was parsed, validated, and documented with four options,
// then never read by the layout engine: both consumers copied the target's rank
// and spliced the node in *after* it, so all four directions produced a
// byte-identical SVG and `place x left-of y` silently meant right-of. Found by
// building a drag-to-hint spike and noticing that dragging left and dragging
// right gave the same picture.
describe("place direction", () => {
  const SRC = (place: string, dir = "") => `pack aws
system s "S" {
  api = aws/api-gateway "API"
  create = aws/lambda "Create"
  files = aws/s3 "Files" datastore
  db = aws/dynamodb "DB" datastore
  api -> create
  create -> files
  create -> db
}
view s {
  layout {
    ${dir}
    rows [api] [create] [files]
    ${place}
  }
}
`;
  const posOf = async (place: string, dir = "") => {
    const r = await render(SRC(place, dir), { view: "s", theme: "light" });
    expect(r.ok).toBe(true);
    const at: Record<string, { x: number; y: number }> = {};
    for (const m of r.svg!.matchAll(
      /data-path="s\.(\w+)" data-kind="leaf"[^>]*>\s*<rect x="(\d+)" y="(\d+)"/g,
    ))
      at[m[1]] = { x: +m[2], y: +m[3] };
    return at;
  };

  it("left-of puts the node before its target; right-of after", async () => {
    const right = await posOf("place db right-of files");
    const left = await posOf("place db left-of files");
    expect(right.db.x).toBeGreaterThan(right.files.x);
    expect(left.db.x).toBeLessThan(left.files.x);
    expect(left.db.y).toBe(left.files.y); // same band either way
  });

  it("above and below move the node to a different band", async () => {
    const base = await posOf("place db right-of files");
    const above = await posOf("place db above files");
    const below = await posOf("place db below files");
    expect(above.db.y).toBeLessThan(above.files.y);
    expect(below.db.y).toBeGreaterThan(below.files.y);
    expect(above.db.y).not.toBe(base.db.y);
  });

  it("all four directions are distinguishable", async () => {
    const svgs = await Promise.all(
      ["right-of", "left-of", "above", "below"].map(async (d) => {
        const r = await render(SRC(`place db ${d} files`), { view: "s", theme: "light" });
        return r.svg!;
      }),
    );
    expect(new Set(svgs).size).toBe(4);
  });

  it("works with no `rows` block at all", async () => {
    // `place` resolved its target's rank out of the *declared* map, which only
    // `rows` populated — so in a diagram without rows (most diagrams) every
    // `place` was silently discarded. Symptom: half the layout controls in the
    // playground appeared to do nothing.
    const NOROWS = (place: string) => `pack aws
system s "S" {
  api = aws/api-gateway "API"
  create = aws/lambda "Create"
  files = aws/s3 "Files" datastore
  db = aws/dynamodb "DB" datastore
  api -> create
  create -> files
  create -> db
}
view s {
  layout {
    ${place}
  }
}
`;
    const at = async (place: string) => {
      const r = await render(NOROWS(place), { view: "s", theme: "light" });
      expect(r.ok).toBe(true);
      const out: Record<string, { x: number; y: number }> = {};
      for (const m of r.svg!.matchAll(
        /data-path="s\.(\w+)" data-kind="leaf"[^>]*>\s*<rect x="(\d+)" y="(\d+)"/g,
      ))
        out[m[1]] = { x: +m[2], y: +m[3] };
      return out;
    };
    const none = await at("");
    expect(none.db.x).toBeGreaterThan(none.files.x); // natural order
    const left = await at("place db left-of files");
    expect(left.db.x).toBeLessThan(left.files.x); // and the hint flips it
    const below = await at("place db below files");
    expect(below.db.y).toBeGreaterThan(below.files.y);
  });

  it("chained places resolve against where the previous one put the target", async () => {
    // `place idx right-of sync` must see sync's *placed* rank, not its natural
    // one — the lookbook's side-car case is built on exactly this chain.
    const src = `pack aws
system s "S" {
  api = aws/api-gateway "API"
  fn = aws/lambda "Handler"
  db = aws/dynamodb "Orders" datastore
  sync = aws/lambda "Sync"
  idx = aws/opensearch "Index" datastore
  api -> fn
  fn -> db
  db ~> sync
  sync -> idx
}
view s {
  layout {
    rows [api] [fn] [db]
    place sync right-of db
    place idx right-of sync
  }
}
`;
    const r = await render(src, { view: "s", theme: "light" });
    const at: Record<string, number> = {};
    for (const m of r.svg!.matchAll(
      /data-path="s\.(\w+)" data-kind="leaf"[^>]*>\s*<rect x="\d+" y="(\d+)"/g,
    ))
      at[m[1]] = +m[2];
    // all three share db's band
    expect(at.sync).toBe(at.db);
    expect(at.idx).toBe(at.db);
  });

  it("`direction right` swaps which pair changes band", async () => {
    // ranks run left-to-right, so left-of/right-of move between columns and
    // above/below order within one
    const right = await posOf("place db right-of files", "direction right");
    const below = await posOf("place db below files", "direction right");
    expect(right.db.x).toBeGreaterThan(right.files.x);
    expect(below.db.x).toBe(below.files.x);
    expect(below.db.y).toBeGreaterThan(below.files.y);
  });
});

describe("an edge that runs up the declared rows is drawn", () => {
  // `rows [x] [y] [z]` with `z -> y` used to be refused as a hint conflict,
  // and round 17's agents hit it twice running. The rows are what the author
  // asked for and the edge is a fact about the system: both are kept, and the
  // wire simply runs upward.
  const lay = async (body: string, rows: string) => {
    const built = buildModel(`pack aws\nsystem s "S" {\n${body}\n}\nview v {\n  scope s\n  layout { rows ${rows} }\n}\n`);
    expect(built.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    return layoutView(built.model, built.model.views.find((v) => v.name === "v")!);
  };
  const leaf = (...ids: string[]) => ids.map((id) => `  ${id} = aws/lambda "${id}"`).join("\n");

  it("keeps the rows as written and runs the wire from the lower row to the upper", async () => {
    const { positioned, diagnostics } = await lay(`${leaf("x", "y", "z")}\n  x -> y\n  z -> y`, "[x] [y] [z]");
    expect(diagnostics).toEqual([]);
    expect(checkLayout(positioned)).toEqual([]);
    const at = (path: string) => positioned.nodes.find((n) => n.path === path)!;
    expect(at("s.x").y + at("s.x").h).toBeLessThanOrEqual(at("s.y").y);
    expect(at("s.y").y + at("s.y").h).toBeLessThanOrEqual(at("s.z").y);
    const up = positioned.edges.find((e) => e.from === "s.z" && e.to === "s.y")!;
    expect(up.points[0].y).toBeGreaterThan(up.points[up.points.length - 1].y);
  });

  it("does so beside a same-row edge out of the node it points at", async () => {
    // `y -> c` runs along the middle row while `z -> y` comes up into it
    const { positioned, diagnostics } = await lay(`${leaf("x", "y", "c", "z")}\n  x -> y\n  y -> c\n  z -> y`, "[x] [y c] [z]");
    expect(diagnostics).toEqual([]);
    expect(checkLayout(positioned)).toEqual([]);
    const at = (path: string) => positioned.nodes.find((n) => n.path === path)!;
    expect(at("s.y").y).toBe(at("s.c").y);
    expect(at("s.z").y).toBeGreaterThanOrEqual(at("s.y").y + at("s.y").h);
    expect(positioned.edges.map((e) => `${e.from}>${e.to}`).sort()).toEqual(["s.x>s.y", "s.y>s.c", "s.z>s.y"]);
  });
});
