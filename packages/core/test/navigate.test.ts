// Altitude navigation: the scope arithmetic that decides where a zoom goes,
// and the geometry that decides how it moves.
//
// These tests came from `apps/spa/test/lib.test.ts` along with the code, when
// the interactive HTML export made the playground stop being the only surface
// that navigates. The four functions lifted out of `App.tsx` — `viewForPath`,
// `hop`, `crumbs`, `upView` — drove every navigation in the playground with no
// test of any kind; they have one now, which is most of the point of moving
// them somewhere reachable.
import { describe, it, expect } from "vitest";
import {
  stepToward, ancestors, parentScope, viewForPath, hop, crumbs, upView, type NavView,
} from "../src/view/navigate.js";
import { diveTransforms, scaleFor, CAP, DIVE, CUT, type Box } from "../src/view/dive.js";

describe("stepToward — which card the zoom flies through", () => {
  // Six lines, five branches, and it decides the direction of every navigation
  // in the app. It had no test.
  it("from the top, the step is the outermost segment", () => {
    expect(stepToward(undefined, "shop.api.handler")).toBe("shop");
    expect(stepToward(undefined, "shop")).toBe("shop");
  });

  it("from inside, the step is exactly one level deeper", () => {
    expect(stepToward("shop", "shop.api")).toBe("shop.api");
    expect(stepToward("shop", "shop.api.handler")).toBe("shop.api");
    expect(stepToward("shop.api", "shop.api.handler")).toBe("shop.api.handler");
  });

  it("has no step when there is nothing to travel through", () => {
    expect(stepToward("shop", "shop")).toBeUndefined(); // same altitude
    expect(stepToward("shop", "orders.api")).toBeUndefined(); // lateral hop
    expect(stepToward("shop", undefined)).toBeUndefined();
  });

  it("is not fooled by a shared prefix that is not a path boundary", () => {
    // `shopping` starts with `shop` but is not inside it. A `startsWith` without
    // the dot would call this a dive and anchor on a card that does not exist.
    expect(stepToward("shop", "shopping.api")).toBeUndefined();
  });
});

describe("scope trails", () => {
  it("lists ancestors outermost first", () => {
    expect(ancestors("a.b.c")).toEqual(["a", "a.b", "a.b.c"]);
    expect(ancestors("a")).toEqual(["a"]);
    expect(ancestors(undefined)).toEqual([]);
  });

  it("walks one level out, and stops at the top", () => {
    expect(parentScope("a.b.c")).toBe("a.b");
    expect(parentScope("a")).toBeUndefined();
    expect(parentScope(undefined)).toBeUndefined();
  });
});

describe("diveTransforms — the anchored dive", () => {
  const view: Box = { x: 0, y: 0, w: 1000, h: 800 };
  const layer: Box = { x: 0, y: 0, w: 1000, h: 800 };
  const anchor: Box = { x: 400, y: 300, w: 200, h: 100 };

  const parse = (t: string) => {
    const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(t);
    return m ? { dx: +m[1], dy: +m[2], k: +m[3] } : undefined;
  };

  it("without an anchor it cuts instead of diving", () => {
    const r = diveTransforms({ view, ghostBox: layer, liveBox: layer, dir: "in" });
    expect(r.ms).toBe(CUT.ms);
    expect(r.gEnd).toBe("scale(.97)");
    expect(r.gOrigin).toBe("50% 50%");
  });

  it("with an anchor it dives", () => {
    const r = diveTransforms({ view, ghostBox: layer, liveBox: layer, anchor, dir: "in" });
    expect(r.ms).toBe(DIVE.ms);
  });

  it("in and out are exact inverses", () => {
    // One pair of expressions covers both directions, which is what makes it
    // easy to break one while the other still looks right. Off-centre in both
    // axes on purpose: with a centred anchor dx is 0 and the property holds
    // trivially in x.
    const off: Box = { x: 120, y: 300, w: 200, h: 100 }; // centre (220, 350)
    const t = (dir: "in" | "out") =>
      parse(diveTransforms({ view, ghostBox: layer, liveBox: layer, anchor: off, dir }).gEnd)!;
    const i = t("in"), o = t("out");
    expect(i.dx).toBe(280); // 500 - 220
    expect(o.dx).toBe(-280);
    expect(o.dy).toBe(-i.dy);
    expect(o.k).toBeCloseTo(1 / i.k, 10);
  });

  it("travels toward the anchor's centre, not the origin", () => {
    // anchor centre (500,350) → view centre (500,400): straight down 50px
    const r = parse(diveTransforms({ view, ghostBox: layer, liveBox: layer, anchor, dir: "in" }).gEnd)!;
    expect(r.dx).toBe(0);
    expect(r.dy).toBe(50);
  });

  it("clamps the scale at both ends", () => {
    // a card almost filling the screen would otherwise barely move…
    expect(scaleFor(view, { x: 0, y: 0, w: 990, h: 790 })).toBe(1.15);
    // …and a tiny one would fly past far enough to read as a jump cut
    expect(scaleFor(view, { x: 0, y: 0, w: 2, h: 2 })).toBe(CAP);
  });

  it("the incoming layer travels less than the outgoing one", () => {
    // A full mirror overshoots and reads as two animations back to back.
    const r = diveTransforms({ view, ghostBox: layer, liveBox: layer, anchor, dir: "in" });
    const out = parse(r.gEnd)!, incoming = parse(r.lStart)!;
    expect(1 / incoming.k).toBeLessThan(out.k);
    expect(1 / incoming.k).toBeGreaterThan(1);
  });

  it("measures each layer's origin against its own box", () => {
    // The layers can be scrolled differently; using one box for both puts the
    // transform origin in the wrong place on whichever layer is offset.
    const r = diveTransforms({
      view, ghostBox: { x: 0, y: 0, w: 1000, h: 800 },
      liveBox: { x: 100, y: 40, w: 1000, h: 800 }, anchor, dir: "in",
    });
    expect(r.gOrigin).toBe("500px 350px"); // anchor centre, ghost at origin
    expect(r.lOrigin).toBe("400px 360px"); // view centre minus the live offset
  });
});

// ── the four that came out of App.tsx ────────────────────────────────────────

/** `examples/microservices`, as `viewIndex` reports it: three views share the
 *  `orders` scope, which is the case the first-match rule turns on. */
const VIEWS: NavView[] = [
  { name: "landscape" },
  { name: "catalog", scope: "catalog" },
  { name: "orders", scope: "orders" },
  { name: "accounts", scope: "accounts" },
  { name: "orders-pci", scope: "orders" },
  { name: "checkout", scope: "orders" },
  { name: "web", scope: "web", auto: true },
];

describe("viewForPath — where a clicked card goes", () => {
  it("finds the view scoped to that container", () => {
    expect(viewForPath(VIEWS, "landscape", "catalog")?.name).toBe("catalog");
  });

  it("takes the first of several views at one scope", () => {
    // `orders`, `orders-pci` and `checkout` all scope to `orders`. Clicking the
    // card lands on `orders` — declaration order decides, and that is the
    // behaviour, not an accident to be improved away.
    expect(viewForPath(VIEWS, "landscape", "orders")?.name).toBe("orders");
  });

  it("never returns the view you are already in", () => {
    // otherwise clicking the card you are inside re-enters it and the stage
    // animates a dive to nowhere
    expect(viewForPath(VIEWS, "orders", "orders")?.name).toBe("orders-pci");
  });

  it("has nowhere to go for a leaf", () => {
    expect(viewForPath(VIEWS, "landscape", "orders.api")).toBeUndefined();
  });
});

describe("hop — direction, derived from the scopes", () => {
  it("dives in, anchored on the card both views share", () => {
    expect(hop(VIEWS, "landscape", "orders")).toEqual({ dir: "in", anchor: "orders" });
  });

  it("climbs out, anchored on the same card", () => {
    expect(hop(VIEWS, "orders", "landscape")).toEqual({ dir: "out", anchor: "orders" });
  });

  it("cuts sideways, with no anchor", () => {
    // `orders` → `orders-pci` is the same altitude through a different lens.
    // There is no shared card to fly through, so the stage falls back to a cut.
    expect(hop(VIEWS, "orders", "orders-pci")).toEqual({ dir: "in" });
  });

  it("cuts between two unrelated branches", () => {
    expect(hop(VIEWS, "catalog", "accounts")).toEqual({ dir: "in" });
  });
});

describe("crumbs and upView — the way back", () => {
  it("starts at the landscape when one exists", () => {
    expect(crumbs(VIEWS, undefined)).toEqual([{ label: "landscape", view: "landscape" }]);
  });

  it("names every ancestor, and links the ones that have a view", () => {
    expect(crumbs(VIEWS, "orders")).toEqual([
      { label: "landscape", view: "landscape" },
      { label: "orders", view: "orders" },
    ]);
    // a hop with no view of its own still appears — it is part of the path
    expect(crumbs(VIEWS, "orders.handlers")).toEqual([
      { label: "landscape", view: "landscape" },
      { label: "orders", view: "orders" },
      { label: "handlers", view: undefined },
    ]);
  });

  it("has no landscape crumb when no view sits at the top", () => {
    expect(crumbs([{ name: "orders", scope: "orders" }], "orders"))
      .toEqual([{ label: "orders", view: "orders" }]);
  });

  it("climbs to the nearest ancestor that is actually a view", () => {
    expect(upView(VIEWS, "orders", "orders")).toBe("landscape");
    // from a scope with no view of its own, the parent's view is the target
    expect(upView(VIEWS, undefined, "orders.handlers")).toBe("orders");
  });

  it("has nowhere up to go from the top", () => {
    expect(upView(VIEWS, "landscape", undefined)).toBeUndefined();
  });
});
