import { defineConfig } from "vitest/config";
// The playground's logic is extracted into src/lib/ precisely so it can be
// tested without a DOM — node environment, no jsdom, no component harness.
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
