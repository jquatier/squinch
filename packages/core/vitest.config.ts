import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    setupFiles: ["./test/setup.ts"],
    // e2e/ is Playwright's, and its default glob would otherwise sweep the
    // spec in here and fail on the missing test runner
    exclude: ["node_modules/**", "dist/**", "e2e/**"],
  },
});
