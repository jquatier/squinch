// Smoke tests for the playground: does it load, and does it work.
//
// Deliberately not a second rendering suite — the corpus gallery and the golden
// SVGs own what diagrams look like, and a pixel baseline here would duplicate
// them while failing on every legitimate render change. What these cover is the
// wiring between the editor, the compiler and the canvas, which is React and
// DOM and therefore invisible to `pnpm -r test`.
//
// Reuses a dev server if one is already up (it usually is, on 5180) and boots
// its own in CI. Not part of `pnpm -r test`: browsers are a separate job.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: "http://localhost:5180" },
  // one engine here: this is wiring, not rendering, and the cross-engine risk
  // that justified webkit for the export (SVG fragment resolution) is not in play
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:5180",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
