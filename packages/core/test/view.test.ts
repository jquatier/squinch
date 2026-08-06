import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { buildModel } from "../src/model/build.js";
import { resolveView } from "../src/view/resolve.js";
import { render, validateSVG } from "../src/index.js";

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
    expect(webCard.glyph).toEqual({ pack: "sys", id: "app-window" });
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

  describe("`only` — the view's filter", () => {
    // `scope` is where you stand, `only` is which of that you keep. Before this
    // existed a cross-cutting concern could not be selected at all: `include
    // #pci` adds to a set that already holds it, `highlight` decorates without
    // removing, and an auditor enumerated the complement by id.
    const SRC = `pack aws
system pay "Pay" {
  api   = aws/lambda "API" { tags: #pci }
  vault = aws/dynamodb "Vault" datastore { tags: #pci }
  stats = aws/lambda "Stats"
  api -> vault
  api -> stats
}
system ledger "Ledger" { post = aws/lambda "Post" }
pay.api -> ledger.post "settle"
`;
    const paths = (viewSrc: string) => {
      const { model: m } = buildModel(SRC + viewSrc);
      const v = m.views.find((x) => x.name === "v")!;
      return resolveView(m, v).nodes.map((n) => n.path).sort();
    };

    it("keeps the matches and drops the rest of the interior", () => {
      expect(paths(`view v { scope pay\n only #pci\n}`)).toEqual(
        expect.arrayContaining(["pay.api", "pay.vault"]),
      );
      expect(paths(`view v { scope pay\n only #pci\n}`)).not.toContain("pay.stats");
    });

    it("a filtered-out sibling does not come back as a context card", () => {
      // It lifts to the container we are standing in, so the view would draw a
      // muted card of *itself*. Context is for connections outward only.
      expect(paths(`view v { scope pay\n only #pci\n}`)).not.toContain("pay");
    });

    it("a genuinely outside neighbour still earns its card — the crossing an audit wants", () => {
      expect(paths(`view v { scope pay\n only #pci\n}`)).toContain("ledger");
    });

    it("takes ids as well as tags, so narrowing never means listing the complement", () => {
      expect(paths(`view v { scope pay\n only api, vault\n}`)).not.toContain("pay.stats");
    });

    it("warns rather than silently emptying the diagram", () => {
      const { model: m } = buildModel(`${SRC}view v { scope pay\n only #nope\n}`);
      const ds = resolveView(m, m.views.find((x) => x.name === "v")!).diagnostics;
      expect(ds.some((d) => d.message.includes("#nope"))).toBe(true);
      expect(ds.some((d) => d.message.includes("renders empty"))).toBe(true);
    });
  });

  describe("`detail` — altitude, split out of `include`", () => {
    const SRC = `pack aws
system pay "Pay" { api = aws/lambda "API" }
system ledger "Ledger" { post = aws/lambda "Post" }
pay.api -> ledger.post
`;
    const nodes = (viewSrc: string) => {
      const { model: m } = buildModel(SRC + viewSrc);
      return resolveView(m, m.views.find((x) => x.name === "v")!).nodes;
    };

    it("draws the deep node instead of its top-level card", () => {
      const n = nodes(`view v { scope pay\n detail ledger.post\n}`);
      expect(n.map((x) => x.path)).toContain("ledger.post");
      expect(n.map((x) => x.path)).not.toContain("ledger");
    });

    it("plain `include` no longer does it silently — it says so and names `detail`", () => {
      // include used to mean both "add this" and "…and redraw its whole branch
      // at another altitude". That second meaning is why it could never be
      // redefined to narrow.
      const { model: m } = buildModel(`${SRC}view v { scope pay\n include ledger.post\n}`);
      const d = resolveView(m, m.views.find((x) => x.name === "v")!).diagnostics
        .find((x) => x.message.includes("context card"));
      expect(d?.fix).toContain("detail ledger.post");
    });
  });

  it("native parallel edges stay separate at their own altitude", () => {
    const { model: m } = buildModel(
      `system s "S" {\n a = aws/lambda "A"\n b = aws/dynamodb "B"\n a -> b "read"\n a -> b "write"\n}`,
    );
    const g = resolveView(m, {
      name: "s", scope: "s",
      only: [], include: [], includeStar: false, exclude: [], expand: [], detail: [],
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

describe("auto views (SPEC §5)", () => {
  const SRC = `pack aws
system a "A" {
  x = aws/lambda "X"
  container inner "Inner" { y = aws/s3 "Y" }
}
system b "B" { z = aws/dynamodb "Z" }
a.x -> b.z
view b { title "Custom B" }`;

  it("gives every container a view so zoom always lands somewhere", () => {
    const { model } = buildModel(SRC);
    const byScope = Object.fromEntries(model.views.map((v) => [v.scope, v]));
    expect(Object.keys(byScope).sort()).toEqual(["a", "a.inner", "b"]);
    expect(byScope["a"].auto).toBe(true);
    expect(byScope["a.inner"].auto).toBe(true);
  });

  it("an explicit view customizes the auto one rather than duplicating it", () => {
    const { model } = buildModel(SRC);
    const forB = model.views.filter((v) => v.scope === "b");
    expect(forB).toHaveLength(1);
    expect(forB[0].auto).toBeUndefined();
    expect(forB[0].title).toBe("Custom B");
  });
});

describe("badge on a leaf", () => {
  it("carries the parsed ref into the view graph, and renders it", async () => {
    const doc = `pack aws
system s "S" {
  wh = sys/database "SQL warehouse" { badge: logos/databricks }
  nb = sys/notebook "notebook"
  wh -> nb
}
view v { scope s }`;
    const built = buildModel(doc);
    expect(built.ok, JSON.stringify(built.diagnostics)).toBe(true);
    const g = resolveView(built.model, built.model.views.find((v) => v.name === "v")!);
    const wh = g.nodes.find((n) => n.path === "s.wh")!;
    expect(wh.badge).toEqual({ pack: "logos", id: "databricks" });
    expect(g.nodes.find((n) => n.path === "s.nb")!.badge).toBeUndefined();

    const r = await render(doc, { theme: "light", view: "v" });
    expect(r.ok).toBe(true);
    // the 22px surface plate at plate-origin+25, and the 14px mark inside it
    expect(r.svg).toMatch(/<rect x="\d+" y="\d+" width="22" height="22" rx="5" fill="#[0-9A-F]+" stroke="#[0-9A-F]+"\/>/);
    expect(r.svg).toMatch(/<use href="#sq-logos-databricks" x="\d+" y="\d+" width="14" height="14"\/>/);
    // the <use> is emitted unconditionally, so the symbol is the real assertion:
    // iconDefs walks a hardcoded field list per node and must include the badge,
    // or a badge-only icon dangles and draws nothing.
    expect(r.svg).toContain(`<symbol id="sq-logos-databricks"`);
    // brand colour from the manifest, not a theme colour
    expect(r.svg).toContain(`color="#FF3621" fill="#FF3621"`);
    expect(validateSVG(r.svg!).ok).toBe(true);
  });

  it("keeps its plate crisp in sketch, and survives the adaptive merge", async () => {
    const doc = `pack aws
system s "S" {
  wh = sys/database "SQL warehouse" { badge: logos/databricks }
  nb = sys/notebook "notebook"
  wh -> nb
}
view v { scope s }`;
    // sketch roughens boxes but never plates — the badge plate is a plain rect
    // like the icon plate it sits on, so the mark is never drawn on a wobble.
    const sk = await render(doc, { theme: "sketch", view: "v" });
    expect(sk.ok, JSON.stringify(sk.diagnostics)).toBe(true);
    expect(sk.svg).toMatch(/<rect x="\d+" y="\d+" width="22" height="22" rx="5"/);

    // adaptive merges two palettes positionally: the plate's fill/stroke are
    // theme tokens and diverge, the brand colour is identical in both and must
    // survive as a literal rather than being rewritten.
    const ad = await render(doc, { theme: "light", adaptive: true, view: "v" });
    expect(ad.ok, JSON.stringify(ad.diagnostics)).toBe(true);
    expect(ad.svg).toContain("#FF3621");
    expect(validateSVG(ad.svg!).ok).toBe(true);
  });

  it("shares one <symbol> when the badge is also some node's icon", async () => {
    const doc = `pack logos
system s "S" {
  a = logos/databricks "platform"
  b = sys/table "delta" { badge: logos/databricks }
  a -> b
}
view v { scope s }`;
    const r = await render(doc, { theme: "light", view: "v" });
    expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
    expect(r.svg!.match(/<symbol id="sq-logos-databricks"/g)!.length).toBe(1);
  });
});

describe("comet edges", () => {
  const doc = (extra = "") => `pack aws
system s "S" {
  a = aws/lambda "A"
  b = aws/lambda "B"
  c = aws/lambda "C"
  a -> b "call" { animate: comet${extra} }
  b -> c "next"
}
view v { scope s }`;

  it("rides a separate dot and leaves the stroke alone", async () => {
    const r = await render(doc(), { theme: "light", view: "v" });
    expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
    // the traveller: a circle with an offset-path and a per-edge duration
    expect(r.svg).toMatch(/<circle r="3\.5" fill="[^"]+" opacity="0" style="offset-path:path\('M [^']+'\);animation:sq-comet [\d.]+s linear infinite"\/>/);
    // ...and the wire itself carries no animation class
    expect(r.svg).not.toContain(`class="sq-flow"`);
    expect(validateSVG(r.svg!).ok).toBe(true);
  });

  it("is legal on a solid edge — the one animation that needs no pattern", async () => {
    const built = buildModel(doc());
    expect(built.ok, JSON.stringify(built.diagnostics)).toBe(true);
    // the guard that stops flow/slow/fast on a solid edge must not catch comet
    expect(built.diagnostics.some((d) => d.message.includes("needs a visible pattern"))).toBe(false);
    // and the same edge with `flow` still is caught, so the guard still works
    const flow = buildModel(doc().replace("animate: comet", "animate: flow"));
    expect(flow.diagnostics.some((d) => d.message.includes("needs a visible pattern"))).toBe(true);
  });

  it("defines its keyframe once, inside the reduced-motion gate", async () => {
    const r = await render(doc(), { theme: "light", view: "v" });
    const blocks = [...r.svg!.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
    const owner = blocks.filter((b) => b.includes("@keyframes sq-comet"));
    expect(owner.length).toBe(1);
    expect(owner[0].trimStart().startsWith("@media (prefers-reduced-motion: no-preference)")).toBe(true);
    // opacity is a presentation attribute, never CSS: resvg ignores CSS, so a
    // PNG export must not get a dot parked at the path origin.
    expect(r.svg).toContain(`opacity="0" style="offset-path`);
  });

  it("uses the ideal route in sketch, not the roughened stroke", async () => {
    const r = await render(doc(), { theme: "sketch", view: "v" });
    expect(r.ok).toBe(true);
    const path = /offset-path:path\('([^']+)'\)/.exec(r.svg!)![1];
    // rough.js emits cubics; the road the dot travels has none of them
    expect(path).not.toContain("C");
    expect(path.startsWith("M ")).toBe(true);
  });

  it("keeps the duration byte-identical across platforms", async () => {
    // The duration is float maths that ends up as a *string* in the SVG, and CI
    // byte-compares that string on macOS, Linux and Windows. sqrt is exactly
    // specified by IEEE-754 so the arithmetic agrees; the 2dp round is what
    // stops a long mantissa from ever reaching the output. Assert the shape,
    // not just the value: no exponent, no runaway decimals.
    const r = await render(doc(), { theme: "light", view: "v" });
    const secs = [...r.svg!.matchAll(/animation:sq-comet ([^ ]+)s/g)].map((m) => m[1]);
    expect(secs.length).toBe(1);
    for (const v of secs) {
      expect(v).toMatch(/^\d+(\.\d{1,2})?$/);
      expect(Number(v)).toBeGreaterThanOrEqual(0.4);
    }
    // and the same source renders the same string twice
    const again = await render(doc(), { theme: "light", view: "v" });
    expect(again.svg).toBe(r.svg);
  });
});
