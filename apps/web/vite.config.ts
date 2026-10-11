import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // "prompt": nowy SW czeka na updateSW() z main.tsx (po bezczynności),
      // zamiast przejmować kontrolę i przeładowywać kartę w trakcie pobierania
      registerType: "prompt",
      injectRegister: false,
      manifest: {
        name: "Suno Studio",
        short_name: "Suno Studio",
        description: "Studio piosenek AI: teksty, generacja muzyki, albumy.",
        lang: "pl",
        display: "standalone",
        theme_color: "#141112",
        background_color: "#141112",
        icons: [
          { src: "pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "pwa-512-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // aplikacja jest żywa (websocket Convex) — cache tylko na statyki
        globPatterns: ["**/*.{js,css,html,png,svg}"],
        navigateFallbackDenylist: [/^\/api/],
      },
    }),
  ],
  // .env.local leży w korzeniu repo (tam działa też `convex dev`)
  envDir: "../..",
  server: {
    port: 5173,
  },
});
