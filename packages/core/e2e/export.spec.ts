// Smoke test for the interactive export, in a real browser, over `file://`.
//
// Everything here is something the unit tests structurally cannot check. They
// assert the file is well-formed, self-contained and deterministic; whether it
// *works* — whether a hoisted `<symbol>` in one `<svg>` actually paints inside
// another, whether a click dives, whether a key steps — needs an engine.
//
// `file://` on purpose: that is how this artifact gets opened, and it is a
// stricter origin than http, so a passing run here means a mailed file works.
import { test, expect, type Page } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { exportHTML } from "../src/index.js";
import type { HTMLExportOpts } from "../src/render/html.js";

const SRC = `pack aws

person shopper "Shopper"

system web "Storefront" {
  description: "React SPA on S3"
  glyph: sys/app-window
  cdn = aws/cloudfront "CloudFront"
  s3  = aws/s3 "Bucket"
  cdn -> s3 "origin"
}

system api "Order Service" {
  description: "Cart and checkout"
  glyph: sys/code
  gw = aws/api-gateway "Gateway"
  fn = aws/lambda "Handler"
  db = aws/dynamodb "Orders" datastore
  gw -> fn "route"
  fn -> db "write"
}

// no 'view ops' block: the auto-view shape, which is the Storefront bug's
system ops "Ops Tooling" {
  description: "Dashboards and alerts"
  glyph: sys/activity
  dash = aws/cloudwatch "Dashboards"
}

shopper -> web.cdn "browses"
web.cdn -> api.gw "REST"
ops.dash -> api.gw "scrapes"

flow checkout "Placing an order" {
  api.gw -> api.fn -> api.db
}

view landscape { include * }
view web { scope web }
view api { scope api }
view story { scope api; show flow checkout }
`;

const dir = mkdtempSync(join(tmpdir(), "squinch-e2e-"));

/** Click the card, not its text. The runtime binds to `closest("[data-path]")`,
 *  so that is the affordance; and a `<text>` glyph is not reliably the hit-test
 *  winner over the canvas rect beneath it — WebKit hands the rect back where
 *  Chromium hands back the text, which cost a confusing half hour. */
const card = (page: Page, path: string) => page.locator(`#sq-live [data-path="${path}"]`);
async function open(page: Page, opts: HTMLExportOpts = {}, name = "d.html") {
  const r = await exportHTML([{ name: "shop.squinch", src: SRC }], opts);
  expect(r.ok, r.diagnostics.map((d) => d.message).join("; ")).toBe(true);
  const file = join(dir, `${page.context().browser()?.browserType().name()}-${name}`);
  writeFileSync(file, r.html!);
  await page.goto(pathToFileURL(file).href);
  return r;
}

test("icons actually paint — the hoisted sprite resolves across <svg> roots", async ({ page }) => {
  // THE test. Every view's body references `<use href="#sq-aws-lambda">` while
  // the `<symbol>` lives in a different `<svg>` at the top of the document. If
  // that does not resolve, the file still parses, still validates, still has no
  // duplicate ids — and every icon is an empty hole. Only a layout engine can
  // tell the difference, which is the reason this whole spec exists.
  await open(page);
  await card(page, "api").waitFor();

  const painted = await page.evaluate(() => {
    const use = document.querySelector("#sq-live use");
    if (!use) return "no <use> in the live view";
    const box = (use as SVGGraphicsElement).getBoundingClientRect();
    if (!box.width || !box.height) return "the <use> has no box";
    // a resolved <use> instantiates its symbol's shadow content; an unresolved
    // one is an empty element that still reports its own width
    const inst = (use as SVGUseElement).instanceRoot ?? null;
    return { w: Math.round(box.width), resolved: !!inst || box.width > 0 };
  });
  expect(painted, "the sprite did not resolve").not.toBe("no <use> in the live view");
  expect(painted).toMatchObject({ resolved: true });

  // and the pixels are not blank where an icon plate sits
  const plate = card(page, "api");
  // PNG size as a blankness proxy: an empty plate compresses to almost nothing,
  // a painted one does not. Cheaper and less brittle than a pixel baseline,
  // which would fail on every legitimate render change.
  const shot = await plate.screenshot();
  expect(shot.byteLength).toBeGreaterThan(1000);
});

test("clicking a card dives, and the active tab follows", async ({ page }) => {
  await open(page);
  await expect(page.locator("#sq-tabs .on")).toHaveText("landscape");

  await card(page, "api").click();
  await expect(page.locator("#sq-tabs .on")).toHaveText("api");
  // the child view's own nodes are on screen now
  await expect(page.locator('#sq-live [data-path="api.gw"]')).toHaveCount(1);
  // …and once the dive lands, cleanup leaves no transform to snap out of
  // later. Polled, not fixed-waited: settle deliberately follows the *actual*
  // end of the motion (a heavy first paint starts it late), which is the whole
  // fix — the old wall-clock cleanup stripped the transition mid-flight and
  // the diagram visibly jumped a beat after the zoom.
  await expect
    .poll(() => page.evaluate(() => document.querySelector("#sq-live")!.hasAttribute("style")), { timeout: 4000 })
    .toBe(false);
  await expect(page.locator("#sq-ghost")).toBeEmpty();
});

test("a system with no declared view is still a zoom target", async ({ page }) => {
  // Reported against a real export: the `Storefront` card did nothing when
  // clicked. It is the one system in `examples/microservices` with no `view`
  // block of its own, and the export used to bundle declared views only — so a
  // card that dives in the playground was a dead click in the file you send
  // someone. `web` here is that shape: it has an auto view and nothing else.
  await open(page);
  await expect(card(page, "ops")).toHaveClass(/sq-zoom/);
  await card(page, "ops").click();
  await page.waitForTimeout(600);
  await expect(page.locator('#sq-live [data-path="ops.dash"]')).toHaveCount(1);
});

test("a card with nowhere to go does not pretend otherwise", async ({ page }) => {
  // the other half of the same bug: every card wore a zoom cursor whether or
  // not it resolved to a view
  await open(page, { views: "declared" });
  await expect(card(page, "api")).toHaveClass(/sq-zoom/);
  await expect(card(page, "ops")).not.toHaveClass(/sq-zoom/);
});

test("clicking the canvas climbs back out", async ({ page }) => {
  await open(page, { view: "api" });
  await expect(page.locator("#sq-tabs .on")).toHaveText("api");
  // The margin around the artwork, not the artwork: the click listener used to
  // sit on #sq-live, so this corner did nothing — and this test passed anyway,
  // because it asserted `[data-path="web"]`, which view `api` already draws as
  // a context card. The active tab is the thing that only changes on a climb.
  await page.locator("#sq-stage").click({ position: { x: 5, y: 5 } });
  await expect(page.locator("#sq-tabs .on")).toHaveText("landscape");
});

test("presentation mode steps the flow, then the deck", async ({ page }) => {
  await open(page);
  await page.goto(`${page.url()}#story`);
  await page.waitForTimeout(100);

  await page.keyboard.press("p");
  await expect(page.locator("body")).toHaveClass(/presenting/);
  // the counter only appears for a view that has a flow, and opens on hop 1
  await expect(page.locator("#sq-step")).toHaveText("1 / 2");

  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#sq-step")).toHaveText("2 / 2");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("#sq-step")).toHaveText("1 / 2");

  // climbing is a different move from stepping — this is the distinction that
  // would silently collapse if the two axes were ever merged
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(600);
  await expect(page.locator("#sq-tabs .on")).not.toHaveText("story");

  await page.keyboard.press("Escape");
  await expect(page.locator("body")).not.toHaveClass(/presenting/);
});

test("reduced motion cuts straight through — no ghost, ever", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, {}, "reduced.html");

  // observed from inside the page: polling across the wire races the test's own
  // teardown, and a ghost that exists for 40ms would be missed either way
  await page.evaluate(() => {
    (window as unknown as { sqGhosted: boolean }).sqGhosted = false;
    new MutationObserver(() => {
      if (document.querySelector("#sq-ghost")?.childElementCount)
        (window as unknown as { sqGhosted: boolean }).sqGhosted = true;
    }).observe(document.querySelector("#sq-ghost")!, { childList: true, subtree: true });
  });
  await card(page, "api").click();
  await page.waitForTimeout(500);

  const ghosted = await page.evaluate(() => (window as unknown as { sqGhosted: boolean }).sqGhosted);
  expect(ghosted, "a ghost layer appeared under prefers-reduced-motion").toBe(false);
  await expect(page.locator('#sq-live [data-path="api.gw"]')).toHaveCount(1);
});

test("the entry view renders with JavaScript disabled", async ({ browser }) => {
  // progressive enhancement is a claim the unit tests can only make
  // structurally (the body is inline); this is the claim itself
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  await open(page, {}, "nojs.html");
  await expect(page.locator("#sq-live svg")).toHaveCount(1);
  await expect(card(page, "api")).toHaveCount(1);
  await ctx.close();
});

// ── the camera: pan and zoom (docs/notes/pan-zoom.md) ────────────────────────
//
// What can be automated is here; what cannot stays in the note's hand-test
// list — Playwright has no multi-touch, and Safari's `gesture*` events, iOS
// touch, inertia and at-rest sharpness all need a person and a trackpad.

type Cam = { x: number; y: number; k: number };
const camOf = (page: Page) =>
  page.evaluate((): Cam => {
    const t = (document.querySelector("#sq-cam") as HTMLElement).style.transform;
    const m = /translate\(([-\d.e]+)px, ([-\d.e]+)px\) scale\(([-\d.e]+)\)/.exec(t)!;
    return { x: +m[1], y: +m[2], k: +m[3] };
  });
const settled = (page: Page) =>
  page.waitForFunction(
    () => !document.querySelector("#sq-live")!.hasAttribute("style") &&
      !document.querySelector("#sq-ghost")!.firstChild,
    null, { timeout: 5000 },
  );
/** A synthetic wheel plus two frames. `mouse.wheel` with a held modifier is not
 *  something both engines agree on; the event itself is. */
const wheel = (page: Page, at: { x: number; y: number }, deltaY: number, times: number, ctrlKey: boolean) =>
  page.evaluate(({ at, deltaY, times, ctrlKey }) => {
    const stage = document.querySelector("#sq-stage")!;
    for (let i = 0; i < times; i++)
      stage.dispatchEvent(new WheelEvent("wheel", {
        clientX: at.x, clientY: at.y, deltaY, ctrlKey, bubbles: true, cancelable: true,
      }));
    return new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  }, { at, deltaY, times, ctrlKey });
/** The camera has stopped moving: its transform is unchanged for three frames.
 *  Never a fixed sleep — a 160ms tween is not 160ms on a loaded CI runner, and
 *  asserting mid-tween is how this file's first CI run on WebKit failed. */
const atRest = (page: Page) =>
  page.evaluate(() => new Promise<void>((done) => {
    const el = document.querySelector("#sq-cam") as HTMLElement;
    let last = "", still = 0;
    const tick = () => {
      const t = el.style.transform;
      still = t === last ? still + 1 : 0;
      last = t;
      if (still >= 3) done(); else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
const centreOf = async (page: Page, path: string) => {
  const b = (await card(page, path).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

test("a drag that starts on a card pans, and does not dive", async ({ page }) => {
  // The test that proves the click suppressor. Once a press has become a drag
  // the pointer is captured, and the click that follows lands on the stage —
  // which is exactly where the climb handler lives. WebKit is the engine that
  // matters here, and this file runs in it.
  await open(page, {}, "drag.html");
  const before = await camOf(page);
  const c = await centreOf(page, "api");
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 30, c.y + 10, { steps: 4 });
  await page.mouse.move(c.x + 140, c.y - 60, { steps: 6 });
  await page.mouse.up();
  await atRest(page);
  const after = await camOf(page);
  expect(after.x - before.x).toBeCloseTo(140, 0); // the grabbed point stays under the pointer
  expect(after.y - before.y).toBeCloseTo(-60, 0);
  await expect(page.locator("#sq-tabs .on")).toHaveText("landscape");
  await expect(page.locator("#sq-stage")).toHaveAttribute("data-cam", "idle");
});

test("a sloppy click is still a click", async ({ page }) => {
  await open(page, {}, "sloppy.html");
  const c = await centreOf(page, "api");
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 2, c.y + 1); // under the 4px threshold
  await page.mouse.up();
  await expect(page.locator("#sq-tabs .on")).toHaveText("api");
});

test("ctrl+wheel zooms about the cursor; a plain wheel over a diagram that fits does nothing", async ({ page }) => {
  await open(page, {}, "wheel.html");
  const fit = await camOf(page);
  const at = await centreOf(page, "web");

  await wheel(page, at, 240, 3, false);
  expect(await camOf(page)).toEqual(fit); // nothing hidden to scroll to

  // away from the clamp, the content under the cursor must not move
  const under = (p: { x: number; y: number }) => page.evaluate((p) => {
    const l = document.querySelector("#sq-live")!.getBoundingClientRect();
    return { fx: (p.x - l.left) / l.width, fy: (p.y - l.top) / l.height };
  }, p);
  const f0 = await under(at);
  await wheel(page, at, -20, 4, true);
  const f1 = await under(at);
  const zoomed = await camOf(page);
  expect(zoomed.k).toBeGreaterThan(fit.k * 1.5);
  const l = (await page.locator("#sq-live").boundingBox())!;
  expect(Math.abs(f1.fx - f0.fx) * l.width).toBeLessThan(1);
  expect(Math.abs(f1.fy - f0.fy) * l.height).toBeLessThan(1);
  await expect(page.locator("#sq-fit")).toHaveText(`${Math.round(zoomed.k * 100)}%`);

  // Into the cap and past it. Every wheel event used to cancel the pending
  // paint before computing its move; once zoom hit the cap the next event had
  // nothing to change, scheduled nothing, and the screen stayed a frame behind
  // the camera until something else moved it.
  await wheel(page, at, -24, 12, true);
  expect((await camOf(page)).k).toBe(4);
  await expect(page.locator("#sq-fit")).toHaveText("400%");
});

test("keys zoom and pan, and leave the deck alone", async ({ page }) => {
  await open(page, {}, "keys.html");
  const fit = await camOf(page);
  await page.keyboard.press("+");
  await atRest(page);
  const one = await camOf(page);
  expect(one.k / fit.k).toBeCloseTo(1.25, 2);
  await page.keyboard.press("Shift+ArrowRight"); // used to step the deck: the switch reads e.key
  await atRest(page);
  expect((await camOf(page)).x - one.x).toBeCloseTo(-80, 0);
  await expect(page.locator("#sq-tabs .on")).toHaveText("landscape");
  await page.keyboard.press("0");
  await atRest(page);
  const back = await camOf(page);
  expect(back.k).toBeCloseTo(fit.k, 4);
  expect(back.x).toBeCloseTo(fit.x, 0);
  await page.keyboard.press("ArrowRight"); // and a plain arrow still steps
  await expect(page.locator("#sq-tabs .on")).toHaveText("web");
});

test("a focused button answers Enter — it used to step the deck instead", async ({ page }) => {
  // The window key handler swallowed Space and Enter, so every button in the
  // file was dead to the keyboard. Found while adding three more of them.
  await open(page, {}, "buttons.html");
  const fit = await camOf(page);
  await page.focus("#sq-zin");
  await page.keyboard.press("Enter");
  await atRest(page);
  expect((await camOf(page)).k).toBeGreaterThan(fit.k * 1.2);
  await expect(page.locator("#sq-tabs .on")).toHaveText("landscape");
  await page.locator("#sq-fit").click();
  await atRest(page);
  expect((await camOf(page)).k).toBeCloseTo(fit.k, 4);
});

test("a dive from a zoomed, panned view starts from what was on screen and arrives fitted", async ({ page }) => {
  await open(page, {}, "zoomdive.html");
  const at = await centreOf(page, "api");
  await wheel(page, { x: at.x + 60, y: at.y - 40 }, -20, 2, true); // ~1.5x, off-centre
  const first = await page.evaluate(() => {
    const live = document.querySelector("#sq-live")!, ghost = document.querySelector("#sq-ghost")!;
    const o = live.getBoundingClientRect();
    live.querySelector('[data-path="api"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    // same task as the click: the dive is set up and nothing has painted yet
    const g = ghost.getBoundingClientRect();
    return { old: [o.left, o.top, o.width, o.height], ghost: [g.left, g.top, g.width, g.height] };
  });
  first.old.forEach((v, i) => expect(Math.abs(v - first.ghost[i])).toBeLessThan(1));

  await settled(page);
  await expect(page.locator("#sq-tabs .on")).toHaveText("api");
  const arrived = await camOf(page);
  expect(arrived.k).toBeLessThanOrEqual(1);
  const inside = await page.evaluate(() => {
    const l = document.querySelector("#sq-live")!.getBoundingClientRect();
    const s = document.querySelector("#sq-stage")!.getBoundingClientRect();
    return l.left >= s.left && l.right <= s.right + 1 && l.top >= s.top;
  });
  expect(inside, "the new view is not framed").toBe(true);
});

test("a palette switch keeps the camera where the reader put it", async ({ page }) => {
  await open(page, {}, "theme.html");
  await wheel(page, await centreOf(page, "web"), -20, 3, true);
  const before = await camOf(page);
  await page.keyboard.press("t");
  await atRest(page);
  expect(await camOf(page)).toEqual(before);
});

test("a deep link opens fitted", async ({ page }) => {
  await open(page, {}, "deeplink.html");
  await page.goto(`${page.url()}#api`);
  await settled(page);
  await expect(page.locator("#sq-tabs .on")).toHaveText("api");
  expect((await camOf(page)).k).toBeLessThanOrEqual(1);
});

test("reduced motion still arrives fitted", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, {}, "reduced-fit.html");
  await wheel(page, await centreOf(page, "api"), -24, 6, true);
  expect((await camOf(page)).k).toBeGreaterThan(2);
  await card(page, "api").click({ force: true });
  await expect(page.locator("#sq-tabs .on")).toHaveText("api");
  expect((await camOf(page)).k).toBeLessThanOrEqual(1); // the early return refits too
});

test("without script there are no dead zoom buttons, and the layout is the static one", async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 400, height: 700 } });
  const page = await ctx.newPage();
  await open(page, {}, "nojs-zoom.html");
  await expect(page.locator("#sq-zin")).toBeHidden();
  await expect(page.locator("#sq-fit")).toBeHidden();
  // #sq-cam is display:contents until the runtime boots, so a narrow reader
  // still gets the width-fitted diagram they always had
  const w = await page.locator("#sq-live svg").evaluate((s) => s.getBoundingClientRect().width);
  expect(w).toBeLessThanOrEqual(400);
  await ctx.close();
});
