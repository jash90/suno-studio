import { fetch } from "@tauri-apps/plugin-http";
import { convertFileSrc } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import { copyFile, mkdir, writeFile } from "@tauri-apps/plugin-fs";
import { Track } from "../types";

// Okładki AI przez OpenAI Images API (gpt-image-1.5) — obok okładek Suno.
// Prompt w pełni automatyczny, po angielsku (lepsze wyniki), bez tekstu na obrazie.
// Pliki lądują w danych aplikacji; track trzyma ścieżkę, nie same bajty.

/** Prompt okładki utworu z metadanych; instrumental → sam tytuł i styl. */
function coverPrompt(title: string, style: string, lyrics?: string): string {
  const fragment = lyrics
    ?.replace(/\[[^\]]*\]/g, " ") // tagi Suno: [Verse], [Chorus]...
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
  return (
    `Album cover artwork for a song titled "${title}". ` +
    `Musical style and genre: ${style}. ` +
    (fragment
      ? `Mood, themes and imagery inspired by these lyrics: ${fragment}. `
      : "") +
    `Square professional album cover, striking composition, no text, no words, no letters, no typography.`
  );
}

/** Prompt jednej wspólnej okładki albumu. */
function albumCoverPrompt(albumName: string, tracks: Track[]): string {
  const styles = [...new Set(tracks.map((t) => t.style))].join("; ").slice(0, 600);
  const titles = tracks.map((t) => t.title).join(", ").slice(0, 300);
  return (
    `Album cover artwork for a music album titled "${albumName}". ` +
    `Track titles: ${titles}. Musical styles across the album: ${styles}. ` +
    `One cohesive square professional album cover, striking composition, no text, no words, no letters, no typography.`
  );
}

/** Generuje obraz w OpenAI (gpt-image zwraca zawsze b64_json) i zwraca bajty PNG. */
async function generateImage(openaiKey: string, prompt: string): Promise<Uint8Array> {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-image-1.5",
      prompt,
      size: "1024x1024",
      quality: "medium", // ponytail: medium wystarcza na okładkę; "high" gdyby jakość zawiodła
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI Images (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { data?: { b64_json?: string }[] };
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI nie zwróciło obrazu");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** Zapisuje PNG w podkatalogu „covers" danych aplikacji i zwraca pełną ścieżkę. */
// ponytail: stare pliki nie są sprzątane przy regeneracji — nazwa zawiera znacznik
// czasu, żeby webview nie pokazywało poprzedniej okładki z cache'u.
async function storeImage(name: string, bytes: Uint8Array): Promise<string> {
  const dir = await join(await appDataDir(), "covers");
  await mkdir(dir, { recursive: true });
  const path = await join(dir, `${name}-${Date.now()}.png`);
  await writeFile(path, bytes);
  return path;
}

/** Generuje okładkę AI dla utworu; zwraca ścieżkę pliku PNG. */
export async function generateTrackCover(
  openaiKey: string,
  track: Track
): Promise<string> {
  if (!openaiKey) throw new Error("Brak klucza OpenAI — uzupełnij w Ustawieniach");
  const bytes = await generateImage(
    openaiKey,
    coverPrompt(track.title, track.style, track.instrumental ? undefined : track.lyrics)
  );
  return storeImage(track.id, bytes);
}

/** Generuje jedną wspólną okładkę AI dla albumu; zwraca ścieżkę pliku PNG. */
export async function generateAlbumCover(
  openaiKey: string,
  album: string,
  tracks: Track[]
): Promise<string> {
  if (!openaiKey) throw new Error("Brak klucza OpenAI — uzupełnij w Ustawieniach");
  if (tracks.length === 0) throw new Error("Album nie ma utworów");
  const bytes = await generateImage(openaiKey, albumCoverPrompt(album, tracks));
  return storeImage(tracks[0].id, bytes);
}

/** Adres pliku okładki dla <img> — asset:// zamiast ścieżki systemowej. */
export function coverSrc(path: string): string {
  return convertFileSrc(path);
}

/** Kopiuje zapisaną okładkę AI pod wskazaną ścieżkę docelową. */
export function saveCoverAs(path: string, target: string): Promise<void> {
  return copyFile(path, target);
}
