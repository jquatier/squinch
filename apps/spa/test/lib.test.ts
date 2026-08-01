// The playground's logic, tested without a browser.
//
// ~1,000 non-presentational lines shipped with no test of any kind — `pnpm -r
// test` skipped the package entirely, and CI's only assertion was that it
// compiles. The four modules under src/lib/ are the parts where being wrong is
// invisible until someone notices the animation feels off or a share link does
// not open, so they were pulled out of the components to be reachable.
import { describe, it, expect } from "vitest";
import { stepToward, ancestors, parentScope } from "../src/lib/path";
import { isolateIds } from "../src/lib/isolate";
import { encodeShare, decodeShare } from "../src/lib/share";
import { diveTransforms, scaleFor, CAP, DIVE, CUT, type Box } from "../src/lib/dive";

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

describe("isolateIds — keeping two layers apart", () => {
  it("prefixes definitions and every kind of reference", () => {
    const out = isolateIds(
      `<symbol id="i-lambda"/><use href="#i-lambda"/><g clip-path="url(#c1)"/>`,
    );
    expect(out).toContain('id="ghost-i-lambda"');
    expect(out).toContain('href="#ghost-i-lambda"');
    expect(out).toContain("url(#ghost-c1)");
  });

  it("is idempotent — the ghost is re-isolated whenever the source changes", () => {
    // The original prefixed unconditionally, so a second pass produced
    // `ghost-ghost-i-lambda` and the layer lost its artwork. Nothing caught it
    // because it only happens mid-transition.
    const once = isolateIds(`<symbol id="a"/><use href="#a"/>`);
    expect(isolateIds(once)).toBe(once);
  });

  it("leaves everything else alone", () => {
    const svg = `<rect x="1" y="2" fill="#fff"/><text>id="not-an-attribute"</text>`;
    expect(isolateIds(svg)).toContain('fill="#fff"');
  });

  it("survives what the renderer actually emits", () => {
    // core namespaces pack ids as `sq-<pack>-<id>`; this is the coupling that
    // breaks silently if that scheme ever changes.
    const real = `<defs><symbol id="sq-aws-lambda" viewBox="0 0 80 80"></symbol></defs>` +
      `<use href="#sq-aws-lambda" width="40" height="40"/>`;
    const out = isolateIds(real);
    expect(out.match(/ghost-/g)?.length).toBe(2);
  });
});

describe("share links", () => {
  const round = (s: string) => decodeShare(encodeShare(s));

  it("round-trips ordinary source", () => {
    const src = `system s "S" {\n  a = aws/lambda "A"\n}\n`;
    expect(round(src)).toBe(src);
  });

  it("round-trips non-ASCII — labels are prose, and prose has accents", () => {
    for (const s of ["café — naïve", "日本語のラベル", "emoji 🎯 in a label", "→ ← ↔"])
      expect(round(s)).toBe(s);
  });

  it("emits nothing that needs escaping in a URL fragment", () => {
    const enc = encodeShare("a".repeat(100) + "?&#=/+");
    expect(enc).not.toMatch(/[+/=]/);
    expect(enc).toBe(encodeURIComponent(enc));
  });

  it("handles a diagram big enough to be worth sharing", () => {
    // The original spread every byte as a separate argument to fromCharCode,
    // which is a RangeError somewhere past ~64k — and a big diagram is exactly
    // the one you send to someone.
    const big = `// a large diagram\n`.repeat(20_000); // ~380 KB
    expect(big.length).toBeGreaterThan(300_000);
    expect(round(big)).toBe(big);
  });

  it("returns undefined rather than throwing on a mangled fragment", () => {
    expect(decodeShare("!!!not base64!!!")).toBeUndefined();
  });

  it("round-trips the empty document", () => {
    expect(round("")).toBe("");
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
