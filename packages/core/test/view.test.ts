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

  it("exclude wins last and removes subtrees", () => {
    const v = { ...view("orders"), exclude: ["orders.handlers"] };
    const g = resolveView(model, v);
    expect(g.nodes.some((n) => n.path === "orders.handlers")).toBe(false);
    // api's edges into handlers.* now have no visible target → gone
    expect(g.edges.some((e) => e.to.startsWith("orders.handlers"))).toBe(false);
  });
});
