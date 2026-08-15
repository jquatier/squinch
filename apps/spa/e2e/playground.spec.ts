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

  await expect(page.getByText(/error/).first()).toBeVisible();
  await expect(nodes(page)).toHaveCount(before);
});

test("the wordmark takes you back to the landing", async ({ page }) => {
  await page.goto("/playground/");
  await page.getByTitle("Squinch — back to the site").click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "squinch" })).toBeVisible();
});
