import js from "@eslint/js";
import nx from "@nx/eslint-plugin";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

// Granice warstw monorepo (tagi w package.json → "nx.tags"):
//   scope:shared   packages/core     — czysta logika; zależy tylko od siebie
//   scope:backend  packages/backend  — Convex; korzysta z core
//   scope:frontend apps/web, desktop — UI; korzysta z core i typów API backendu
const restrict = (patterns) => ["error", { patterns }];

export default tseslint.config(
  {
    ignores: [
      "**/dist",
      "**/dist-tauri",
      "**/node_modules",
      "**/_generated",
      "**/src-tauri",
      ".nx",
      "coverage",
      ".playwright-mcp",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,js,mjs}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { "@nx": nx, "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
      "@nx/enforce-module-boundaries": [
        "error",
        {
          allow: ["@platform"],
          depConstraints: [
            { sourceTag: "scope:shared", onlyDependOnLibsWithTags: ["scope:shared"] },
            { sourceTag: "scope:backend", onlyDependOnLibsWithTags: ["scope:shared"] },
            {
              sourceTag: "scope:frontend",
              onlyDependOnLibsWithTags: ["scope:shared", "scope:backend", "scope:frontend"],
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/core/src/**"],
    rules: {
      "no-restricted-imports": restrict([
        {
          group: ["react", "react-*", "convex", "convex/*", "@convex-dev/*", "@tauri-apps/*"],
          message: "@suno/core jest czysty — bez React, Convex i Tauri.",
        },
      ]),
    },
  },
  {
    files: ["apps/web/src/**"],
    ignores: ["apps/web/src/platform/tauri.ts", "apps/web/src/**/*.test.ts"],
    rules: {
      "no-restricted-imports": restrict([
        {
          group: ["@tauri-apps/*"],
          message: "API Tauri tylko w platform/tauri.ts — reszta UI używa `@platform`.",
        },
        {
          group: ["**/platform/web", "**/platform/tauri"],
          message: "Importuj `@platform` (implementację wybiera build), nie konkretny plik.",
        },
      ]),
    },
  },
  {
    files: ["apps/web/src/views/**"],
    rules: {
      "no-restricted-imports": restrict([
        {
          group: ["convex", "convex/*", "@convex-dev/*", "@suno/backend/*"],
          message: "Widoki dostają dane przez propsy — Convex podpinamy w App/hookach.",
        },
        { group: ["@tauri-apps/*"], message: "API Tauri tylko w platform/tauri.ts." },
      ]),
    },
  }
);
