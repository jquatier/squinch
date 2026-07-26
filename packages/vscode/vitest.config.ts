import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { setupFiles: ["../core/test/setup.ts"] },
});
