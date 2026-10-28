import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  workers: 1,
  reporter: [
    ["list"],
    ["json", { outputFile: "docs/evidence/qa-browser.json" }],
  ],
  use: {
    baseURL: process.env.TEST_BASE_URL ?? "http://127.0.0.1:3100",
    headless: true,
    launchOptions: {
      ...(process.env.CHROMIUM_PATH === "bundled"
        ? {}
        : { executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium" }),
      args: ["--no-sandbox"],
    },
    trace: "off",
    screenshot: "off",
  },
});
