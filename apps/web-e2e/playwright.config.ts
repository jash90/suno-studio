import { defineConfig, devices } from "@playwright/test";

// E2E na prawdziwym backendzie Convex — lokalnym (anonimowym) deploymencie.
// Jednorazowo: `npm run setup:local` (deployment, klucze Convex Auth, .env.local).
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop-chrome", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  // Backend: lokalny Convex (dane i klucze auth w .convex/ po `npm run setup:local`),
  // frontend: Vite. Lokalnie podpinamy się pod już działające procesy.
  webServer: [
    {
      command: "npx convex dev",
      cwd: "../..",
      url: "http://127.0.0.1:3210/version",
      env: { CONVEX_AGENT_MODE: "anonymous" },
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      command: "npx nx dev web",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
