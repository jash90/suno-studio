import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { auth } from "./auth";

const http = httpRouter();

// Trasy logowania Convex Auth
auth.addHttpRoutes(http);

// Proxy pobierania: klient (inny origin niż CDN Suno) nie może fetchować plików
// audio/okładek z powodu CORS. httpAction pobiera plik server-side i streamuje go
// z nagłówkiem CORS, więc klient dostaje bloba do downloadu / spakowania w ZIP.
// Wymaga zalogowania (Bearer token) — bez tego byłby publicznym open-proxy (SSRF).
// ponytail: hosty CDN Suno bywają zmienne, więc zamiast allowlisty hostów jest
// auth + blokada adresów prywatnych; jeśli nadużywane — dodać allowlistę.
const PRIVATE_HOST =
  /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|169\.254\.|\[)/i;

// Odrzuca URL-e prowadzące poza publiczne domeny: adresy prywatne, IPv6 oraz
// wszelkie literały IP (także zakodowane dziesiętnie/hex/ósemkowo jak
// http://2130706433/). CDN-y używają nazw domenowych — host bez litery
// (poza schematem 0x...) to zawsze literał IP.
function urlBlocked(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return true;
  }
  if (!/^https?:$/.test(u.protocol)) return true;
  const host = u.hostname;
  if (PRIVATE_HOST.test(host)) return true;
  if (/^0x/i.test(host) || !/[a-z]/i.test(host)) return true;
  return false;
}

// CORS na KAŻDEJ odpowiedzi (także błędach) — bez tego przeglądarka zamienia
// 401/400/502 w nieczytelne "Failed to fetch".
const CORS = { "Access-Control-Allow-Origin": "*" };

const download = httpAction(async (ctx, request) => {
  if ((await ctx.auth.getUserIdentity()) === null) {
    return new Response("Unauthorized", { status: 401, headers: CORS });
  }
  let url = new URL(request.url).searchParams.get("url");
  if (!url || urlBlocked(url)) {
    return new Response("Bad url", { status: 400, headers: CORS });
  }
  // Przekierowania podążamy ręcznie, walidując każdy hop — inaczej publiczny
  // URL mógłby zrobić 302 na adres prywatny i obejść blokadę.
  let upstream = await fetch(url, { redirect: "manual" });
  for (let hop = 0; hop < 3 && upstream.status >= 300 && upstream.status < 400; hop++) {
    const location = upstream.headers.get("Location");
    if (!location) break;
    url = new URL(location, url).toString();
    if (urlBlocked(url)) {
      return new Response("Bad url", { status: 400, headers: CORS });
    }
    upstream = await fetch(url, { redirect: "manual" });
  }
  if (!upstream.ok || !upstream.body) {
    return new Response(`Upstream ${upstream.status}`, { status: 502, headers: CORS });
  }
  const headers = new Headers();
  headers.set(
    "Content-Type",
    upstream.headers.get("Content-Type") ?? "application/octet-stream"
  );
  const len = upstream.headers.get("Content-Length");
  if (len) headers.set("Content-Length", len);
  headers.set("Access-Control-Allow-Origin", "*");
  return new Response(upstream.body, { status: 200, headers });
});

http.route({ path: "/download", method: "GET", handler: download });
http.route({
  path: "/download",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }),
});

export default http;
