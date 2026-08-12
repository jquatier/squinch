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
  await page.locator("#sq-stage").click({ position: { x: 5, y: 5 } });
  await page.waitForTimeout(600);
  await expect(page.locator('#sq-live [data-path="web"]')).toHaveCount(1);
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
