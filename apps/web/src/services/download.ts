import JSZip from "jszip";

// URL „site" Convex (httpActions) — tam żyje proxy /download. Convex ustawia go w
// .env.local jako VITE_CONVEX_SITE_URL; fallback: wyprowadź z API URL (.convex.cloud).
const SITE_URL =
  (import.meta.env.VITE_CONVEX_SITE_URL as string | undefined) ??
  (import.meta.env.VITE_CONVEX_URL as string).replace(".convex.cloud", ".convex.site");

export { imageExt, sanitizeFileName } from "@suno/core";

function proxied(url: string): string {
  return `${SITE_URL}/download?url=${encodeURIComponent(url)}`;
}

// Proxy wymaga zalogowania — Studio wstrzykuje tu aktualny token JWT.
let authToken: string | null = null;
export function setDownloadAuthToken(token: string | null): void {
  authToken = token;
}

// Licznik długich operacji (pobierania/ZIP) — auto-aktualizacja PWA czeka,
// aż aplikacja będzie bezczynna, żeby reload nie przerywał pobierania.
let busyCount = 0;
const idleWaiters: (() => void)[] = [];
export function beginBusy(): void {
  busyCount++;
}
export function endBusy(): void {
  busyCount = Math.max(0, busyCount - 1);
  if (busyCount === 0) idleWaiters.splice(0).forEach((resolve) => resolve());
}
export function whenIdle(): Promise<void> {
  return busyCount === 0 ? Promise.resolve() : new Promise((r) => idleWaiters.push(r));
}

/** Pobiera plik z CDN Suno. Najpierw bezpośrednio (CDN-y Suno wystawiają
 *  CORS `*`, a proxy Convex ma limit 20 MB odpowiedzi — urywał duże WAV-y);
 *  proxy Convex zostaje fallbackiem dla hostów bez CORS. */
export async function fetchBlob(url: string): Promise<Blob> {
  try {
    const direct = await fetch(url);
    if (direct.ok) return direct.blob();
  } catch {
    // brak CORS na hoście albo błąd sieci — próbujemy przez proxy
  }
  const res = await fetch(proxied(url), {
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
  });
  if (res.status === 401) {
    throw new Error("Sesja wygasła — odśwież stronę (F5) i spróbuj ponownie");
  }
  if (!res.ok) throw new Error(`Pobieranie nie powiodło się (HTTP ${res.status})`);
  return res.blob();
}

function triggerDownload(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

/** Pobiera pojedynczy plik pod wskazaną nazwą (przeglądarkowy download). */
export async function downloadFile(url: string, filename: string): Promise<void> {
  triggerDownload(await fetchBlob(url), filename);
}

/** Zapisuje tekst jako plik .txt (np. teksty piosenek). */
export function downloadText(text: string, filename: string): void {
  triggerDownload(new Blob([text], { type: "text/plain;charset=utf-8" }), filename);
}

/** Buduje ZIP z listy plików i pobiera go jako jeden plik. Zwraca liczbę zapisanych. */
export async function downloadZip(
  files: { url: string; name: string }[],
  zipName: string,
  onProgress?: (done: number, total: number) => void
): Promise<{ saved: number; errors: string[] }> {
  beginBusy();
  try {
    return await downloadZipInner(files, zipName, onProgress);
  } finally {
    endBusy();
  }
}

async function downloadZipInner(
  files: { url: string; name: string }[],
  zipName: string,
  onProgress?: (done: number, total: number) => void
): Promise<{ saved: number; errors: string[] }> {
  const zip = new JSZip();
  const errors: string[] = [];
  let saved = 0;
  for (let i = 0; i < files.length; i++) {
    onProgress?.(i, files.length);
    try {
      const blob = await fetchBlob(files[i].url);
      zip.file(files[i].name, blob);
      saved++;
    } catch (e) {
      errors.push(`${files[i].name}: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (saved > 0) {
    // STORE: audio (mp3/wav) jest nieściśliwe — DEFLATE na ~500 MB WAV-ów
    // potrafiło wieszać kartę na minuty
    const out = await zip.generateAsync({ type: "blob", compression: "STORE" });
    triggerDownload(out, zipName);
  }
  return { saved, errors };
}
