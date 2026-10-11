export type Provider = "openai" | "anthropic";

export type SunoModel = "V4" | "V4_5" | "V4_5PLUS" | "V4_5ALL" | "V5" | "V5_5";

export interface SunoLimits {
  lyrics: number;
  style: number;
  title: number;
}

export const SUNO_LIMITS: Record<SunoModel, SunoLimits> = {
  V4: { lyrics: 3000, style: 200, title: 80 },
  V4_5: { lyrics: 5000, style: 1000, title: 100 },
  V4_5PLUS: { lyrics: 5000, style: 1000, title: 100 },
  V4_5ALL: { lyrics: 5000, style: 1000, title: 80 },
  V5: { lyrics: 5000, style: 1000, title: 100 },
  V5_5: { lyrics: 5000, style: 1000, title: 100 },
};

export interface SourceFile {
  name: string;
  path: string;
  text: string;
}

/**
 * Rola dokumentu w bibliotece:
 * - "content" — materiał źródłowy, z którego powstaje TREŚĆ piosenki
 * - "guide" — poradnik/wytyczne (np. jak pisać tagi Suno) doklejane do promptu
 *   systemowego jako instrukcje, nigdy jako treść utworu
 */
export type DocKind = "content" | "guide";

export function guessDocKind(name: string): DocKind {
  return /prompt|guide|poradnik|suno|tag|trend|pisanie|struktur|how.?to/i.test(name)
    ? "guide"
    : "content";
}

/** Dokument w trwałej bibliotece plików — tekst pocięty na fragmenty pod retrieval. */
export interface LibraryDoc {
  id: string;
  name: string;
  path: string;
  chunks: string[];
  kind: DocKind;
  addedAt: string;
}

export interface RetrievedChunk {
  docName: string;
  text: string;
  score: number;
}

export interface SongDraft {
  title: string;
  style: string;
  lyrics: string;
}

export interface Settings {
  openaiKey: string;
  anthropicKey: string;
  sunoKey: string;
  provider: Provider;
  openaiModel: string;
  anthropicModel: string;
  sunoModel: SunoModel;
  showBalances: boolean;
  // Opcjonalne klucze administracyjne — tylko do odczytu wydatków miesiąca;
  // zwykłe klucze API nie mają dostępu do rozliczeń u żadnego z providerów
  anthropicAdminKey: string;
  openaiAdminKey: string;
  // Własne prompty systemowe (puste = wbudowany szablon z src/prompts.ts);
  // brief i poradniki z biblioteki są doklejane automatycznie poza szablonem
  songSystemPrompt: string;
  albumSystemPrompt: string;
}

// Zweryfikowane listy modeli czatowych (stan: 2026-07); wartości spoza listy
// dalej działają — select ma opcję zachowania bieżącej wartości
export const ANTHROPIC_MODELS = [
  "claude-fable-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-sonnet-5",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
] as const;

export const OPENAI_MODELS = [
  "gpt-5.5",
  "gpt-5.5-pro",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.2",
  "gpt-5.1",
  "gpt-4.1",
  "gpt-4o",
] as const;

export const DEFAULT_SETTINGS: Settings = {
  openaiKey: "",
  anthropicKey: "",
  sunoKey: "",
  provider: "anthropic",
  openaiModel: "gpt-5.5",
  anthropicModel: "claude-opus-4-8",
  sunoModel: "V5",
  showBalances: true,
  anthropicAdminKey: "",
  openaiAdminKey: "",
  songSystemPrompt: "",
  albumSystemPrompt: "",
};

export interface Balances {
  suno?: number | null; // pozostałe kredyty (null = błąd pobierania)
  anthropic?: number | null; // wydatki USD w bieżącym miesiącu
  openai?: number | null; // wydatki USD w bieżącym miesiącu
}

export type PersonaModel = "voice_persona" | "style_persona";

/** Persona Suno utworzona z naszego utworu — API nie listuje person, rejestr jest lokalny. */
export interface Persona {
  id: string; // personaId z sunoapi.org
  name: string;
  description: string;
  sourceTrackTitle: string;
  createdAt: string;
}

// --- Tryb Album ---

export interface AlbumSongPlan {
  title: string;
  brief: string;
  styleHints: string;
}

export interface AlbumConcept {
  albumTitle: string;
  styleDirection: string;
  songs: AlbumSongPlan[];
}

export type AlbumSongStatus = "planned" | "writing" | "written" | "error" | "sent";

export interface AlbumSong {
  plan: AlbumSongPlan;
  status: AlbumSongStatus;
  draft?: SongDraft;
  error?: string;
  trackId?: string;
}

export interface Album {
  id: string;
  title: string;
  styleDirection: string;
  brief: string;
  songs: AlbumSong[];
  createdAt: string;
}

// --- Zakładka Odtwarzacz ---

export interface PlayQueueItem {
  trackId: string;
  label: string; // "N. Tytuł (A)"
  url: string;
}

export interface Playback {
  name: string; // nazwa albumu / "Kolejka" dla ręcznie budowanej
  queue: PlayQueueItem[];
  index: number;
  repeat: boolean; // po ostatnim utworze wróć do pierwszego
}

export type TrackStatus =
  | "PENDING"
  | "TEXT_SUCCESS"
  | "FIRST_SUCCESS"
  | "SUCCESS"
  | "FAILED";

/** Jeden z dwóch wariantów, które Suno generuje w ramach jednego zadania. */
export interface TrackVariant {
  audioId: string;
  audioUrl?: string;
  streamAudioUrl?: string;
  imageUrl?: string;
  duration?: number;
  wavUrl?: string;
  // Suno trzyma pliki 14 dni — po SUCCESS kopiujemy je do Convex storage i
  // podmieniamy audioUrl/wavUrl na trwały URL; source* = oryginalny link Suno.
  audioStorageId?: string;
  sourceAudioUrl?: string;
  wavStorageId?: string;
  sourceWavUrl?: string;
  audioExpired?: boolean; // plik wygasł w Suno, zanim zdążyliśmy go skopiować
}

export interface Track {
  id: string;
  taskId: string;
  variants?: TrackVariant[];
  title: string;
  style: string;
  lyrics: string;
  sunoModel: SunoModel;
  provider: Provider;
  instrumental: boolean;
  status: TrackStatus;
  error?: string;
  audioId?: string; // id utworu w Suno — potrzebne do utworzenia persony
  personaUsed?: string; // nazwa persony użytej przy generacji
  personaId?: string; // id i model persony — do przegenerowania z tą samą personą
  personaModel?: PersonaModel;
  album?: string; // nazwa albumu, jeśli utwór powstał w trybie Album
  albumIndex?: number; // numer utworu na płycie (kolejność z planu albumu)
  wavUrl?: string; // URL po jednorazowej konwersji do WAV
  aiImageUrl?: string; // okładka wygenerowana przez OpenAI (Convex storage)
  aiImageStorageId?: string; // Id pliku w Convex storage (do ew. sprzątania)
  coverSource?: "suno" | "ai"; // która okładka jest aktywna; undefined = suno
  audioUrl?: string;
  streamAudioUrl?: string;
  imageUrl?: string;
  duration?: number;
  createdAt: string;
  // start ostatniej generacji w Suno; createdAt zostaje przy przegenerowaniu,
  // żeby utwór nie przeskakiwał na górę biblioteki. Brak = createdAt.
  generatedAt?: string;
  previousTaskIds?: string[]; // taski Suno sprzed przegenerowań wygasłego audio
}

/** Warianty utworu; starsze wpisy historii mają tylko pola płaskie — sklejamy z nich wariant A. */
export function getVariants(track: Track): TrackVariant[] {
  if (track.variants && track.variants.length > 0) return track.variants;
  if (!track.audioId) return [];
  return [
    {
      audioId: track.audioId,
      audioUrl: track.audioUrl,
      streamAudioUrl: track.streamAudioUrl,
      imageUrl: track.imageUrl,
      duration: track.duration,
      wavUrl: track.wavUrl,
    },
  ];
}

/** Wariant bezpowrotnie stracony: wygasł w Suno i nie ma kopii MP3 ani WAV w storage. */
export function isAudioLost(variant: TrackVariant): boolean {
  return !!variant.audioExpired && !variant.audioStorageId && !variant.wavStorageId;
}

/** Przegenerować można tylko gotowy utwór, którego wszystkie warianty przepadły. */
export function canRegenerate(track: Track): boolean {
  const variants = getVariants(track);
  return track.status === "SUCCESS" && variants.length > 0 && variants.every(isAudioLost);
}
