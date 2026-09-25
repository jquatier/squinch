// Does the playground load, and does it work.
//
// The pure logic it used to own — scope arithmetic, the dive geometry, the
// share codec — is unit tested, most of it in core now. What is left in
// `App.tsx`, `Stage.tsx` and `Presenter.tsx` is a thousand lines of React and
// DOM that `pnpm -r test` cannot reach, and whose only assertion until now was
// that it compiles.
//
// Kept small on purpose, and kept off the canvas: what a diagram looks like is
// the golden suite's job and the corpus gallery's job. These check the wiring
// between the editor, the compiler and the canvas.
import { test, expect, type Page } from "@playwright/test";

/** The compile is debounced 180ms and ELK takes a beat; wait for the thing
 *  itself rather than a magic number. */
const canvas = (page: Page) => page.locator("main svg, .canvas svg").first();
const nodes = (page: Page) => page.locator("[data-path]");

test("loads, compiles and draws — with a clean console", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto("/playground/");
  await expect(canvas(page)).toBeVisible();
  await expect(nodes(page).first()).toBeVisible();
  await expect(page.getByText("No problems")).toBeVisible();
  expect(errors, `console errors on load:\n${errors.join("\n")}`).toEqual([]);
});

test("an example loads and its views appear as tabs", async ({ page }) => {
  await page.goto("/playground/");
  await page.getByRole("combobox").selectOption("Examples/Microservices");

  // the view bar is built from the compiled model, so its presence is evidence
  // the whole pipeline ran, not just that a string got into the editor
  for (const v of ["landscape", "catalog", "orders", "accounts"])
    await expect(page.getByRole("button", { name: v, exact: true })).toBeVisible();
  await expect(nodes(page).first()).toBeVisible();
});

test("switching view redraws the canvas", async ({ page }) => {
  await page.goto("/playground/");
  await page.getByRole("combobox").selectOption("Examples/Microservices");
  await expect(page.locator('[data-path="orders"]')).toBeVisible();

  await page.getByRole("button", { name: "orders", exact: true }).click();
  // the orders view shows that system's internals, which the landscape does not
  await expect(page.locator('[data-path="orders.api"]')).toBeVisible();
  await expect(page.locator('[data-path="orders"]')).toHaveCount(0);
});

test("clicking a card zooms, and the breadcrumb offers the way back", async ({ page }) => {
  await page.goto("/playground/");
  await page.getByRole("combobox").selectOption("Examples/Microservices");
  // the card, not its label: the click handler binds to closest([data-path]),
  // and a <text> glyph is not reliably the hit-test winner over the canvas rect
  await page.locator('[data-path="orders"]').click();

  await expect(page.locator('[data-path="orders.api"]')).toBeVisible();
  const back = page.getByRole("button", { name: "landscape", exact: true });
  await expect(back.first()).toBeVisible();
  // and the ghost layer from the dive does not outlive it
  await expect(page.locator("[aria-hidden] svg")).toHaveCount(0, { timeout: 3000 });
});

test("a syntax error reports itself and keeps the last good drawing", async ({ page }) => {
  // the failure this guards is a blank canvas mid-keystroke: the compile fails
  // on half-typed input constantly, and the editor would be unusable if the
  // picture vanished every time
  await page.goto("/playground/");
  await expect(nodes(page).first()).toBeVisible();
  const before = await nodes(page).count();

  await page.locator(".cm-content").click();
  await page.keyboard.press("End");
  await page.keyboard.type("\n%%% not squinch %%%");

  // the diagnostics footer counts problems ("1 problem") rather than
  // labelling each line "error"
  await expect(page.getByText(/\d+ problem/).first()).toBeVisible();
  await expect(nodes(page)).toHaveCount(before);
});

test("the wordmark takes you back to the landing", async ({ page }) => {
  await page.goto("/playground/");
  await page.getByTitle("Squinch — back to the site").click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "squinch" })).toBeVisible();
});

// ── the camera (docs/notes/pan-zoom.md) ──────────────────────────────────────
//
// The gestures themselves are tested against the interactive export, in two
// engines — it is the same controller, bundled. What is checked here is the
// wiring that only the playground has: React must not fight the camera, the
// editor must keep its own keys, and an edit is not a reason to lose your place.
// Chromium only, so the React arm/fire path gets no WebKit run; say so if that
// ever matters.

const VP = "main section[data-cam]";
type Cam = { x: number; y: number; k: number };
const camOf = (page: Page) =>
  page.evaluate((vp): Cam => {
    const t = (document.querySelector(vp)!.firstElementChild as HTMLElement).style.transform;
    const m = /translate\(([-\d.e]+)px, ([-\d.e]+)px\) scale\(([-\d.e]+)\)/.exec(t)!;
    return { x: +m[1], y: +m[2], k: +m[3] };
  }, VP);
/** The camera has stopped moving: its transform is unchanged for three frames.
 *  Never a fixed sleep — a tween's duration is not a promise on a loaded runner. */
const atRest = (page: Page) =>
  page.evaluate((vp) => new Promise<void>((done) => {
    const el = document.querySelector(vp)!.firstElementChild as HTMLElement;
    let last = "", still = 0;
    const tick = () => {
      const t = el.style.transform;
      still = t === last ? still + 1 : 0;
      last = t;
      if (still >= 3) done(); else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), VP);
const readout = (page: Page) => page.getByRole("button", { name: "Zoom to 100%" });
const microservices = async (page: Page) => {
  await page.goto("/playground/");
  await page.getByRole("combobox").selectOption("Examples/Microservices");
  await expect(page.locator('[data-path="orders"]')).toBeVisible();
  await page.waitForTimeout(400); // let the first fit land
};

test("a drag pans the canvas over a plain ground, and does not navigate", async ({ page }) => {
  await microservices(page);
  const before = await camOf(page);
  const b = (await page.locator('[data-path="orders"]').first().boundingBox())!;
  const c = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 30, c.y, { steps: 4 });
  await page.mouse.move(c.x + 110, c.y - 50, { steps: 6 });
  await page.mouse.up();
  await atRest(page);
  const after = await camOf(page);
  expect(after.x - before.x).toBeCloseTo(110, 0);
  expect(after.y - before.y).toBeCloseTo(-50, 0);
  await expect(page.locator('[data-path="orders.api"]')).toHaveCount(0); // still the landscape
  // the stage is the diagram's own canvas colour and nothing else — no grid
  // for the camera to carry along
  const bg = await page.locator(VP).evaluate((s) => getComputedStyle(s).backgroundImage);
  expect(bg).toBe("none");
});

test("the zoom pill drives the camera, and the readout tracks it", async ({ page }) => {
  await microservices(page);
  const fit = await camOf(page);
  await expect(readout(page)).toHaveText(`${Math.round(fit.k * 100)}%`);
  await page.getByRole("button", { name: "Zoom in" }).click();
  await atRest(page);
  const one = await camOf(page);
  expect(one.k / fit.k).toBeCloseTo(1.25, 2);
  await expect(readout(page)).toHaveText(`${Math.round(one.k * 100)}%`);
  await readout(page).click(); // the percentage is the "actual size" button
  await atRest(page);
  expect((await camOf(page)).k).toBeCloseTo(1, 3);
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  await atRest(page);
  expect((await camOf(page)).k).toBeCloseTo(fit.k, 3);
});

test("the editor keeps its own keys, and an edit keeps your place", async ({ page }) => {
  await microservices(page);
  await page.getByRole("button", { name: "Zoom in" }).click();
  await atRest(page);
  const placed = await camOf(page);
  const show = page.getByRole("button", { name: /Show editor/ });
  if (await show.count()) await show.click();
  await page.locator(".cm-content").click();
  await page.keyboard.type("// - + 0 1 = _\n");
  await page.waitForTimeout(700); // debounce + compile + render
  const after = await camOf(page);
  expect(after.k).toBeCloseTo(placed.k, 6); // `0` did not fit, `+` did not zoom
  // …and outside a text field the same key does work
  await page.locator(VP).evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("0");
  await atRest(page);
  expect((await camOf(page)).k).toBeLessThan(placed.k);
});

test("a dive from a zoomed view arrives fitted; loading another example refits", async ({ page }) => {
  await microservices(page);
  await page.getByRole("button", { name: "Zoom in" }).click();
  await atRest(page);
  await page.locator('[data-path="orders"]').first().click();
  await expect(page.locator('[data-path="orders.api"]')).toBeVisible();
  await expect(page.locator("[aria-hidden] svg")).toHaveCount(0, { timeout: 3000 });
  const inside = () => page.locator(VP).evaluate((s) => {
    const v = s.getBoundingClientRect(), l = s.firstElementChild!.children[1].getBoundingClientRect();
    return l.left >= v.left && l.right <= v.right + 1 && l.top >= v.top;
  });
  expect((await camOf(page)).k).toBeLessThanOrEqual(1);
  expect(await inside()).toBe(true);

  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await atRest(page);
  await page.getByRole("combobox").selectOption({ index: 3 });
  await page.waitForTimeout(1200);
  expect((await camOf(page)).k).toBeLessThanOrEqual(1);
  expect(await inside()).toBe(true);
});
