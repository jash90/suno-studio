import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { action, ActionCtx, internalAction } from "./_generated/server";
import {
  PersonaModel,
  Provider,
  Settings,
  SongDraft,
  SunoModel,
  Track,
  TrackStatus,
  TrackVariant,
} from "@suno/core";

const BASE = "https://api.sunoapi.org/api/v1";

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

async function sunoFetch<T>(path: string, sunoKey: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
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

async function createTask(
  sunoKey: string,
  draft: SongDraft,
  model: SunoModel,
  instrumental: boolean,
  persona?: { id: string; model: PersonaModel }
): Promise<string> {
  const data = await sunoFetch<{ taskId: string }>("/generate", sunoKey, {
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
      // Bez publicznego callbacku — status sprawdzamy pollingiem (scheduler),
      // ale callBackUrl to wymagane pole, więc podajemy zaślepkę.
      callBackUrl: "https://example.com/suno-callback",
    }),
  });
  return data.taskId;
}

interface TaskUpdate {
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

async function getTaskStatus(sunoKey: string, taskId: string): Promise<TaskUpdate> {
  const data = await sunoFetch<RecordInfo>(
    `/generate/record-info?taskId=${encodeURIComponent(taskId)}`,
    sunoKey
  );
  const sunoData = data.response?.sunoData ?? [];
  const variants: TrackVariant[] = sunoData
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

export async function requireSettings(ctx: ActionCtx, userId: Id<"users">): Promise<Settings> {
  const settings = (await ctx.runQuery(internal.settings.getInternal, {
    userId,
  })) as Settings | null;
  if (!settings) throw new Error("Brak ustawień — uzupełnij klucze API");
  return settings;
}

const POLL_INTERVAL_MS = 10_000;
const MAX_ATTEMPTS = 60; // 60 × 10 s = 10 min

/** Zleca generację w Suno, zapisuje wiersz utworu i uruchamia durable polling. */
export const startGeneration = action({
  args: {
    draft: v.any(),
    sunoModel: v.string(),
    provider: v.string(),
    instrumental: v.boolean(),
    persona: v.optional(v.any()), // { id, model, name }
    albumTitle: v.optional(v.string()),
    albumIndex: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { draft, sunoModel, provider, instrumental, persona, albumTitle, albumIndex }
  ): Promise<string> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Niezalogowany");
    const settings = await requireSettings(ctx, userId);
    if (!settings.sunoKey) throw new Error("Brak klucza sunoapi.org — uzupełnij w Ustawieniach");

    const d = draft as SongDraft;
    const taskId = await createTask(
      settings.sunoKey,
      d,
      sunoModel as SunoModel,
      instrumental,
      persona ? { id: persona.id, model: persona.model } : undefined
    );
    const now = new Date().toISOString();
    const track: Track = {
      personaUsed: persona?.name,
      personaId: persona?.id,
      personaModel: persona?.model,
      album: albumTitle,
      albumIndex,
      id: crypto.randomUUID(),
      taskId,
      title: d.title,
      style: d.style,
      lyrics: d.lyrics,
      sunoModel: sunoModel as SunoModel,
      provider: provider as Provider,
      instrumental,
      status: "PENDING",
      createdAt: now,
      generatedAt: now,
    };
    await ctx.runMutation(internal.tracks.insertInternal, { userId, track });
    await ctx.scheduler.runAfter(0, internal.suno.poll, {
      userId,
      domainId: track.id,
      attempt: 0,
    });
    return track.id;
  },
});

/** Nowa próba generacji w tym samym wierszu biblioteki: czysty obiekt — bez
 *  error/variants/mediów poprzedniego taska — ale z metadanymi utworu (album,
 *  persona, okładka AI, data dodania), żeby nic z biblioteki nie przepadło. */
function freshAttempt(track: Track, taskId: string): Track {
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

function personaOf(track: Track) {
  return track.personaId && track.personaModel
    ? { id: track.personaId, model: track.personaModel }
    : undefined;
}

/** Ponawia nieudaną generację: nowy task Suno z tym samym draftem, w tym samym
 *  wierszu biblioteki. Personę wysyłamy tylko, gdy utwór ma zapisane jej id
 *  (starsze utwory mają samą nazwę). */
export const retryGeneration = action({
  args: { domainId: v.string() },
  handler: async (ctx, { domainId }): Promise<void> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Niezalogowany");
    const settings = await requireSettings(ctx, userId);
    if (!settings.sunoKey) throw new Error("Brak klucza sunoapi.org — uzupełnij w Ustawieniach");
    const track = (await ctx.runQuery(internal.tracks.getInternal, {
      userId,
      domainId,
    })) as Track | null;
    if (!track) throw new Error("Nie znaleziono utworu");
    if (track.status !== "FAILED") throw new Error("Ponowić można tylko nieudaną generację");

    const taskId = await createTask(
      settings.sunoKey,
      { title: track.title, style: track.style, lyrics: track.lyrics },
      track.sunoModel,
      track.instrumental,
      personaOf(track)
    );
    await ctx.runMutation(internal.tracks.replaceInternal, {
      userId,
      domainId,
      track: freshAttempt(track, taskId),
    });
    await ctx.scheduler.runAfter(0, internal.suno.poll, {
      userId,
      domainId,
      attempt: 0,
    });
  },
});

/** Przegenerowuje utwór, którego audio wygasło w Suno, zanim trafiło do archiwum.
 *  Oryginału nie da się odzyskać — Suno tworzy NOWE nagranie z tym samym tekstem,
 *  stylem i modelem, w tym samym wierszu biblioteki. */
export const regenerateExpired = action({
  args: { domainId: v.string() },
  handler: async (ctx, { domainId }): Promise<void> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Niezalogowany");
    const settings = await requireSettings(ctx, userId);
    if (!settings.sunoKey) throw new Error("Brak klucza sunoapi.org — uzupełnij w Ustawieniach");

    // atomowo: sprawdza, że wszystkie warianty przepadły, i ustawia PENDING
    const previous = (await ctx.runMutation(internal.tracks.claimRegenerationInternal, {
      userId,
      domainId,
    })) as Track;

    let taskId: string;
    try {
      taskId = await createTask(
        settings.sunoKey,
        { title: previous.title, style: previous.style, lyrics: previous.lyrics },
        previous.sunoModel,
        previous.instrumental,
        personaOf(previous)
      );
    } catch (e) {
      // Suno nie przyjęło zadania (np. brak kredytów) — przywracamy utwór bez zmian
      await ctx.runMutation(internal.tracks.replaceInternal, { userId, domainId, track: previous });
      throw e;
    }

    const next = freshAttempt(previous, taskId);
    next.previousTaskIds = [...(previous.previousTaskIds ?? []), previous.taskId];
    await ctx.runMutation(internal.tracks.replaceInternal, { userId, domainId, track: next });
    // poll po SUCCESS sam planuje archiwizację nowych plików
    await ctx.scheduler.runAfter(0, internal.suno.poll, {
      userId,
      domainId,
      attempt: 0,
    });
  },
});

/** Jeden krok durable pollingu: odczyt statusu, patch utworu, ewentualne przeplanowanie. */
export const poll = internalAction({
  args: { userId: v.id("users"), domainId: v.string(), attempt: v.number() },
  handler: async (ctx, { userId, domainId, attempt }) => {
    const settings = (await ctx.runQuery(internal.settings.getInternal, {
      userId,
    })) as Settings | null;
    const track = (await ctx.runQuery(internal.tracks.getInternal, {
      userId,
      domainId,
    })) as Track | null;
    if (!track || !settings?.sunoKey) return; // utwór usunięty albo brak klucza
    if (track.status === "SUCCESS" || track.status === "FAILED") return;

    if (attempt >= MAX_ATTEMPTS) {
      await ctx.runMutation(internal.tracks.patchInternal, {
        userId,
        domainId,
        patch: { status: "FAILED", error: "Przekroczono czas oczekiwania (10 min)" },
      });
      return;
    }

    try {
      const update = await getTaskStatus(settings.sunoKey, track.taskId);
      await ctx.runMutation(internal.tracks.patchInternal, {
        userId,
        domainId,
        patch: update,
      });
      if (update.status === "SUCCESS") {
        // Suno kasuje pliki po 14 dniach — od razu kopiujemy je do Convex storage
        await ctx.scheduler.runAfter(0, internal.archive.archiveTrack, {
          userId,
          domainId,
          attempt: 0,
        });
        return;
      }
      if (update.status === "FAILED") return;
    } catch {
      // ponytail: chwilowy błąd sieci nie przerywa pollingu — próbujemy dalej
    }
    await ctx.scheduler.runAfter(POLL_INTERVAL_MS, internal.suno.poll, {
      userId,
      domainId,
      attempt: attempt + 1,
    });
  },
});

/** Konwertuje wariant utworu do WAV (jednorazowo), zapisuje wavUrl i go zwraca. */
export const convertToWav = action({
  args: { domainId: v.string(), audioId: v.string() },
  handler: async (ctx, { domainId, audioId }): Promise<string> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Niezalogowany");
    const settings = await requireSettings(ctx, userId);
    const track = (await ctx.runQuery(internal.tracks.getInternal, {
      userId,
      domainId,
    })) as Track | null;
    if (!track) throw new Error("Nie znaleziono utworu");

    const existing = track.variants?.find((v) => v.audioId === audioId)?.wavUrl;
    if (existing) return existing;

    const url = await runWavConversion(settings.sunoKey, track.taskId, audioId);
    // patch jednego wariantu — równolegle archiwizacja MP3 może zmieniać variants
    await ctx.runMutation(internal.tracks.patchVariantInternal, {
      userId,
      domainId,
      audioId,
      fields: { wavUrl: url },
    });
    // klient pobiera od razu link Suno; kopia do storage leci w tle
    await ctx.scheduler.runAfter(0, internal.archive.archiveWav, {
      userId,
      domainId,
      audioId,
      attempt: 0,
    });
    return url;
  },
});

async function runWavConversion(sunoKey: string, taskId: string, audioId: string): Promise<string> {
  const res = await fetch(`${BASE}/wav/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sunoKey}`,
    },
    body: JSON.stringify({
      taskId,
      audioId,
      callBackUrl: "https://example.com/suno-callback",
    }),
  });
  const body: SunoEnvelope<{ taskId?: string }> = await res.json();
  let createdTaskId: string;
  if (body.code === 200 && body.data?.taskId) {
    createdTaskId = body.data.taskId;
  } else if (body.code === 409 && body.data?.taskId) {
    // konwersja już istnieje — 409 zwraca taskId istniejącego rekordu WAV
    createdTaskId = body.data.taskId;
  } else {
    throw new Error(`Suno API (${body.code}): ${body.msg ?? "nieznany błąd"}`);
  }
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    await sleep(5_000);
    let info: {
      successFlag?: string;
      errorMessage?: string | null;
      response?: { audioWavUrl?: string };
    };
    try {
      info = await sunoFetch(
        `/wav/record-info?taskId=${encodeURIComponent(createdTaskId)}`,
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Tworzy personę Suno z ukończonego utworu i zapisuje ją w rejestrze usera. */
export const createPersona = action({
  args: { domainId: v.string(), audioId: v.string(), name: v.string(), description: v.string() },
  handler: async (ctx, { domainId, audioId, name, description }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Niezalogowany");
    const settings = await requireSettings(ctx, userId);
    const track = (await ctx.runQuery(internal.tracks.getInternal, {
      userId,
      domainId,
    })) as Track | null;
    if (!track) throw new Error("Nie znaleziono utworu");

    const data = await sunoFetch<{ personaId: string }>(
      "/generate/generate-persona",
      settings.sunoKey,
      {
        method: "POST",
        body: JSON.stringify({ taskId: track.taskId, audioId, name, description }),
      }
    );
    await ctx.runMutation(internal.personas.addInternal, {
      userId,
      persona: {
        id: data.personaId,
        name,
        description,
        sourceTrackTitle: track.title,
        createdAt: new Date().toISOString(),
      },
    });
  },
});

/** Pozostałe kredyty Suno (przycisk „Sprawdź kredyty" w Ustawieniach). */
export const getCredits = action({
  args: { sunoKey: v.optional(v.string()) },
  handler: async (ctx, { sunoKey }): Promise<number> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Niezalogowany");
    const key = sunoKey || (await requireSettings(ctx, userId)).sunoKey;
    if (!key) throw new Error("Brak klucza sunoapi.org");
    return sunoFetch<number>("/generate/credit", key);
  },
});
