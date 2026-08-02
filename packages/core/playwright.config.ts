// The one part of the interactive export that cannot be tested without a
// browser: `<use href="#…">` resolving across `<svg>` element boundaries.
//
// The whole file-size argument rests on hoisting shared defs into a single
// sprite and letting every view's body reference them document-wide, and
// neither happy-dom nor jsdom lays out or resolves SVG references — so under
// the unit tests a completely broken hoist and a working one look identical.
//
// WebKit is not optional here. Safari has the longest history of `<use>` and
// `clipPath` cross-reference quirks, and this artifact's whole point is being
// opened from `file://` on someone else's machine, which is disproportionately
// a Mac.
//
// Deliberately NOT part of `pnpm -r test`: it needs ~180 MB of browsers, so it
// is `npm run test:e2e` locally and its own CI job.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
