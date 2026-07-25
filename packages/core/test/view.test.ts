import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { buildModel } from "../src/model/build.js";
import { resolveView } from "../src/view/resolve.js";

const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(pkg, "examples/landscape.squinch"), "utf8");
const { model } = buildModel(src);
const view = (name: string) => model.views.find((v) => v.name === name)!;

describe("visibility resolution + edge lifting", () => {
  it("landscape: top-level cards, person leaf, lifted edges", () => {
    const g = resolveView(model, view("landscape"));
    const kinds = Object.fromEntries(g.nodes.map((n) => [n.path, n.kind]));
    expect(kinds).toEqual({ customer: "leaf", web: "card", orders: "card" });
    expect(g.edges.map((e) => `${e.from}>${e.to}`)).toEqual(["customer>web", "web>orders"]);
    expect(g.edges.every((e) => e.count === 1)).toBe(true); // single constituents keep identity
  });

  it("orders zoom: context earns its card, internals hide, parallels aggregate", () => {
    const g = resolveView(model, view("orders"));
    const kinds = Object.fromEntries(g.nodes.map((n) => [n.path, n.kind]));
    expect(kinds["orders.handlers"]).toBe("card");
    expect(kinds["web"]).toBe("context-card"); // lifted to top level, edge-earned
    expect(kinds["customer"]).toBeUndefined(); // no surviving edge → not context
    const agg = g.edges.filter((e) => e.count > 1);
    expect(agg.map((e) => `${e.from}>${e.to}×${e.count}`).sort()).toEqual([
      "orders.api>orders.handlers×2",
      "orders.handlers>orders.db×2",
    ]);
  });

  it("cards carry taglines, glyphs, preview strips, inherited tags", () => {
    const g = resolveView(model, view("landscape"));
    const webCard = g.nodes.find((n) => n.path === "web")!;
    expect(webCard.tagline).toBe("Customer-facing web experience");
    expect(webCard.glyph).toEqual({ pack: "sys", id: "webapp" });
    expect(webCard.preview.length).toBe(2); // cdn + app icons
    const ordersCard = g.nodes.find((n) => n.path === "orders")!;
    expect(ordersCard.tagline).toBe("4 components");
  });

  it("container tags are inherited by descendants", () => {
    const g = resolveView(model, view("orders"));
    const db = g.nodes.find((n) => n.path === "orders.db")!;
    expect(db.tags).toContain("pci"); // own
    expect(db.tags).toContain("core"); // inherited from orders
  });

  it("native parallel edges stay separate at their own altitude", () => {
    const { model: m } = buildModel(
      `system s "S" {\n a = aws/lambda "A"\n b = aws/dynamodb "B"\n a -> b "read"\n a -> b "write"\n}`,
    );
    const g = resolveView(m, {
      name: "s", scope: "s",
      include: [], includeStar: false, exclude: [], expand: [],
      context: "auto", highlight: [], showDescriptions: false, notes: [],
      layout: { place: [], routes: [] },
      loc: { from: 0, to: 0, line: 1, col: 1 },
    } as any);
    expect(g.edges.length).toBe(2);
    expect(g.edges.map((e) => e.label).sort()).toEqual(["read", "write"]);
  });

  it("route on an ambiguous parallel pair without label errors", async () => {
    const { layoutView } = await import("../src/layout/layout.js");
    const { model: m, ...rest } = buildModel(
      `system s "S" {\n a = aws/lambda "A"\n b = aws/dynamodb "B"\n a -> b "read"\n a -> b "write"\n}\nview s {\n layout { route a -> b from east to west }\n}`,
    );
    const r = await layoutView(m, m.views[0]);
    const err = r.diagnostics.find((d) => d.severity === "error");
    expect(err?.message).toContain("2 edges match");
    expect(err?.fix).toContain("label");
  });

  it("expand inlines children in a frame; edges de-aggregate", async () => {
    const g = resolveView(model, view("orders-detail"));
    expect(g.frames).toEqual([{ path: "orders.handlers", label: "API Handlers" }]);
    const create = g.nodes.find((n) => n.path === "orders.handlers.create")!;
    expect(create.frame).toBe("orders.handlers");
    // internals visible → api edges are native again, no ×2 aggregate
    expect(g.edges.every((e) => e.count === 1)).toBe(true);
    expect(g.edges.some((e) => e.to === "orders.handlers.create")).toBe(true);
    // geometric containment
    const { layoutView } = await import("../src/layout/layout.js");
    const { positioned } = await layoutView(model, view("orders-detail"));
    const f = positioned.frames[0];
    for (const child of positioned.nodes.filter((n) => n.frame === f.path)) {
      expect(child.x).toBeGreaterThan(f.x);
      expect(child.y).toBeGreaterThan(f.y);
      expect(child.x + child.w).toBeLessThan(f.x + f.w);
      expect(child.y + child.h).toBeLessThan(f.y + f.h);
    }
  });

  it("exclude wins last and removes subtrees", () => {
    const v = { ...view("orders"), exclude: ["orders.handlers"] };
    const g = resolveView(model, v);
    expect(g.nodes.some((n) => n.path === "orders.handlers")).toBe(false);
    // api's edges into handlers.* now have no visible target → gone
    expect(g.edges.some((e) => e.to.startsWith("orders.handlers"))).toBe(false);
  });
});

describe("microservices example (zoom showcase)", () => {
  const shop = readFileSync(join(pkg, "../../examples/microservices/shop.squinch"), "utf8");
  const built = buildModel(shop);
  const v = (name: string) => built.model.views.find((x) => x.name === name)!;

  it("parses clean", () => {
    expect(built.ok).toBe(true);
  });

  it("landscape collapses every service to a card and aggregates cross-service edges", () => {
    const g = resolveView(built.model, v("landscape"));
    const cards = g.nodes.filter((n) => n.kind === "card").map((n) => n.path).sort();
    expect(cards).toEqual(["accounts", "catalog", "orders", "web"]);
    // price check + decrement stock both lift to orders -> catalog
    const agg = g.edges.find((e) => e.from === "orders" && e.to === "catalog")!;
    expect(agg.count).toBe(2);
    expect(agg.label).toBe("×2");
    // every service card previews what's inside
    expect(g.nodes.find((n) => n.path === "catalog")!.preview.length).toBe(3);
  });

  it("zooming a service reveals internals and collapses neighbours to context", () => {
    const g = resolveView(built.model, v("catalog"));
    const kinds = Object.fromEntries(g.nodes.map((n) => [n.path, n.kind]));
    expect(kinds["catalog.idx"]).toBe("leaf");
    expect(kinds["catalog.sync"]).toBe("leaf");
    expect(kinds["orders"]).toBe("context-card");
    expect(kinds["gw"]).toBe("context-leaf");
    expect(kinds["accounts"]).toBeUndefined(); // no edge into catalog → not context
  });

  it("suppresses edges between two context nodes", () => {
    const g = resolveView(built.model, v("orders"));
    // gw -> catalog and gw -> accounts are outsider-to-outsider: not this view's business
    expect(g.edges.some((e) => e.from === "gw" && e.to !== "orders.api")).toBe(false);
    expect(g.edges.some((e) => e.from === "gw" && e.to === "orders.api")).toBe(true);
  });
});
