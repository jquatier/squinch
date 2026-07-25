import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { resolve } from "node:path";

// The playground is fully static: no server, no telemetry, sources never leave
// the browser (share links carry them in the URL fragment).
export default defineConfig({
  plugins: [react(), tailwind()],
  // AWS icons are served as static files and fetched on demand per diagram.
  publicDir: resolve(__dirname, "public"),
  server: { port: 5180, strictPort: true },
  build: { target: "es2022" },
});
