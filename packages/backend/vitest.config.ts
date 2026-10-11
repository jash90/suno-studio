import { defineConfig } from "vitest/config";

// Testy funkcji Convex (convex-test) w środowisku zbliżonym do runtime'u Convex.
export default defineConfig({
  test: {
    environment: "edge-runtime",
    include: ["tests/**/*.test.ts"],
    server: { deps: { inline: ["convex-test"] } },
  },
});
