import {
  Album,
  AlbumSong,
  AlbumSongStatus,
  DEFAULT_SETTINGS,
  Provider,
  Settings,
  SUNO_LIMITS,
  SunoModel,
} from "./types";

// Normalizacja danych, których kształtu nie kontroluje w pełni nasz kod (formularz
// sklejany z zapisanych ustawień, plan albumu z LLM, import ze starej aplikacji).
// Zamiast odrzucać całość (sztywny walidator Convex), zostawiamy znane pola o
// poprawnym typie i uzupełniamy resztę domyślnymi.

type Loose = Record<string, unknown>;

const isObject = (v: unknown): v is Loose => typeof v === "object" && v !== null;
const str = (v: unknown, fallback: string) => (typeof v === "string" ? v : fallback);
const PROVIDERS: Provider[] = ["openai", "anthropic"];
const SONG_STATUSES: AlbumSongStatus[] = ["planned", "writing", "written", "error", "sent"];

export function isSunoModel(v: unknown): v is SunoModel {
  return typeof v === "string" && v in SUNO_LIMITS;
}

export function sanitizeSettings(input: unknown): Settings {
  const s = isObject(input) ? input : {};
  const d = DEFAULT_SETTINGS;
  return {
    openaiKey: str(s.openaiKey, d.openaiKey).trim(),
    anthropicKey: str(s.anthropicKey, d.anthropicKey).trim(),
    sunoKey: str(s.sunoKey, d.sunoKey).trim(),
    provider: PROVIDERS.includes(s.provider as Provider) ? (s.provider as Provider) : d.provider,
    openaiModel: str(s.openaiModel, d.openaiModel) || d.openaiModel,
    anthropicModel: str(s.anthropicModel, d.anthropicModel) || d.anthropicModel,
    sunoModel: isSunoModel(s.sunoModel) ? s.sunoModel : d.sunoModel,
    showBalances: typeof s.showBalances === "boolean" ? s.showBalances : d.showBalances,
    anthropicAdminKey: str(s.anthropicAdminKey, d.anthropicAdminKey).trim(),
    openaiAdminKey: str(s.openaiAdminKey, d.openaiAdminKey).trim(),
    songSystemPrompt: str(s.songSystemPrompt, d.songSystemPrompt),
    albumSystemPrompt: str(s.albumSystemPrompt, d.albumSystemPrompt),
  };
}

function sanitizeSong(input: unknown): AlbumSong | null {
  if (!isObject(input) || !isObject(input.plan)) return null;
  const plan = input.plan;
  const song: AlbumSong = {
    plan: {
      title: str(plan.title, ""),
      brief: str(plan.brief, ""),
      styleHints: str(plan.styleHints, ""),
    },
    status: SONG_STATUSES.includes(input.status as AlbumSongStatus)
      ? (input.status as AlbumSongStatus)
      : "planned",
  };
  const draft = input.draft;
  if (isObject(draft)) {
    song.draft = {
      title: str(draft.title, ""),
      style: str(draft.style, ""),
      lyrics: str(draft.lyrics, ""),
    };
  }
  if (typeof input.error === "string") song.error = input.error;
  if (typeof input.trackId === "string") song.trackId = input.trackId;
  return song;
}

/** Album z planu LLM / importu — null, gdy nie da się z niego zrobić albumu. */
export function sanitizeAlbum(input: unknown): Album | null {
  if (!isObject(input) || !Array.isArray(input.songs)) return null;
  const songs = input.songs.map(sanitizeSong).filter((s): s is AlbumSong => s !== null);
  return {
    id: str(input.id, "") || crypto.randomUUID(),
    title: str(input.title, "Album"),
    styleDirection: str(input.styleDirection, ""),
    brief: str(input.brief, ""),
    songs,
    createdAt: str(input.createdAt, "") || new Date().toISOString(),
  };
}
