import { defineConfig } from "vitest/config";

// Testy logiki frontendu (bez przeglądarki) — warstwa platformy, helpery widoków.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
