import { describe, it, expect } from "vitest";
import {
  cameraKey, clampCamera, containK, fitCamera, lerpCamera, normalizeWheel, panBy, pinchStep, sameCamera,
  toLocal, toScreen, wheelPan, wheelZoomFactor, zoomAt, zoomLimits, diveTransforms,
  KEEP_VISIBLE, MAX_K, type Camera, type CamSize,
} from "../src/api.js";

const VIEW: CamSize = { w: 1000, h: 600 };
const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);
/** deterministic pseudo-random stream — a property test that fails must fail the same way twice */
const stream = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

describe("fitCamera — where a view arrives", () => {
  it("a diagram that fits opens at 1:1, centred, never scaled up", () => {
    expect(fitCamera({ w: 400, h: 200 }, VIEW, { pad: 40 })).toEqual({ k: 1, x: 300, y: 200 });
  });

  it("a wide one shrinks to the width and shows whole", () => {
    const c = fitCamera({ w: 4000, h: 600 }, VIEW, { pad: 40 });
    close(c.k, 920 / 4000);
    close(c.x, 40);
    close(c.y, 40 + (520 - 600 * c.k) / 2); // centred vertically, the whole thing on screen
  });

  it("a tall one keeps its width and opens at the TOP — not as a contain-fit strip", () => {
    // The regression this pins: contain would be 0.13, a legibility floor 0.6.
    // Both surfaces opened this at 1:1 from the top before there was a camera.
    const c = fitCamera({ w: 900, h: 4000 }, VIEW, { pad: 40 });
    expect(c).toEqual({ k: 1, x: 50, y: 40 });
  });

  it("a phone in portrait shows the whole width, as it always has", () => {
    const c = fitCamera({ w: 1200, h: 800 }, { w: 375, h: 700 }, { pad: 16 });
    close(c.k, 343 / 1200);
    close(c.x, 16);
    expect(c.y).toBeGreaterThan(16); // short enough to centre
  });

  it("presentation contains, and scales a small diagram UP", () => {
    const c = fitCamera({ w: 400, h: 200 }, VIEW, { pad: 0, upscale: true });
    expect(c).toEqual({ k: 2.5, x: 0, y: 50 });
  });

  it("per-side padding, and degenerate sizes do not divide by zero", () => {
    const c = fitCamera({ w: 400, h: 200 }, VIEW, { pad: { top: 100, right: 0, bottom: 0, left: 0 } });
    expect(c).toEqual({ k: 1, x: 300, y: 100 + 150 });
    expect(fitCamera({ w: 0, h: 0 }, VIEW)).toEqual({ x: 0, y: 0, k: 1 });
    expect(fitCamera({ w: 10, h: 10 }, { w: 0, h: 0 })).toEqual({ x: 0, y: 0, k: 1 });
  });
});

describe("zoom", () => {
  const limits = { min: 0.1, max: MAX_K };

  it("keeps the point under the cursor over the same piece of content", () => {
    const next = stream(7);
    for (let i = 0; i < 200; i++) {
      const cam: Camera = { x: next() * 800 - 400, y: next() * 600 - 300, k: 0.2 + next() * 3 };
      const p = { x: next() * 1000, y: next() * 600 };
      const before = toLocal(cam, { ...p, w: 0, h: 0 });
      const z = zoomAt(cam, p, 0.5 + next() * 2, limits);
      const after = toLocal(z, { ...p, w: 0, h: 0 });
      close(before.x, after.x, 1e-6);
      close(before.y, after.y, 1e-6);
    }
  });

  it("stops at the limits without drifting the anchor", () => {
    const cam = { x: 10, y: 20, k: 3.9 };
    const z = zoomAt(cam, { x: 500, y: 300 }, 10, limits);
    expect(z.k).toBe(MAX_K);
    const a = toLocal(cam, { x: 500, y: 300, w: 0, h: 0 }), b = toLocal(z, { x: 500, y: 300, w: 0, h: 0 });
    close(a.x, b.x); close(a.y, b.y);
    expect(zoomAt(z, { x: 0, y: 0 }, 2, limits)).toEqual(z); // already there: identity
  });

  it("zooming out always reaches the whole diagram; zooming in stops at MAX_K", () => {
    const tall = { w: 900, h: 4000 };
    const l = zoomLimits(tall, VIEW, { pad: 40 });
    expect(l.min).toBeLessThanOrEqual(containK(tall, VIEW, 40)); // the whole of it is reachable
    expect(l.max).toBe(MAX_K);
    // …unless presentation already scaled a tiny diagram past it
    expect(zoomLimits({ w: 100, h: 50 }, VIEW, { upscale: true }).max).toBe(10);
  });

  it("a mouse notch is capped near one button step; a pinch delta passes through", () => {
    close(wheelZoomFactor(100), Math.exp(-0.24));
    close(wheelZoomFactor(-100), Math.exp(0.24));
    close(wheelZoomFactor(3), Math.exp(-0.03));
    expect(wheelZoomFactor(0)).toBe(1);
  });

  it("two fingers: scale about where they were, follow where they went", () => {
    const cam = { x: 0, y: 0, k: 1 };
    const z = pinchStep(cam, { x: 400, y: 300 }, { x: 600, y: 300 }, { x: 350, y: 320 }, { x: 750, y: 320 }, limits);
    close(z.k, 2);
    // the content under the old midpoint is now under the new midpoint
    const under = toLocal(z, { x: 550, y: 320, w: 0, h: 0 });
    close(under.x, 500); close(under.y, 300);
    expect(pinchStep(cam, { x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 }, limits)).toEqual(cam);
  });
});

describe("the zoom keys — one table for every host", () => {
  const key = (k: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {}) =>
    cameraKey({ key: k, metaKey: false, ctrlKey: false, altKey: false, ...mods });

  it("bare + − 0 1 zoom, fit and go to actual size", () => {
    expect(key("=")).toEqual({ act: "in", chord: false });
    expect(key("+")).toEqual({ act: "in", chord: false });
    expect(key("-")).toEqual({ act: "out", chord: false });
    expect(key("_")).toEqual({ act: "out", chord: false });
    expect(key("0")).toEqual({ act: "fit", chord: false });
    expect(key("1")).toEqual({ act: "actual", chord: false });
  });

  it("⌘ and Ctrl + − 0 zoom the diagram, not the page", () => {
    for (const mod of [{ metaKey: true }, { ctrlKey: true }]) {
      expect(key("=", mod)).toEqual({ act: "in", chord: true });
      expect(key("+", mod)).toEqual({ act: "in", chord: true });
      expect(key("-", mod)).toEqual({ act: "out", chord: true });
      expect(key("0", mod)).toEqual({ act: "fit", chord: true });
    }
  });

  it("leaves the browser its tab switch, Alt chords and everything else", () => {
    expect(key("1", { metaKey: true })).toBeNull();
    expect(key("1", { ctrlKey: true })).toBeNull();
    expect(key("=", { altKey: true })).toBeNull();
    expect(key("s", { metaKey: true })).toBeNull();
    expect(key("a")).toBeNull();
  });
});

describe("the two movement rules", () => {
  const content = { w: 600, h: 400 };

  it("a drag can take the content mostly off-screen, never entirely", () => {
    const far = clampCamera({ x: -5000, y: 5000, k: 1 }, content, VIEW);
    expect(far.x).toBe(KEEP_VISIBLE - 600);
    expect(far.y).toBe(600 - KEEP_VISIBLE);
    const inside = { x: 123, y: 45, k: 1.5 };
    expect(clampCamera(inside, content, VIEW)).toEqual(inside);
    // a tiny pane or tiny content halves the margin rather than pinning the content
    expect(clampCamera({ x: 999, y: 0, k: 1 }, { w: 40, h: 40 }, { w: 100, h: 100 }).x).toBe(80);
  });

  it("the wheel does nothing to a diagram that already fits", () => {
    const fit = fitCamera(content, VIEW, { pad: 40 });
    expect(wheelPan(fit, 0, 120, content, VIEW, 40)).toEqual(fit);
    expect(wheelPan(fit, -300, -300, content, VIEW, 40)).toEqual(fit);
  });

  it("a tall diagram scrolls from its top to its bottom and stops at both", () => {
    const tall = { w: 900, h: 4000 };
    let cam = fitCamera(tall, VIEW, { pad: 40 });
    expect(wheelPan(cam, 0, -50, tall, VIEW, 40)).toEqual(cam); // already at the top
    for (let i = 0; i < 100; i++) cam = wheelPan(cam, 0, 100, tall, VIEW, 40);
    expect(cam.y).toBe(600 - 4000 - 40); // bottom edge + padding, no further
    expect(cam.x).toBe(50); // and never sideways: it fits that way
  });

  it("content a drag left half off-screen scrolls back without snapping", () => {
    const dragged = clampCamera({ x: -400, y: 0, k: 1 }, content, VIEW); // half off the left edge
    const one = wheelPan(dragged, -30, 0, content, VIEW, 40);
    expect(one.x).toBe(dragged.x + 30); // one tick = one tick, not a jump to the bounds
    expect(wheelPan(dragged, 30, 0, content, VIEW, 40)).toEqual(dragged); // and never further out
    let cam = dragged;
    for (let i = 0; i < 100; i++) cam = wheelPan(cam, -30, 0, content, VIEW, 40);
    expect(cam.x).toBe(40); // home, then it stops
  });

  it("INVARIANT: from any state a drag can reach, the wheel never moves content further out, always lets it back, and zero is the identity", () => {
    const next = stream(42);
    const out = (pos: number, lo: number, hi: number) => (pos < lo ? lo - pos : pos > hi ? pos - hi : 0);
    for (let i = 0; i < 2000; i++) {
      const c = { w: 50 + next() * 3000, h: 50 + next() * 3000 };
      const k = 0.1 + next() * 4;
      const cam = clampCamera({ x: next() * 8000 - 4000, y: next() * 8000 - 4000, k }, c, VIEW);
      const pad = 40;
      const bounds = (size: number, view: number) => {
        const a = pad, b = view - size - pad;
        return [Math.min(a, b), Math.max(a, b)] as const;
      };
      const [xl, xh] = bounds(c.w * k, VIEW.w), [yl, yh] = bounds(c.h * k, VIEW.h);
      expect(wheelPan(cam, 0, 0, c, VIEW, pad)).toEqual(cam);
      const d = { x: next() * 600 - 300, y: next() * 600 - 300 };
      const w = wheelPan(cam, d.x, d.y, c, VIEW, pad);
      expect(out(w.x, xl, xh)).toBeLessThanOrEqual(out(cam.x, xl, xh) + 1e-9);
      expect(out(w.y, yl, yh)).toBeLessThanOrEqual(out(cam.y, yl, yh) + 1e-9);
      // it can always come back: a big enough scroll toward the bounds lands inside them
      const home = wheelPan(cam, cam.x < xl ? -1e6 : 1e6, cam.y < yl ? -1e6 : 1e6, c, VIEW, pad);
      expect(out(home.x, xl, xh)).toBe(0);
      expect(out(home.y, yl, yh)).toBe(0);
    }
  });
});

describe("wheel normalisation", () => {
  it("pixels pass through; lines and pages are converted", () => {
    expect(normalizeWheel({ deltaMode: 0, deltaX: 3, deltaY: -7, shiftKey: false }, VIEW)).toEqual({ dx: 3, dy: -7 });
    expect(normalizeWheel({ deltaMode: 1, deltaX: 0, deltaY: 3, shiftKey: false }, VIEW)).toEqual({ dx: 0, dy: 48 });
    expect(normalizeWheel({ deltaMode: 2, deltaX: 1, deltaY: 1, shiftKey: false }, VIEW)).toEqual({ dx: 1000, dy: 600 });
  });

  it("Shift turns a vertical wheel sideways, and leaves a real horizontal one alone", () => {
    expect(normalizeWheel({ deltaMode: 0, deltaX: 0, deltaY: 40, shiftKey: true }, VIEW)).toEqual({ dx: 40, dy: 0 });
    expect(normalizeWheel({ deltaMode: 0, deltaX: 9, deltaY: 40, shiftKey: true }, VIEW)).toEqual({ dx: 9, dy: 40 });
  });
});

describe("spaces and tweens", () => {
  it("toLocal and toScreen are inverses", () => {
    const cam = { x: -200, y: -100, k: 2 };
    const b = { x: 37, y: -12, w: 300, h: 180 };
    const r = toScreen(cam, toLocal(cam, b));
    close(r.x, b.x); close(r.y, b.y); close(r.w, b.w); close(r.h, b.h);
    expect(panBy(cam, 5, -5)).toEqual({ x: -195, y: -105, k: 2 });
  });

  it("a tween starts and ends exactly where it should, and scales geometrically", () => {
    const a = { x: 0, y: 0, k: 1 }, b = { x: -900, y: -500, k: 4 };
    expect(sameCamera(lerpCamera(a, b, 0, VIEW), a)).toBe(true);
    expect(sameCamera(lerpCamera(a, b, 1, VIEW), b)).toBe(true);
    const m = lerpCamera(a, b, 0.5, VIEW);
    expect(m.k).toBeGreaterThan(1);
    expect(m.k).toBeLessThan(4);
  });
});

describe("the dive runs in camera space", () => {
  // The worked example both plan reviews verified by hand. The user has panned
  // and zoomed the old view to {−200, −100, ×2} and clicks a card; the new view
  // arrives at its own fit. Everything handed to diveTransforms is in the NEW
  // camera's local space, and the function itself is unchanged.
  const oldCam = { x: -200, y: -100, k: 2 };
  const oldContent = { x: 0, y: 0, w: 600, h: 472 };
  const card = { x: 300, y: 200, w: 160, h: 90 }; // old-content-local
  const newContent = { w: 1200, h: 800 };
  const newCam = fitCamera(newContent, VIEW, { pad: 40, upscale: true });

  it("the new view's camera", () => {
    close(newCam.k, 0.65); close(newCam.x, 110); close(newCam.y, 40);
  });

  it("the ghost's first frame is exactly what the user was looking at", () => {
    const oldRect = toScreen(oldCam, oldContent);
    expect(oldRect).toEqual({ x: -200, y: -100, w: 1200, h: 944 });
    const ghostBox = toLocal(newCam, oldRect);
    const back = toScreen(newCam, ghostBox); // with transform: none, this is where it paints
    close(back.x, -200); close(back.y, -100); close(back.w, 1200); close(back.h, 944);
  });

  it("the anchor ends at the viewport centre, and the live layer settles at the fit", () => {
    const ghostBox = toLocal(newCam, toScreen(oldCam, oldContent));
    const anchor = toLocal(newCam, toScreen(oldCam, card));
    const view = toLocal(newCam, { x: 0, y: 0, ...{ w: VIEW.w, h: VIEW.h } });
    const liveBox = { x: 0, y: 0, ...newContent };
    const t = diveTransforms({ view, ghostBox, liveBox, anchor, dir: "in" });
    // the dive scale is the same number it would be in screen space
    expect(t.gEnd).toMatch(/scale\(3\.125\)$/);
    const [, dx, dy] = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(t.gEnd)!.map(Number);
    const A = { x: anchor.x + anchor.w / 2, y: anchor.y + anchor.h / 2 };
    const end = toScreen(newCam, { x: A.x + dx, y: A.y + dy, w: 0, h: 0 });
    close(end.x, 500, 1e-3); close(end.y, 300, 1e-3);
    // live's last frame is `transform: none`, i.e. the fit
    expect(toScreen(newCam, liveBox)).toEqual({ x: 110, y: 40, w: 780, h: 520 });
    expect(t.lOrigin).toBe("600px 400px");
  });
});
