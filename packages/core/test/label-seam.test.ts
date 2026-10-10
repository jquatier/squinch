// The seam between the two edge routers (docs/notes/edge-labels.md, "Two
// routers, one blind spot"). ELK reserves an inline label for every cross-rank
// edge and the coplanar router reserves a pill on every same-rank wire; neither
// sees the other's reservation. A cross-rank edge that threads the gutter a
// coplanar wire runs through gets its label at its median layer — the wire's
// layer — and the pill lands on the crossing. Gauntlet round 30 found it in two
// of three cold answers to prompt 34, after 240 corpus views had never shown it.
//
// The fixture is that answer's `orders` view cut down to what reproduces it:
// a context leaf above a band of two, a labelled same-rank wire between the
// two, and a context card off to the side that widens the band enough for ELK
// to take the gutter rather than go around. Without the pass, `views orders`
// is drawn on top of `reads cart`; the dump that established this is in the
// note.
import { describe, it, expect } from "vitest";
import { buildProject } from "../src/index.js";
import { layoutView, type PEdge } from "../src/layout/layout.js";
import { checkLayout } from "./invariants.js";

const SRC = "pack logos\nbff = logos/nodedotjs \"BFF\"\nbus = logos/kafka \"Event Bus\"\nstripe = box \"Stripe\" external\nsystem catalog_domain \"Catalog & Discovery\" {\n  description: \"Product catalog, search and recommendations\"\n  pricing_svc = sys/server \"Pricing Service\"\n}\nsystem order_domain \"Order Fulfillment\" {\n  description: \"Shopping cart, checkout, orders and payments\"\n  icon: sys/shopping-cart\n\n  cart_svc = sys/server \"Cart Service\" {\n    subtitle: \"Node.js\"\n  }\n  cart_cache = logos/redis \"Cart Cache\" datastore\n\n  checkout_svc = sys/server \"Checkout Service\" {\n    subtitle: \"Node.js\"\n  }\n  checkout_db = logos/postgres \"Checkout DB\" datastore\n\n  orders_svc = sys/server \"Orders Service\" {\n    subtitle: \"Node.js\"\n  }\n  orders_db = logos/postgres \"Orders DB\" datastore\n\n  payments_svc = sys/server \"Payments Service\" {\n    subtitle: \"Node.js\"\n  }\n  payments_db = logos/postgres \"Payments DB\" datastore\n\n  inventory_svc = sys/server \"Inventory Service\" {\n    subtitle: \"Node.js\"\n  }\n  inventory_db = logos/postgres \"Inventory DB\" datastore\n\n  cart_svc -> cart_cache\n  checkout_svc -> checkout_db\n  checkout_svc -> cart_svc \"reads cart\"\n  checkout_svc -> catalog_domain.pricing_svc \"gets pricing\"\n  checkout_svc -> payments_svc \"processes payment\"\n  checkout_svc -> orders_svc \"creates order\"\n\n  orders_svc -> orders_db\n  orders_svc -> inventory_svc \"reserves stock\"\n\n  payments_svc -> payments_db\n\n  inventory_svc -> inventory_db\n\n  layout {\n    rows [cart_svc checkout_svc] [orders_svc payments_svc inventory_svc] [cart_cache checkout_db orders_db payments_db inventory_db]\n  }\n}\n\nbff -> order_domain.cart_svc \"manages cart\"\nbff -> order_domain.checkout_svc \"checkout\"\nbff -> order_domain.orders_svc \"views orders\"\norder_domain.checkout_svc -> catalog_domain.pricing_svc \"gets pricing\"\norder_domain.orders_svc ~> bus \"order events\"\norder_domain.payments_svc ~> bus \"payment events\"\norder_domain.payments_svc -> stripe \"processes payment\"\nview orders { scope order_domain }\n";

type Rect = { x: number; y: number; w: number; h: number };
const drawn = (r: Rect): Rect => ({ x: r.x, y: r.y + Math.round((r.h - 18) / 2), w: r.w, h: 18 });
const hit = (a: Rect, b: Rect, m = 0) =>
  a.x < b.x + b.w + m && a.x + a.w + m > b.x && a.y < b.y + b.h + m && a.y + a.h + m > b.y;
const segs = (e: PEdge): Rect[] =>
  e.points.slice(1).map((b, i) => {
    const a = e.points[i];
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
  });

describe("an ELK pill on a coplanar crossing yields to the wire", () => {
  it("the context edge threads the gutter, and its pill is off the wire and off the wire's pill", async () => {
    const built = buildProject([{ name: "seam.squinch", src: SRC }]);
    expect(built.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const view = built.model.views.find((v) => v.name === "orders")!;
    const { positioned } = await layoutView(built.model, view, { metrics: "inter", scale: 1 });

    const reads = positioned.edges.find((e) => e.label === "reads cart")!;
    const views = positioned.edges.find((e) => e.label === "views orders")!;
    expect(reads.coplanar).toBe(true);
    expect(views.coplanar).toBeUndefined();
    const wire = segs(reads)[0];
    expect(wire.h).toBe(0); // one straight run across the gutter

    // The shape under test, not an accident of layout: the ELK edge really
    // does cross that run, so without the pass its label would sit on it.
    const crosses = segs(views).some((s) => s.w === 0 && s.x > wire.x && s.x < wire.x + wire.w && s.y < wire.y && s.y + s.h > wire.y);
    expect(crosses, "the fixture no longer threads the gutter — rebuild it from a dump").toBe(true);

    const pill = drawn(views.labelRect!);
    expect(hit(pill, wire, 4), "pill still on the coplanar wire").toBe(false);
    expect(hit(pill, drawn(reads.labelRect!), 4), "pill still on the coplanar pill").toBe(false);
    // and it stayed beside its own vertical run rather than wandering
    const host = segs(views).find((s) => s.w === 0 && s.y <= pill.y && s.y + s.h >= pill.y + pill.h)!;
    expect(host, "pill left its hosting segment").toBeDefined();

    const ctx = { zoneMembers: new Map(), channelTargets: new Set<string>() };
    expect(checkLayout(positioned, ctx)).toEqual([]);
  });
});
