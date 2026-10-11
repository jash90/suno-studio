// Callback sunoapi.org → Convex. Suno woła callBackUrl przy kolejnych etapach
// generacji; my traktujemy to wyłącznie jako sygnał „sprawdź status teraz” —
// treści callbacku nie ufamy, status i tak czytamy z API Suno. URL niesie
// userId/domainId i podpis HMAC (sekret SUNO_CALLBACK_SECRET w env Convex), więc
// obcy nie wywoła odświeżania cudzych utworów. Bez sekretu: zaślepka + sam polling.

const STUB = "https://example.com/suno-callback";

function secret(): string | undefined {
  return process.env.SUNO_CALLBACK_SECRET || undefined;
}

export function callbacksEnabled(): boolean {
  return !!secret() && !!process.env.CONVEX_SITE_URL;
}

async function sign(payload: string, key: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(payload));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function callbackUrl(userId: string, domainId: string): Promise<string> {
  const key = secret();
  const site = process.env.CONVEX_SITE_URL;
  if (!key || !site) return STUB;
  const params = new URLSearchParams({
    u: userId,
    t: domainId,
    s: await sign(`${userId}:${domainId}`, key),
  });
  return `${site}/suno-callback?${params}`;
}

/** Zwraca {userId, domainId}, gdy podpis się zgadza; inaczej null. */
export async function verifyCallback(
  url: URL
): Promise<{ userId: string; domainId: string } | null> {
  const key = secret();
  const userId = url.searchParams.get("u");
  const domainId = url.searchParams.get("t");
  const signature = url.searchParams.get("s");
  if (!key || !userId || !domainId || !signature) return null;
  const expected = await sign(`${userId}:${domainId}`, key);
  // porównanie w stałym czasie
  if (expected.length !== signature.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++)
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0 ? { userId, domainId } : null;
}
