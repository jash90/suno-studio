// Narzędzia tekstowe i nazw plików — wspólne dla UI (web/desktop) i backendu.

// ponytail: łączny limit treści źródłowych, żeby nie rozsadzić kontekstu LLM
export const MAX_TOTAL_CHARS = 50_000;

export const SUPPORTED_EXTENSIONS = ["txt", "md", "pdf", "docx"];

export function fileExtension(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

export function sanitizeFileName(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, "_");
}

/** Rozszerzenie pliku obrazu z URL-a (fallback jpeg). */
export function imageExt(url: string): string {
  const match = url.split("?")[0].match(/\.(jpe?g|png|webp)$/i);
  return match ? match[1].toLowerCase() : "jpeg";
}

// ponytail: fragmenty ~1200 znaków cięte na granicach akapitów, bez overlapu —
// wystarcza do doboru kontekstu dla LLM; overlap dodać, gdyby fragmenty ucinały wątki
export const CHUNK_SIZE = 1200;

export function chunkText(text: string): string[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const p of paragraphs) {
    if (current && current.length + p.length + 2 > CHUNK_SIZE) {
      chunks.push(current);
      current = "";
    }
    // pojedynczy akapit dłuższy niż CHUNK_SIZE tnij twardo
    if (p.length > CHUNK_SIZE) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (let i = 0; i < p.length; i += CHUNK_SIZE) {
        chunks.push(p.slice(i, i + CHUNK_SIZE));
      }
    } else {
      current = current ? `${current}\n\n${p}` : p;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
