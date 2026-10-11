import JSZip from "jszip";
import { registerSW } from "virtual:pwa-register";
import { whenIdle, withBusy } from "./busy";
import type { BundleFile, BundleResult, Platform } from "./types";

// URL „site" Convex (httpActions) — tam żyje proxy /download. Convex ustawia go w
// .env.local jako VITE_CONVEX_SITE_URL; fallback: wyprowadź z API URL (.convex.cloud).
const SITE_URL =
  (import.meta.env.VITE_CONVEX_SITE_URL as string | undefined) ??
  (import.meta.env.VITE_CONVEX_URL as string).replace(".convex.cloud", ".convex.site");

function proxied(url: string): string {
  return `${SITE_URL}/download?url=${encodeURIComponent(url)}`;
}

// Proxy wymaga zalogowania — Studio wstrzykuje tu aktualny token JWT.
let authToken: string | null = null;

/** Pobiera plik z CDN Suno. Najpierw bezpośrednio (CDN-y Suno wystawiają
 *  CORS `*`, a proxy Convex ma limit 20 MB odpowiedzi — urywał duże WAV-y);
 *  proxy Convex zostaje fallbackiem dla hostów bez CORS. */
async function fetchBlob(url: string): Promise<Blob> {
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

function toBlob(data: Blob | string): Blob {
  return typeof data === "string" ? new Blob([data], { type: "text/plain;charset=utf-8" }) : data;
}

async function resolveBlob(source: { url?: string; data?: Blob | string }): Promise<Blob> {
  if (source.data !== undefined) return toBlob(source.data);
  if (!source.url) throw new Error("brak pliku");
  return fetchBlob(source.url);
}

/** Buduje ZIP z listy plików i pobiera go jako jeden plik. */
async function saveZip(
  files: BundleFile[],
  zipName: string,
  onProgress?: (done: number, total: number) => void
): Promise<BundleResult> {
  const zip = new JSZip();
  const errors: string[] = [];
  let saved = 0;
  for (let i = 0; i < files.length; i++) {
    onProgress?.(i, files.length);
    try {
      zip.file(files[i].name, await resolveBlob(files[i]));
      saved++;
    } catch (e) {
      errors.push(`${files[i].name}: ${e instanceof Error ? e.message : e}`);
    }
  }
  onProgress?.(files.length, files.length);
  if (saved === 0) return { saved, errors, location: null };
  // STORE: audio (mp3/wav) jest nieściśliwe — DEFLATE na ~500 MB WAV-ów
  // potrafiło wieszać kartę na minuty
  const out = await zip.generateAsync({ type: "blob", compression: "STORE" });
  triggerDownload(out, zipName);
  return { saved, errors, location: zipName };
}

const webPlatform: Platform = {
  kind: "web",

  init() {
    // Aktualizacja PWA: nowa wersja czeka, aż aplikacja będzie bezczynna (żaden
    // ZIP/pobieranie nie trwa), i dopiero wtedy podmienia SW + przeładowuje kartę.
    // Bez tego otwarte karty zostawały na starym bundle'u albo reload przerywał
    // pobieranie w połowie.
    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        void whenIdle().then(() => updateSW(true));
      },
    });
  },

  setAuthToken(token) {
    authToken = token;
  },

  fetchBlob,

  // CDN Suno i Convex storage mają CORS — wavesurfer pobiera plik sam
  async loadAudio(url) {
    return { src: url, release: () => {} };
  },

  async saveFile(source, fileName) {
    triggerDownload(await resolveBlob(source), fileName);
    return fileName;
  },

  saveBundle(files, bundleName, onProgress) {
    return withBusy(() => saveZip(files, `${bundleName}.zip`, onProgress));
  },

  async confirm(message) {
    return window.confirm(message);
  },
};

export default webPlatform;
