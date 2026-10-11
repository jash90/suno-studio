import { PersonaModel, SongDraft, SunoModel, Track, TrackStatus, TrackVariant } from "../types";

// Klient sunoapi.org — wspólny dla backendu Convex (web) i lokalnego silnika desktopu.
// `fetch` wstrzykiwany: Convex podaje globalny, desktop plugin-http (bez CORS).

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export const SUNO_BASE = "https://api.sunoapi.org/api/v1";
/** callBackUrl jest wymagany przez API; bez publicznego callbacku status czytamy pollingiem. */
export const SUNO_CALLBACK_STUB = "https://example.com/suno-callback";

const ERROR_MESSAGES: Record<string, string> = {
  CREATE_TASK_FAILED: "Nie udało się utworzyć zadania w Suno",
  GENERATE_AUDIO_FAILED: "Generowanie audio nie powiodło się",
  CALLBACK_EXCEPTION: "Błąd po stronie Suno (callback)",
  SENSITIVE_WORD_ERROR: "Suno odrzuciło treść jako wrażliwą — zmień tekst lub styl",
};

interface SunoEnvelope<T> {
  code: number;
  msg: string;
  data: T;
}

export async function sunoFetch<T>(
  fetch: FetchFn,
  path: string,
  sunoKey: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(`${SUNO_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sunoKey}`,
      ...init?.headers,
    },
  });
  const body: SunoEnvelope<T> = await res.json();
  if (!res.ok || body.code !== 200) {
    throw new Error(`Suno API (${body.code ?? res.status}): ${body.msg ?? "nieznany błąd"}`);
  }
  return body.data;
}

export async function createTask(
  fetch: FetchFn,
  sunoKey: string,
  draft: SongDraft,
  model: SunoModel,
  instrumental: boolean,
  persona: { id: string; model: PersonaModel } | undefined,
  callBackUrl: string = SUNO_CALLBACK_STUB
): Promise<string> {
  const data = await sunoFetch<{ taskId: string }>(fetch, "/generate", sunoKey, {
    method: "POST",
    body: JSON.stringify({
      customMode: true,
      instrumental,
      model,
      prompt: instrumental ? undefined : draft.lyrics,
      style: draft.style,
      title: draft.title,
      personaId: persona?.id,
      personaModel: persona?.model,
      callBackUrl,
    }),
  });
  return data.taskId;
}

export interface TaskUpdate {
  status: TrackStatus;
  error?: string;
  variants?: TrackVariant[];
  audioId?: string;
  audioUrl?: string;
  streamAudioUrl?: string;
  imageUrl?: string;
  duration?: number;
}

interface RecordInfo {
  status: string;
  errorMessage?: string | null;
  response?: {
    sunoData?: Array<{
      id?: string;
      audioUrl?: string;
      streamAudioUrl?: string;
      imageUrl?: string;
      duration?: number;
    }>;
  };
}

export async function getTaskStatus(
  fetch: FetchFn,
  sunoKey: string,
  taskId: string
): Promise<TaskUpdate> {
  const data = await sunoFetch<RecordInfo>(
    fetch,
    `/generate/record-info?taskId=${encodeURIComponent(taskId)}`,
    sunoKey
  );
  const variants: TrackVariant[] = (data.response?.sunoData ?? [])
    .filter((s) => s.id)
    .map((s) => ({
      audioId: s.id!,
      audioUrl: s.audioUrl || undefined,
      streamAudioUrl: s.streamAudioUrl || undefined,
      imageUrl: s.imageUrl || undefined,
      duration: s.duration,
    }));
  const first = variants[0];
  const media = {
    variants: variants.length > 0 ? variants : undefined,
    audioId: first?.audioId,
    audioUrl: first?.audioUrl,
    streamAudioUrl: first?.streamAudioUrl,
    imageUrl: first?.imageUrl,
    duration: first?.duration,
  };
  switch (data.status) {
    case "PENDING":
    case "TEXT_SUCCESS":
    case "FIRST_SUCCESS":
    case "SUCCESS":
      return { status: data.status as TrackStatus, ...media };
    default:
      return {
        status: "FAILED",
        error: ERROR_MESSAGES[data.status] ?? data.errorMessage ?? `Błąd Suno: ${data.status}`,
      };
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Zleca konwersję wariantu do WAV i czeka (do 5 min) na URL pliku. */
export async function runWavConversion(
  fetch: FetchFn,
  sunoKey: string,
  taskId: string,
  audioId: string,
  pollMs = 5_000
): Promise<string> {
  const res = await fetch(`${SUNO_BASE}/wav/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${sunoKey}` },
    body: JSON.stringify({ taskId, audioId, callBackUrl: SUNO_CALLBACK_STUB }),
  });
  const body: SunoEnvelope<{ taskId?: string }> = await res.json();
  // 409 = konwersja już istnieje — zwraca taskId istniejącego rekordu WAV
  if (!((body.code === 200 || body.code === 409) && body.data?.taskId)) {
    throw new Error(`Suno API (${body.code}): ${body.msg ?? "nieznany błąd"}`);
  }
  const wavTaskId = body.data.taskId;
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    await sleep(pollMs);
    let info: {
      successFlag?: string;
      errorMessage?: string | null;
      response?: { audioWavUrl?: string };
    };
    try {
      info = await sunoFetch(
        fetch,
        `/wav/record-info?taskId=${encodeURIComponent(wavTaskId)}`,
        sunoKey
      );
    } catch {
      continue; // chwilowy błąd sieci — próbujemy dalej
    }
    if (info.successFlag === "SUCCESS" && info.response?.audioWavUrl) {
      return info.response.audioWavUrl;
    }
    if (info.successFlag && info.successFlag !== "PENDING") {
      throw new Error(info.errorMessage || `Konwersja WAV nie powiodła się (${info.successFlag})`);
    }
  }
  throw new Error("Przekroczono czas oczekiwania na konwersję WAV");
}

export async function createSunoPersona(
  fetch: FetchFn,
  sunoKey: string,
  params: { taskId: string; audioId: string; name: string; description: string }
): Promise<string> {
  const data = await sunoFetch<{ personaId: string }>(
    fetch,
    "/generate/generate-persona",
    sunoKey,
    { method: "POST", body: JSON.stringify(params) }
  );
  return data.personaId;
}

export function getSunoCredits(fetch: FetchFn, sunoKey: string): Promise<number> {
  return sunoFetch<number>(fetch, "/generate/credit", sunoKey);
}

/** Nowa próba generacji w tym samym wierszu biblioteki: czysty obiekt — bez
 *  error/variants/mediów poprzedniego taska — ale z metadanymi utworu (album,
 *  persona, okładka AI, data dodania), żeby nic z biblioteki nie przepadło. */
export function freshAttempt(track: Track, taskId: string): Track {
  return {
    id: track.id,
    taskId,
    title: track.title,
    style: track.style,
    lyrics: track.lyrics,
    sunoModel: track.sunoModel,
    provider: track.provider,
    instrumental: track.instrumental,
    album: track.album,
    albumIndex: track.albumIndex,
    personaUsed: track.personaUsed,
    personaId: track.personaId,
    personaModel: track.personaModel,
    aiImageUrl: track.aiImageUrl,
    aiImageStorageId: track.aiImageStorageId,
    coverSource: track.coverSource,
    previousTaskIds: track.previousTaskIds,
    status: "PENDING",
    createdAt: track.createdAt,
    generatedAt: new Date().toISOString(),
  };
}

export function personaOf(track: Track) {
  return track.personaId && track.personaModel
    ? { id: track.personaId, model: track.personaModel }
    : undefined;
}

// sunoapi.org: "Generated files are retained for 14 days" — po tym czasie
// tempfile CDN zwraca 404, a stream 403.
export const SUNO_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

export type ArchiveFetch = { blob: Blob } | { gone: true } | { retry: true };

/** Pobiera plik z CDN Suno do archiwum. 403/404 = „wygasł” tylko dla starych
 *  utworów — świeżo po SUCCESS CDN bywa jeszcze niespójny, wtedy ponawiamy. */
export async function fetchArchiveSource(
  fetch: FetchFn,
  url: string,
  track: Track
): Promise<ArchiveFetch> {
  try {
    const res = await fetch(url);
    if (res.ok) return { blob: await res.blob() };
    // generatedAt: przegenerowany utwór ma stare createdAt, ale świeże pliki
    const generatedAt = new Date(track.generatedAt ?? track.createdAt).getTime();
    const old = Date.now() - generatedAt > SUNO_RETENTION_MS - 24 * 60 * 60 * 1000;
    if (old && [403, 404, 410].includes(res.status)) return { gone: true };
  } catch {
    // chwilowy błąd sieci — ponowimy
  }
  return { retry: true };
}
