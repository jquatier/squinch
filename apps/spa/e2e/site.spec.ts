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
  // The category phrase is what the title exists to carry — it is the one
  // on-page signal that names what this is, and it went missing once.
  await expect(page).toHaveTitle(/architecture diagrams as code/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("architecture diagrams as code");
  // Scoped to the hero's own CTA row: the footer repeats a "GitHub" link
  // lower on the page, and an unscoped lookup would resolve to both.
  const heroLinks = page.locator(".hero-links");
  // Exact names on all four: the decorative "↗" and "→" are emitted with CSS
  // alt text (`content: "↗" / ""`), which keeps them out of the accessible
  // name. Matching exactly is what proves that still holds — drop the alt text
  // and this reads "GitHub ↗" and fails.
  for (const name of ["Open the playground", "Install", "Lookbook", "GitHub"])
    await expect(heroLinks.getByRole("link", { name, exact: true })).toBeVisible();
  // and GitHub leaves the site for the repo, not a page that no longer exists
  expect(
    await heroLinks.getByRole("link", { name: "GitHub", exact: true }).getAttribute("href"),
  ).toBe("https://github.com/jquatier/squinch");
  expect(errors).toEqual([]);
});

test("each content page serves, styled, with its own title", async ({ page }) => {
  // the h1s are two-line claims; a substring of the first line is enough to
  // tell them apart and survives a copy tweak to the second
  for (const [path, title, h1] of [
    ["/install/", "Install — squinch", "Four ways in."],
    ["/lookbook/", "Lookbook — squinch", "systems, drawn properly."],
    ["/compare/", "Compare — squinch", "How Squinch compares."],
  ] as const) {
    await page.goto(path);
    await expect(page).toHaveTitle(title);
    await expect(page.getByRole("heading", { level: 1, name: h1 })).toBeVisible();
    // the stylesheet resolved: the header renders as a flex row, not raw text
    await expect(page.locator(".site-header")).toHaveCSS("display", "flex");
  }
});

test("every command on the install page copies, without its comments", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/install/");
  // one button per block — a new <pre> gets one for free, so count them
  await expect(page.locator(".copy-btn")).toHaveCount(await page.locator("pre").count());
  const cli = page.locator("#cli .copy-btn");
  await cli.click();
  await expect(cli).toHaveAccessibleName("Copied");
  // the `# or npx …` aside stays on the page and off the clipboard
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "npm i -g squinch\n\nsquinch init my-diagrams\nsquinch render my-diagrams --sync",
  );
});

test("the landing's Playground link opens the working playground", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Open the playground", exact: true }).click();
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
  // "Minimal" (id "01-minimal") is the first case build.ts writes, so it's a
  // stable anchor — this is generated content, but generated FROM something
  // specific. The heading is the humanized title; the slug lives on the
  // section id and the Source: link instead.
  await expect(page.getByRole("heading", { level: 2, name: "Minimal", exact: true })).toBeVisible();
  const shots = page.locator(".shot img");
  await expect(shots.first()).toBeVisible();
  expect(await shots.count()).toBeGreaterThan(30); // 35 cases, most single-view
  // the image actually loaded — a broken /lookbook/*.svg path naturalWidth:0s
  expect(await shots.first().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test("the landing and content pages are always dark", async ({ page }) => {
  // Unlike the playground, these three don't follow the OS or carry a
  // toggle — emulating light proves the page isn't just defaulting to dark
  // by coincidence.
  await page.emulateMedia({ colorScheme: "light" });
  for (const path of ["/", "/install/", "/lookbook/", "/compare/"]) {
    await page.goto(path);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  }
});

test("the compare page shows every tool's render, and one switch flips all six", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto("/compare/");
  const shown = page.locator(".cmp-shot:visible img");
  await expect(shown).toHaveCount(6);
  // every picture loaded — ours from public/, theirs hashed by the build
  for (const img of await shown.all()) {
    await img.scrollIntoViewIfNeeded();
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  }
  // it opens on the landscape; the switch takes all six to full detail
  await expect(page.locator('.cmp-shot[data-view="landscape"]:visible')).toHaveCount(6);
  await page.getByRole("button", { name: "Full detail" }).click();
  await expect(page.locator('.cmp-shot[data-view="full"]:visible')).toHaveCount(6);
  await expect(page.locator('.cmp-shot[data-view="landscape"]:visible')).toHaveCount(0);
  expect(errors).toEqual([]);
});
