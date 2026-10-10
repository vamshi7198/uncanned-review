import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end acceptance test, run against a disposable Docker stack by
 * e2e/run-acceptance.sh. Uses the installed Microsoft Edge (channel "msedge")
 * because Playwright's bundled Chromium cannot decode H.264 video.
 * Set E2E_CHANNEL=chrome to use Google Chrome instead.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 180_000,
  expect: { timeout: 45_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:8091",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "edge",
      use: { ...devices["Desktop Edge"], channel: process.env.E2E_CHANNEL ?? "msedge", viewport: { width: 1440, height: 900 } },
    },
  ],
});
