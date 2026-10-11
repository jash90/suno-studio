import { AlbumConcept, Settings, SongDraft, SunoModel } from "./types";
import {
  ALBUM_PROMPT_TEMPLATE,
  SONG_PROMPT_TEMPLATE,
  fillAlbumPrompt,
  fillSongPrompt,
} from "./prompts";

// Czysta część integracji z LLM: prompty systemowe, schematy structured outputs
// i parsowanie odpowiedzi. Same wywołania HTTP żyją w backendzie (Convex action).

/** Prompt systemowy piosenki: szablon (własny lub wbudowany) + brief i poradniki. */
export function songSystemPrompt(
  settings: Settings,
  model: SunoModel,
  brief: string,
  guides: string
): string {
  // Własny prompt użytkownika (Ustawienia) zastępuje wbudowany szablon;
  // brief i poradniki doklejamy zawsze tak samo.
  const template = settings.songSystemPrompt?.trim() || SONG_PROMPT_TEMPLATE;
  return `${fillSongPrompt(template, model)}
${brief ? `\nWytyczne użytkownika (brief): ${brief}` : ""}${
    guides
      ? `\n\nPoradniki użytkownika dot. pisania pod Suno — zastosuj opisane w nich
techniki tagowania, szablony stylu i strukturę (to INSTRUKCJE, nie treść piosenki).
Jeśli poradnik podaje konkretne wzory tagów lub szablon pola style, użyj ich:\n\n${guides}`
      : ""
  }`;
}

/** Prompt systemowy planu albumu: szablon (własny lub wbudowany) + poradniki. */
export function albumSystemPrompt(settings: Settings, songCount: number, guides: string): string {
  const template = settings.albumSystemPrompt?.trim() || ALBUM_PROMPT_TEMPLATE;
  return `${fillAlbumPrompt(template, songCount)}${
    guides ? `\n\nPoradniki użytkownika dot. Suno (INSTRUKCJE, nie treść):\n\n${guides}` : ""
  }`;
}

/** Wiadomość użytkownika dla generacji piosenki: fragmenty z biblioteki albo sam brief. */
export function songUserMessage(context: string): string {
  return context
    ? `Fragmenty materiałów źródłowych dobrane z biblioteki użytkownika:\n\n${context}`
    : "Brak materiałów źródłowych — napisz piosenkę wyłącznie na podstawie briefu.";
}

// Wymuszony kształt odpowiedzi — structured outputs po obu stronach
export const SONG_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Tytuł piosenki" },
    style: { type: "string", description: "Opis stylu Suno po angielsku" },
    lyrics: { type: "string", description: "Tekst piosenki z tagami Suno" },
  },
  required: ["title", "style", "lyrics"],
  additionalProperties: false,
} as const;

export const ALBUM_SCHEMA = {
  type: "object",
  properties: {
    albumTitle: { type: "string", description: "Tytuł albumu" },
    styleDirection: {
      type: "string",
      description: "Wspólny kierunek stylistyczny albumu po angielsku (wzorzec warstwowy Suno)",
    },
    songs: {
      type: "array",
      description: "Plany kolejnych piosenek albumu",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "Roboczy tytuł piosenki" },
          brief: {
            type: "string",
            description: "Brief tematyczny: o czym jest piosenka, kluczowe obrazy (2-4 zdania)",
          },
          styleHints: {
            type: "string",
            description:
              "Wskazówki stylu odróżniające ten utwór w ramach kierunku albumu, po angielsku",
          },
        },
        required: ["title", "brief", "styleHints"],
        additionalProperties: false,
      },
    },
  },
  required: ["albumTitle", "styleDirection", "songs"],
  additionalProperties: false,
} as const;

/** Wycina pierwszy zbalansowany obiekt JSON od pozycji `start`. */
function balancedObjectFrom(raw: string, start: number): string | null {
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (escaped) escaped = false;
    else if (ch === "\\") escaped = inString;
    else if (ch === '"') inString = !inString;
    else if (!inString) {
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) return raw.slice(start, i + 1);
      }
    }
  }
  return null;
}

/** Pierwszy obiekt JSON zaczynający się od pola title/style/lyrics — odporne na tekst
 *  przed/po JSON i klamry w komentarzach modelu. */
export function extractJsonObject(raw: string): string | null {
  return balancedObjectFrom(raw, raw.search(/\{\s*"(title|style|lyrics)"/));
}

/** Jak extractJsonObject, ale dla dowolnego obiektu (pierwsza klamra). */
export function extractJsonObjectLoose(raw: string): string | null {
  return balancedObjectFrom(raw, raw.indexOf("{"));
}

export function parseDraft(raw: string): SongDraft {
  const json = extractJsonObject(raw) ?? raw;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(`AI nie zwróciło poprawnego JSON. Początek odpowiedzi: ${raw.slice(0, 200)}`);
  }
  // czasem model zagnieżdża wynik, np. {"song": {...}}
  const values = Object.values(parsed);
  if (!parsed.title && values.length === 1 && typeof values[0] === "object") {
    parsed = values[0] as Record<string, unknown>;
  }
  if (!parsed.title || !parsed.style || !parsed.lyrics) {
    throw new Error(
      `Odpowiedź AI nie zawiera pól title/style/lyrics. Początek odpowiedzi: ${raw.slice(0, 200)}`
    );
  }
  return {
    title: String(parsed.title),
    style: String(parsed.style),
    lyrics: String(parsed.lyrics),
  };
}

export function parseAlbumConcept(raw: string): AlbumConcept {
  let parsed: AlbumConcept;
  try {
    parsed = JSON.parse(extractJsonObjectLoose(raw) ?? raw);
  } catch {
    throw new Error(`AI nie zwróciło poprawnego JSON. Początek odpowiedzi: ${raw.slice(0, 200)}`);
  }
  if (!parsed.albumTitle || !Array.isArray(parsed.songs) || parsed.songs.length === 0) {
    throw new Error(`Odpowiedź AI nie zawiera planu albumu. Początek: ${raw.slice(0, 200)}`);
  }
  return parsed;
}

export function missingKeyMessage(provider: "openai" | "anthropic"): string {
  return `Brak klucza API dla ${provider === "openai" ? "OpenAI" : "Anthropic"} — uzupełnij w Ustawieniach`;
}
