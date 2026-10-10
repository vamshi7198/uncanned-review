import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    // Forked workers time out starting on some Windows machines; threads are reliable.
    pool: "threads",
    testTimeout: 20_000,
    globals: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: { "@": resolve(import.meta.dirname, "./src") },
  },
});
