// Does the site's front door work — the landing, the two content pages, and
// the walk from the landing into the playground. Content lives in static
// HTML, so most of what could break is wiring: a moved route, a dead link, a
// stylesheet that stopped resolving. That's what these check.
import { test, expect } from "@playwright/test";

test("the landing renders the lockup and all four links", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "squinch" })).toBeVisible();
  // Exact names on all four: the decorative "↗" and "→" are emitted with CSS
  // alt text (`content: "↗" / ""`), which keeps them out of the accessible
  // name. Matching exactly is what proves that still holds — drop the alt text
  // and this reads "Docs ↗" and fails.
  for (const name of ["Install", "Docs", "Lookbook", "Playground"])
    await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  // and Docs leaves the site for the repo, not a page that no longer exists
  expect(await page.getByRole("link", { name: "Docs", exact: true }).getAttribute("href")).toBe(
    "https://github.com/jquatier/squinch",
  );
  expect(errors).toEqual([]);
});

test("each content page serves, styled, with its own title", async ({ page }) => {
  for (const [path, title, h1] of [
    ["/install/", "Install — Squinch", "Install"],
    ["/lookbook/", "Lookbook — Squinch", "Lookbook"],
  ] as const) {
    await page.goto(path);
    await expect(page).toHaveTitle(title);
    await expect(page.getByRole("heading", { level: 1, name: h1 })).toBeVisible();
    // the stylesheet resolved: the header renders as a flex row, not raw text
    await expect(page.locator(".site-header")).toHaveCSS("display", "flex");
  }
});

test("the landing's Playground link opens the working playground", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Playground", exact: true }).click();
  await expect(page).toHaveURL(/\/playground\/$/);
  // the app compiled and drew — icons fetched from the site root, per the
  // BASE_URL anchoring in src/squinch.ts
  await expect(page.locator("[data-path]").first()).toBeVisible();
  await expect(page.getByText("No problems")).toBeVisible();
});

test("the lookbook renders real cases with real images", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto("/lookbook/");
  // 01-minimal is the first case build.ts writes, so it's a stable anchor —
  // this is generated content, but generated FROM something specific
  await expect(page.getByRole("heading", { level: 2, name: "01-minimal" })).toBeVisible();
  const shots = page.locator(".shot img");
  await expect(shots.first()).toBeVisible();
  expect(await shots.count()).toBeGreaterThan(30); // 35 cases, most single-view
  // the image actually loaded — a broken /lookbook/*.svg path naturalWidth:0s
  expect(await shots.first().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test("the site follows the OS color scheme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});
