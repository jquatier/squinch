// A label on a wire that threads a busy gutter (docs/notes/edge-labels.md).
// Gauntlet round 30 found it in two of three cold answers to prompt 34: a
// context edge passing between two row-mates had its label dropped on the
// labelled wire that joins them — `views orders` drawn on top of `reads cart`.
//
// The fixture is that answer's `orders` view cut down to what showed it: a
// context leaf above a band of two, a labelled wire between the two, and a
// context card off to the side that widens the band. The promise is about the
// picture, however the wires come to run: no label sits on another edge's
// wire, or on another label.
import { describe, it, expect } from "vitest";
import { buildProject } from "../src/index.js";
import { layoutView, type PEdge } from "../src/layout/layout.js";
import { checkLayout, labelsOnWires } from "./invariants.js";

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

describe("a label beside a labelled wire between two row-mates", () => {
  it("is off that wire and off its pill, and stays on its own wire", async () => {
    const built = buildProject([{ name: "seam.squinch", src: SRC }]);
    expect(built.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const view = built.model.views.find((v) => v.name === "orders")!;
    const { positioned } = await layoutView(built.model, view, { metrics: "inter", scale: 1 });

    const reads = positioned.edges.find((e) => e.label === "reads cart")!;
    const views = positioned.edges.find((e) => e.label === "views orders")!;
    // the two row-mates are joined by one straight run across the gutter
    expect(segs(reads)).toHaveLength(1);
    expect(segs(reads)[0].h).toBe(0);

    const pill = drawn(views.labelRect!);
    expect(hit(pill, segs(reads)[0], 4), "`views orders` is on the `reads cart` wire").toBe(false);
    expect(hit(pill, drawn(reads.labelRect!), 4), "`views orders` is on the `reads cart` pill").toBe(false);
    // and it is on a run of its own wire rather than adrift
    expect(segs(views).some((s) => hit(pill, s)), "pill left its own wire").toBe(true);

    // …and the same of every label in the view
    expect(labelsOnWires(positioned)).toEqual([]);
    expect(checkLayout(positioned)).toEqual([]);
  });
});
