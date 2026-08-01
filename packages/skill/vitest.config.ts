import { defineConfig } from "vitest/config";
// Reuse core's pack registration: these tests resolve icon ids against the
// real installed packs, exactly as `squinch check` does.
export default defineConfig({
  test: { setupFiles: ["../core/test/setup.ts"] },
});
