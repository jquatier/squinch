// Relationship marks through the view and the layout (SPEC §4): where they
// survive, where they drop, and that no label stands on one.
import { describe, it, expect } from "vitest";
import { buildModel } from "../src/index.js";
import { layoutView } from "../src/layout/layout.js";
import { markRects } from "../src/layout/marks.js";
import { resolveView } from "../src/view/resolve.js";

const SHOP = (edges: string, views = "", dbLayout = "") => `system shop "Shop" {
  api = sys/server "API"
  container db "DB" {
    orders = sys/table "orders"
    customers = sys/table "customers"
    coupons = sys/table "coupons"
    items = sys/table "order_items"
    tags = sys/table "tags"
    products = sys/table "products"
    ${dbLayout}
  }
}
${edges}
view tables {
  scope shop.db
}
${views}
`;
const EDGES = `shop.db.orders -> shop.db.customers "customer_id" { from: many to: one }
shop.db.orders -> shop.db.coupons "coupon_id" { from: many to: zero-or-one }
shop.db.items -> shop.db.orders "order_id" { from: one-or-many to: exactly-one }
shop.db.items -> shop.db.products "product_id" { from: many to: one }
shop.db.products -- shop.db.tags { from: many to: many }
shop.api -> shop.db.orders "writes" { from: one to: many }`;

const lay = async (src: string, name: string) => {
  const { model, diagnostics } = buildModel(src);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  const view = model.views.find((v) => v.name === name)!;
  expect(view, name).toBeDefined();
  return { model, view, ...(await layoutView(model, view)) };
};
const hit = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

describe("relationship marks: which edges carry them in a view", () => {
  it("an edge between the two tables it names keeps both marks", async () => {
    const { positioned } = await lay(SHOP(EDGES), "tables");
    const e = positioned.edges.find((x) => x.from === "shop.db.orders" && x.to === "shop.db.customers")!;
    expect(e.marks).toEqual({ from: "many", to: "one" });
    expect(positioned.edges.find((x) => x.to === "shop.db.tags")!.marks).toEqual({ from: "many", to: "many" });
  });

  it("an edge with either end lifted drops both", async () => {
    // at the system's altitude the tables are inside the `db` card
    const src = SHOP(EDGES, `view sys {\n  scope shop\n}`);
    const { model } = buildModel(src);
    const g = resolveView(model, model.views.find((v) => v.name === "sys")!);
    expect(g.edges.length).toBeGreaterThan(0);
    expect(g.edges.every((e) => e.marks === undefined)).toBe(true);
    // opened, the same edge ends on the table again and has them
    const open = SHOP(EDGES, `view open {\n  scope shop\n  expand shop.db\n}`);
    const m2 = buildModel(open).model;
    const g2 = resolveView(m2, m2.views.find((v) => v.name === "open")!);
    expect(g2.edges.find((e) => e.from === "shop.api" && e.to === "shop.db.orders")!.marks).toEqual({ from: "one", to: "many" });
  });

  it("`lines: straight` draws none and says so once", async () => {
    const { positioned, diagnostics } = await lay(SHOP(EDGES, `view st {\n  scope shop.db\n  layout {\n    lines straight\n  }\n}`), "st");
    expect(positioned.edges.every((e) => e.marks === undefined)).toBe(true);
    const w = diagnostics.filter((d) => d.message.includes("lines straight"));
    expect(w).toHaveLength(1);
    expect(w[0].severity).toBe("warning");
    expect(w[0].message).toContain("5 marked edges");
    // a straight view with no marked edge says nothing
    const plain = await lay(SHOP(`shop.db.orders -> shop.db.customers`, `view st {\n  scope shop.db\n  layout {\n    lines straight\n  }\n}`), "st");
    expect(plain.diagnostics).toEqual([]);
  });
});

describe("relationship marks: shared ports", () => {
  const CH = (a: string, b: string) => SHOP(
    `shop.db.orders -> shop.db.customers ${a}\nshop.db.coupons -> shop.db.customers ${b}`,
    `view ch {\n  scope shop.db\n  layout {\n    channel shop.db.orders, shop.db.coupons -> shop.db.customers\n  }\n}`);
  it("a channel whose edges agree on the shared end is fine", async () => {
    const { diagnostics, positioned } = await lay(CH("{ from: many to: one }", "{ from: zero-or-many to: one }"), "ch");
    expect(diagnostics).toEqual([]);
    expect(positioned.edges.map((e) => e.marks?.to)).toEqual(["one", "one"]);
  });
  it("a channel whose edges disagree is an error on the channel line", async () => {
    const { diagnostics } = await lay(CH("{ from: many to: one }", "{ from: many to: zero-or-one }"), "ch");
    const errs = diagnostics.filter((d) => d.severity === "error");
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toContain("mark that end differently — `one`, `zero-or-one`");
    expect(errs[0].loc.line).toBe(21);
    expect(errs[0].fix).toContain("the same `to:`");
  });
  it("marked against unmarked in one channel is a disagreement too", async () => {
    const { diagnostics } = await lay(CH("{ from: many to: one }", ""), "ch");
    expect(diagnostics.filter((d) => d.severity === "error")[0].message).toContain("`one`, `no mark`");
  });
  it("two edges between the same pair in one channel share both ends", async () => {
    // billing and shipping: one wire from `orders` to `customers`, two marks due at its start
    const src = SHOP(
      `shop.db.orders -> shop.db.customers "billing_id" { from: many to: one }
shop.db.orders -> shop.db.customers "shipping_id" { from: zero-or-many to: one }
shop.db.coupons -> shop.db.customers "owner_id" { from: many to: one }`,
      `view ch {\n  scope shop.db\n  layout {\n    channel shop.db.orders, shop.db.coupons -> shop.db.customers\n  }\n}`);
    const errs = (await lay(src, "ch")).diagnostics.filter((d) => d.severity === "error");
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toContain("draws 2 edges out of `shop.db.orders` as one wire");
    expect(errs[0].message).toContain("`many`, `zero-or-many`");
  });
  it("a `wrap` trunk whose edges disagree is an error on the wrap line", async () => {
    const hub = (marks: string[]) => `system s "S" {
  container db "DB" {
    hub = sys/table "hub"
    a = sys/table "a"
    b = sys/table "b"
    c = sys/table "c"
    d = sys/table "d"
    layout {
      wrap 2
    }
  }
}
${["a", "b", "c", "d"].map((t, i) => `s.db.hub -> s.db.${t} ${marks[i]}`).join("\n")}
view v {
  scope s.db
}
`;
    const same = await lay(hub(Array(4).fill("{ from: one to: many }")), "v");
    expect(same.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const mixed = await lay(hub(["{ from: one to: many }", "{ from: one to: many }", "{ from: exactly-one to: many }", "{ from: one to: many }"]), "v");
    const errs = mixed.diagnostics.filter((d) => d.severity === "error");
    // the fold draws `c` and `d` as one trunk out of the hub
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toContain("`wrap` draws 2 edges out of `s.db.hub` as one wire");
    expect(errs[0].message).toContain("`exactly-one`, `one`");
    expect(errs[0].loc.line).toBe(9);
  });
});

describe("relationship marks: ordinary schemas are not crowded", () => {
  it("a mutual pair and a third edge on one wall keep their marks apart", async () => {
    // found in review: ports moved level with their wires stood 8px apart, and a mark is 10 across
    const src = `system s "S" {
  container db "DB" {
    users = sys/table "users"
    teams = sys/table "teams"
    invites = sys/table "invites"
  }
}
s.db.invites -> s.db.teams "team_id" { from: many to: one }
s.db.users -> s.db.teams "team_id" { from: many to: one }
s.db.teams -> s.db.users "owner_id" { from: zero-or-many to: one }
view v {
  scope s.db
}
`;
    const { positioned, diagnostics } = await lay(src, "v");
    expect(diagnostics).toEqual([]);
    const marks = positioned.edges.flatMap((e) => markRects(e));
    for (const a of marks) for (const b of marks) if (a !== b && !(a.at.x === b.at.x && a.at.y === b.at.y)) expect(hit(a.rect, b.rect)).toBe(false);
  });

  it("flow badges on unlabelled marked wires, compact, stand clear of the marks", async () => {
    const src = SHOP(EDGES.replace(/ "[^"]*"/g, "") + `\nflow f "F" {\n  shop.db.items -> shop.db.orders -> shop.db.customers\n}`,
      `view fl {\n  scope shop.db\n  show flow f\n  layout {\n    density compact\n  }\n}`);
    const { positioned, diagnostics } = await lay(src, "fl");
    expect(positioned.badges.length).toBeGreaterThan(0);
    expect(diagnostics.filter((d) => d.message.includes("crowded"))).toEqual([]);
  });

  it("curved lines keep the marks", async () => {
    const { positioned, diagnostics } = await lay(SHOP(EDGES, `view cu {\n  scope shop.db\n  layout {\n    lines curved\n  }\n}`), "cu");
    expect(diagnostics).toEqual([]);
    expect(positioned.edges.filter((e) => e.marks).length).toBe(5);
  });
});

describe("relationship marks: nothing stands on one", () => {
  const VIEWS = `view right {
  scope shop.db
  layout {
    direction right
  }
}
view compact {
  scope shop.db
  layout {
    density compact
  }
}
view rows {
  scope shop.db
  layout {
    rows [shop.db.orders shop.db.customers shop.db.coupons] [shop.db.items shop.db.products shop.db.tags]
  }
}
view open {
  scope shop
  expand shop.db
}
view openright {
  scope shop
  expand shop.db
  layout {
    direction right
  }
}`;
  it.each(["tables", "right", "compact", "rows", "open", "openright"])("view %s: no label on a mark, no crowding", async (name) => {
    const { positioned, diagnostics } = await lay(SHOP(EDGES, VIEWS), name);
    expect(diagnostics.filter((d) => d.message.includes("crowded"))).toEqual([]);
    const marks = positioned.edges.flatMap((e) => markRects(e));
    expect(marks.length).toBeGreaterThanOrEqual(10);
    for (const e of positioned.edges) {
      if (!e.labelRect) continue;
      for (const m of marks) expect(hit(e.labelRect, m.rect), `${name}: label "${e.label}" on the mark at ${m.node}`).toBe(false);
    }
    // every mark stands on a straight run at least as long as it reaches
    for (const e of positioned.edges.filter((x) => x.marks)) {
      const p = e.points, n = p.length;
      expect(Math.abs(p[1].x - p[0].x) + Math.abs(p[1].y - p[0].y)).toBeGreaterThanOrEqual(12);
      expect(Math.abs(p[n - 1].x - p[n - 2].x) + Math.abs(p[n - 1].y - p[n - 2].y)).toBeGreaterThanOrEqual(12);
    }
  });

  it("the same view without marks is laid out with the same boxes when nothing is labelled", async () => {
    const bare = EDGES.replace(/ "[^"]*"/g, "");
    const a = await lay(SHOP(bare), "tables"), b = await lay(SHOP(bare.replace(/ \{[^}]*\}/g, "")), "tables");
    expect(a.positioned.nodes.map((n) => [n.path, n.x, n.y])).toEqual(b.positioned.nodes.map((n) => [n.path, n.x, n.y]));
  });

  it.each([[4, 0], [5, 1], [6, 1]])("%i relationships on a table's head in a rightward view: %i warning", async (n, warnings) => {
    const src = `system s "S" {
  container db "DB" {
    hub = sys/table "hub"
    ${Array.from({ length: n }, (_, i) => `t${i} = sys/table "t${i}"`).join("\n    ")}
    layout {
      direction right
    }
  }
}
${Array.from({ length: n }, (_, i) => `s.db.t${i} -> s.db.hub { from: many to: one }`).join("\n")}
view v {
  scope s.db
}
`;
    const { diagnostics } = await lay(src, "v");
    expect(diagnostics.filter((d) => d.message.includes("crowded")).map((d) => d.message)).toHaveLength(warnings);
  });

  it("the fix the warning writes clears it", async () => {
    const src = (extra: string) => `system s "S" {
  container db "DB" {
    hub = sys/table "hub"
    ${Array.from({ length: 6 }, (_, i) => `t${i} = sys/table "t${i}"`).join("\n    ")}
  }
}
${Array.from({ length: 6 }, (_, i) => `s.db.t${i} -> s.db.hub { from: many to: one }`).join("\n")}
view v {
  scope s.db
  layout {
    ${extra}
  }
}
`;
    const crowded = async (extra: string) => (await lay(src(extra), "v")).diagnostics.filter((d) => d.message.includes("crowded")).length;
    expect(await crowded("direction right")).toBe(1);
    expect(await crowded("direction right\n    route s.db.t0 -> s.db.hub from east to north\n    route s.db.t5 -> s.db.hub from east to south")).toBe(0);
    // the side at the crowded table's end is enough: what the fix line says
    expect(await crowded("direction right\n    route s.db.t0 -> s.db.hub to north\n    route s.db.t5 -> s.db.hub to south")).toBe(0);
    expect(await crowded("direction down")).toBe(0);
  });

  it("more relationships than a wall holds is one warning naming the table", async () => {
    const many = `system s "S" {
  container db "DB" {
    hub = sys/table "hub"
    ${Array.from({ length: 7 }, (_, i) => `t${i} = sys/table "t${i}"`).join("\n    ")}
    layout {
      direction right
      rows [${Array.from({ length: 7 }, (_, i) => `t${i}`).join(" ")}] [hub]
    }
  }
}
${Array.from({ length: 7 }, (_, i) => `s.db.t${i} -> s.db.hub "hub_id" { from: many to: one }`).join("\n")}
view v {
  scope s.db
}
`;
    const { diagnostics } = await lay(many, "v");
    // seven wires on a 64px head stand 8px apart, and a mark is 10 across
    const crowded = diagnostics.filter((d) => d.message.includes("crowded"));
    expect(crowded).toHaveLength(1);
    expect(crowded[0].severity).toBe("warning");
    expect(crowded[0].message).toBe("the relationship marks at `s.db.hub` are crowded — another mark stands on one of them");
    expect(crowded[0].fix).toContain("route <a> -> s.db.hub to <side>");
  });
});
