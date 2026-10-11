import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { readFileSync } from "node:fs";

/** Zmienne z .env.tauri — build desktopu zawsze celuje w produkcyjny Convex. Czytamy
 *  plik wprost, bo Nx wstrzykuje .env.local do process.env, a to wygrywa z plikami
 *  trybu Vite (desktop zbudowany lokalnie łączyłby się z deploymentem dev). */
function desktopBuildDefines(): Record<string, string> {
  const file = readFileSync(new URL("../../.env.tauri", import.meta.url), "utf8");
  return Object.fromEntries(
    file
      .split("\n")
      .map((line) => line.match(/^(VITE_[A-Z_]+)=(.*)$/))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map(([, key, value]) => [`import.meta.env.${key}`, JSON.stringify(value.trim())])
  );
}

// Jeden frontend, dwa cele:
//  - web (domyślny tryb): PWA na Vercelu, dist/
//  - desktop (`--mode tauri`, dev: `tauri-dev`): bundle ładowany przez powłokę Tauri
//    z apps/desktop, bez service workera (SW w webview tylko przeszkadza), dist-tauri/
export default defineConfig(({ mode }) => {
  const desktop = mode.startsWith("tauri");

  const pwa: PluginOption = VitePWA({
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
  });

  return {
    plugins: [react(), desktop ? null : pwa],
    define: mode === "tauri" ? desktopBuildDefines() : {},
    // .env.local leży w korzeniu repo (tam działa też `convex dev`)
    envDir: "../..",
    resolve: {
      alias: {
        // Implementacja natywnych funkcji (zapis plików, HTTP) wybierana w buildzie —
        // kod Tauri nie trafia do bundla web i odwrotnie.
        "@platform": new URL(
          desktop ? "./src/platform/tauri.ts" : "./src/platform/web.ts",
          import.meta.url
        ).pathname,
      },
    },
    build: {
      outDir: desktop ? "dist-tauri" : "dist",
      // Tauri na macOS = WebKit (Safari 16+)
      target: desktop ? ["es2022", "safari16"] : undefined,
    },
    server: desktop
      ? { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } }
      : { port: 5173 },
    clearScreen: !desktop,
  };
});
