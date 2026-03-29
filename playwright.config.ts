import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/e2e",
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: "http://localhost:18123",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  globalSetup: "./test/e2e/global-setup.ts",
  outputDir: "test/results",
});
