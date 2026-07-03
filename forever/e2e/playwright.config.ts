import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:4177",
    trace: "on-first-retry"
  },
  webServer: {
    command: "python3 -m http.server 4177",
    cwd: "./apps/web",
    url: "http://127.0.0.1:4177",
    reuseExistingServer: true
  }
});

