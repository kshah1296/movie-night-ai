import { defineConfig, devices } from "@playwright/test";

// QA-E2E — minimal smoke harness. Assumes the app is already running on :3000 (and the
// backend on :8000). Run with `npm run test:e2e` (start ./start.sh first), or let the
// webServer block boot the frontend.
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
