import {
  ALBUM_SCHEMA,
  AlbumConcept,
  Provider,
  SONG_SCHEMA,
  Settings,
  SongDraft,
  SunoModel,
  albumSystemPrompt,
  missingKeyMessage,
  parseAlbumConcept,
  parseDraft,
  songSystemPrompt,
  songUserMessage,
} from "@suno/core";

// Wywołania idą przez Convex action (server-side, globalny fetch) — brak CORS,
// klucze nigdy nie trafiają do JS przeglądarki. Prompty i parsowanie: @suno/core.

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

function requireKey(provider: Provider, settings: Settings) {
  const key = provider === "openai" ? settings.openaiKey : settings.anthropicKey;
  if (!key) throw new Error(missingKeyMessage(provider));
}

export async function generateSong(
  provider: Provider,
  settings: Settings,
  context: string,
  guides: string,
  brief: string,
  sunoModel: SunoModel
): Promise<SongDraft> {
  requireKey(provider, settings);
  const system = songSystemPrompt(settings, sunoModel, brief, guides);
  const user = songUserMessage(context);
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
  requireKey(provider, settings);
  const system = albumSystemPrompt(settings, songCount, guides);
  const user = `Brief albumu: ${brief}`;
  const raw =
    provider === "openai"
      ? await generateWithOpenAI(settings, system, user, ALBUM_SCHEMA, "album")
      : await generateWithAnthropic(settings, system, user, ALBUM_SCHEMA);
  return parseAlbumConcept(raw);
}
