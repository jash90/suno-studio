#!/usr/bin/env node
// Przygotowuje lokalny (anonimowy) backend Convex do developmentu bez konta i do E2E/CI:
//   1. `convex dev --once` na deploymencie lokalnym (CONVEX_AGENT_MODE=anonymous),
//   2. klucze Convex Auth (JWT_PRIVATE_KEY, JWKS) + SITE_URL na tym deploymencie,
//   3. VITE_CONVEX_URL / VITE_CONVEX_SITE_URL w .env.local dla frontendu.
// Uwaga: lokalny backend wymaga Node 20/22/24 (akcje "use node") — patrz .nvmrc.
// Nie dotyka współdzielonego deploymentu dev w chmurze.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { exportJWK, exportPKCS8, generateKeyPair } from "jose";

const env = { ...process.env, CONVEX_AGENT_MODE: "anonymous" };
const convex = (...args) =>
  execFileSync("npx", ["convex", ...args], {
    env,
    stdio: ["ignore", "pipe", "inherit"],
  }).toString();

if (existsSync(".env.local") && !/anonymous/.test(readFileSync(".env.local", "utf8"))) {
  console.error(
    ".env.local wskazuje deployment w chmurze — ten skrypt jest tylko dla lokalnego backendu.\n" +
      "Przenieś .env.local albo uruchom w czystym checkoucie."
  );
  process.exit(1);
}

console.log("→ convex dev --once (lokalny backend)");
execFileSync("npx", ["convex", "dev", "--once"], { env, stdio: "inherit" });

const current = convex("env", "list");
if (!current.includes("JWT_PRIVATE_KEY")) {
  console.log("→ klucze Convex Auth");
  const keys = await generateKeyPair("RS256", { extractable: true });
  const privateKey = (await exportPKCS8(keys.privateKey)).trimEnd().replace(/\n/g, " ");
  const jwks = JSON.stringify({ keys: [{ use: "sig", ...(await exportJWK(keys.publicKey)) }] });
  convex("env", "set", "--", "JWT_PRIVATE_KEY", privateKey);
  convex("env", "set", "--", "JWKS", jwks);
}
convex("env", "set", "SITE_URL", process.env.SITE_URL ?? "http://localhost:5173");

const dotenv = readFileSync(".env.local", "utf8");
if (!dotenv.includes("VITE_CONVEX_URL")) {
  const url = dotenv.match(/^CONVEX_URL=(.+)$/m)?.[1];
  const site = dotenv.match(/^CONVEX_SITE_URL=(.+)$/m)?.[1];
  appendFileSync(".env.local", `\nVITE_CONVEX_URL=${url}\nVITE_CONVEX_SITE_URL=${site}\n`);
}
console.log(
  "✔ Lokalny backend gotowy. Dev: `CONVEX_AGENT_MODE=anonymous npx convex dev` + `npm run dev:web`; E2E: `npm run e2e`"
);
