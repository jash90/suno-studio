import { Track } from "../types";
import type { FetchFn } from "./suno";

// Okładki AI przez OpenAI Images API (gpt-image-1.5) — obok okładek Suno.
// Prompt w pełni automatyczny, po angielsku (lepsze wyniki), bez tekstu na obrazie.

/** Prompt okładki utworu z metadanych; instrumental → sam tytuł i styl. */
export function coverPrompt(track: Pick<Track, "title" | "style" | "lyrics" | "instrumental">) {
  const fragment = track.instrumental
    ? undefined
    : track.lyrics
        ?.replace(/\[[^\]]*\]/g, " ") // tagi Suno: [Verse], [Chorus]...
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 300);
  return (
    `Album cover artwork for a song titled "${track.title}". ` +
    `Musical style and genre: ${track.style}. ` +
    (fragment ? `Mood, themes and imagery inspired by these lyrics: ${fragment}. ` : "") +
    `Square professional album cover, striking composition, no text, no words, no letters, no typography.`
  );
}

/** Generuje obraz w OpenAI (gpt-image zwraca zawsze b64_json) i zwraca Blob PNG. */
export async function generateCoverImage(
  fetch: FetchFn,
  openaiKey: string,
  prompt: string
): Promise<Blob> {
  if (!openaiKey) throw new Error("Brak klucza OpenAI — uzupełnij w Ustawieniach");
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
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
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: "image/png" });
}
