import { fetch } from "@tauri-apps/plugin-http";
import { AlbumConcept, Provider, Settings, SongDraft, SunoModel } from "../types";
import {
  ALBUM_PROMPT_TEMPLATE,
  SONG_PROMPT_TEMPLATE,
  fillAlbumPrompt,
  fillSongPrompt,
} from "../prompts";

// Uwaga: wywołania idą przez plugin-http Tauri (proces Rust), nie przez fetch
// webview — dzięki temu brak ograniczeń CORS i klucze nie wyciekają do stron www.

/** Prompt systemowy piosenki: szablon (własny lub wbudowany) + brief i poradniki. */
function systemPrompt(
  template: string,
  model: SunoModel,
  brief: string,
  guides: string
): string {
  return `${fillSongPrompt(template, model)}${
    brief ? `\n\nWytyczne użytkownika (brief): ${brief}` : ""
  }${
    guides
      ? `\n\nPoradniki użytkownika dot. pisania pod Suno — zastosuj opisane w nich
techniki tagowania, szablony stylu i strukturę (to INSTRUKCJE, nie treść piosenki).
Jeśli poradnik podaje konkretne wzory tagów lub szablon pola style, użyj ich:\n\n${guides}`
      : ""
  }`;
}

// Wymuszony kształt odpowiedzi — structured outputs po obu stronach
const SONG_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Tytuł piosenki" },
    style: { type: "string", description: "Opis stylu Suno po angielsku" },
    lyrics: { type: "string", description: "Tekst piosenki z tagami Suno" },
  },
  required: ["title", "style", "lyrics"],
  additionalProperties: false,
} as const;

const ALBUM_SCHEMA = {
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
            description: "Wskazówki stylu odróżniające ten utwór w ramach kierunku albumu, po angielsku",
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

/** Wycina pierwszy zbalansowany obiekt JSON zaczynający się od pola title/style/lyrics
 *  — odporne na tekst przed/po JSON i klamry w komentarzach modelu. */
function extractJsonObject(raw: string): string | null {
  const start = raw.search(/\{\s*"(title|style|lyrics)"/);
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (escaped) {
      escaped = false;
    } else if (ch === "\\") {
      escaped = inString;
    } else if (ch === '"') {
      inString = !inString;
    } else if (!inString) {
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) return raw.slice(start, i + 1);
      }
    }
  }
  return null;
}

function parseDraft(raw: string): SongDraft {
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

async function generateWithOpenAI(
  settings: Settings,
  system: string,
  user: string,
  schema: object = SONG_SCHEMA,
  schemaName = "song"
): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.openaiKey}`,
    },
    body: JSON.stringify({
      model: settings.openaiModel,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: schemaName, strict: true, schema },
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.choices[0].message.content;
}

async function generateWithAnthropic(
  settings: Settings,
  system: string,
  user: string,
  schema: object = SONG_SCHEMA
): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": settings.anthropicKey,
      "anthropic-version": "2023-06-01",
      // Webview wysyła nagłówek Origin, więc Anthropic wymaga jawnej zgody na
      // wywołanie "z przeglądarki" — klucz jest lokalny, aplikacja desktopowa.
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: settings.anthropicModel,
      max_tokens: 8192,
      system,
      output_config: { format: { type: "json_schema", schema } },
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  if (data.stop_reason === "refusal") {
    throw new Error("Model odmówił wygenerowania treści");
  }
  const text = data.content.find((b: { type: string }) => b.type === "text");
  if (!text) throw new Error("Anthropic nie zwróciło tekstu");
  return text.text;
}

export async function generateSong(
  provider: Provider,
  settings: Settings,
  context: string,
  guides: string,
  brief: string,
  sunoModel: SunoModel
): Promise<SongDraft> {
  const key = provider === "openai" ? settings.openaiKey : settings.anthropicKey;
  if (!key) {
    throw new Error(
      `Brak klucza API dla ${provider === "openai" ? "OpenAI" : "Anthropic"} — uzupełnij w Ustawieniach`
    );
  }
  const system = systemPrompt(
    settings.songSystemPrompt?.trim() || SONG_PROMPT_TEMPLATE,
    sunoModel,
    brief,
    guides
  );
  const user = context
    ? `Fragmenty materiałów źródłowych dobrane z biblioteki użytkownika:\n\n${context}`
    : "Brak materiałów źródłowych — napisz piosenkę wyłącznie na podstawie briefu.";

  const raw =
    provider === "openai"
      ? await generateWithOpenAI(settings, system, user)
      : await generateWithAnthropic(settings, system, user);
  return parseDraft(raw);
}

/** Planuje koncept-album: tytuł, wspólny kierunek stylu i briefy kolejnych piosenek. */
export async function generateAlbumConcept(
  provider: Provider,
  settings: Settings,
  brief: string,
  songCount: number,
  guides: string
): Promise<AlbumConcept> {
  const key = provider === "openai" ? settings.openaiKey : settings.anthropicKey;
  if (!key) {
    throw new Error(
      `Brak klucza API dla ${provider === "openai" ? "OpenAI" : "Anthropic"} — uzupełnij w Ustawieniach`
    );
  }
  const template = settings.albumSystemPrompt?.trim() || ALBUM_PROMPT_TEMPLATE;
  const system = `${fillAlbumPrompt(template, songCount)}${
    guides
      ? `\n\nPoradniki użytkownika dot. Suno (INSTRUKCJE, nie treść):\n\n${guides}`
      : ""
  }`;
  const user = `Brief albumu: ${brief}`;
  const raw =
    provider === "openai"
      ? await generateWithOpenAI(settings, system, user, ALBUM_SCHEMA, "album")
      : await generateWithAnthropic(settings, system, user, ALBUM_SCHEMA);
  const parsed: AlbumConcept = JSON.parse(extractJsonObjectLoose(raw) ?? raw);
  if (!parsed.albumTitle || !Array.isArray(parsed.songs) || parsed.songs.length === 0) {
    throw new Error(
      `Odpowiedź AI nie zawiera planu albumu. Początek: ${raw.slice(0, 200)}`
    );
  }
  return parsed;
}

/** Jak extractJsonObject, ale dla dowolnego obiektu (pierwsza klamra). */
function extractJsonObjectLoose(raw: string): string | null {
  const start = raw.indexOf("{");
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
