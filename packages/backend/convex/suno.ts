import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { action, ActionCtx, internalAction } from "./_generated/server";
import { callbacksEnabled, callbackUrl } from "./lib/callback";
import {
  createSunoPersona,
  createTask as createSunoTask,
  freshAttempt,
  getSunoCredits,
  getTaskStatus as getSunoTaskStatus,
  PersonaModel,
  personaOf,
  Provider,
  runWavConversion,
  Settings,
  SongDraft,
  SunoModel,
  Track,
} from "@suno/core";

// Klient Suno żyje w @suno/core (wspólny z desktopem) — tu globalny fetch Convex.
const createTask = (
  sunoKey: string,
  draft: SongDraft,
  model: SunoModel,
  instrumental: boolean,
  persona: { id: string; model: PersonaModel } | undefined,
  callBackUrl: string
) => createSunoTask(fetch, sunoKey, draft, model, instrumental, persona, callBackUrl);
const getTaskStatus = (sunoKey: string, taskId: string) =>
  getSunoTaskStatus(fetch, sunoKey, taskId);

export async function requireSettings(ctx: ActionCtx, userId: Id<"users">): Promise<Settings> {
  const settings = (await ctx.runQuery(internal.settings.getInternal, {
    userId,
  })) as Settings | null;
  if (!settings) throw new Error("Brak ustawień — uzupełnij klucze API");
  return settings;
}

// Z callbackami polling jest tylko siatką bezpieczeństwa — rzadziej. Liczone przy
// każdym wywołaniu (env Convex zmienia się bez redeployu); limit to zawsze ~10 min.
const POLL_DEADLINE_MS = 600_000;
const pollIntervalMs = () => (callbacksEnabled() ? 30_000 : 10_000);

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

    await ctx.runMutation(internal.limits.consumeInternal, { userId, kind: "music" });
    const d = draft as SongDraft;
    const id = crypto.randomUUID();
    const taskId = await createTask(
      settings.sunoKey,
      d,
      sunoModel as SunoModel,
      instrumental,
      persona ? { id: persona.id, model: persona.model } : undefined,
      await callbackUrl(userId, id)
    );
    const now = new Date().toISOString();
    const track: Track = {
      personaUsed: persona?.name,
      personaId: persona?.id,
      personaModel: persona?.model,
      album: albumTitle,
      albumIndex,
      id,
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
    await ctx.runMutation(internal.limits.consumeInternal, { userId, kind: "music" });

    const taskId = await createTask(
      settings.sunoKey,
      { title: track.title, style: track.style, lyrics: track.lyrics },
      track.sunoModel,
      track.instrumental,
      personaOf(track),
      await callbackUrl(userId, domainId)
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
    // limit dopiero po udanym zajęciu — drugi klik (odrzucony wyżej) nie jest liczony
    try {
      await ctx.runMutation(internal.limits.consumeInternal, { userId, kind: "music" });
    } catch (e) {
      await ctx.runMutation(internal.tracks.replaceInternal, { userId, domainId, track: previous });
      throw e;
    }

    let taskId: string;
    try {
      taskId = await createTask(
        settings.sunoKey,
        { title: previous.title, style: previous.style, lyrics: previous.lyrics },
        previous.sunoModel,
        previous.instrumental,
        personaOf(previous),
        await callbackUrl(userId, domainId)
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

type SyncResult = "done" | "pending" | "skip";

/** Czyta status taska w Suno i zapisuje go na utworze. Przejście w SUCCESS (i plan
 *  archiwizacji) rozstrzyga mutacja — dokładnie raz, nawet gdy callback i polling
 *  trafią w ten sam moment. */
async function syncStatus(
  ctx: ActionCtx,
  userId: Id<"users">,
  domainId: string
): Promise<SyncResult> {
  const settings = (await ctx.runQuery(internal.settings.getInternal, {
    userId,
  })) as Settings | null;
  const track = (await ctx.runQuery(internal.tracks.getInternal, {
    userId,
    domainId,
  })) as Track | null;
  if (!track || !settings?.sunoKey) return "skip"; // utwór usunięty albo brak klucza
  if (track.status === "SUCCESS" || track.status === "FAILED") return "done";
  const update = await getTaskStatus(settings.sunoKey, track.taskId);
  const status = await ctx.runMutation(internal.tracks.applyTaskUpdateInternal, {
    userId,
    domainId,
    taskId: track.taskId,
    update,
  });
  return status === "SUCCESS" || status === "FAILED" ? "done" : "pending";
}

/** Jeden krok durable pollingu: synchronizacja statusu i ewentualne przeplanowanie. */
export const poll = internalAction({
  args: { userId: v.id("users"), domainId: v.string(), attempt: v.number() },
  handler: async (ctx, { userId, domainId, attempt }) => {
    if (attempt * pollIntervalMs() >= POLL_DEADLINE_MS) {
      await ctx.runMutation(internal.tracks.failIfPendingInternal, {
        userId,
        domainId,
        error: "Przekroczono czas oczekiwania (10 min)",
      });
      return;
    }
    try {
      if ((await syncStatus(ctx, userId, domainId)) !== "pending") return;
    } catch {
      // ponytail: chwilowy błąd sieci nie przerywa pollingu — próbujemy dalej
    }
    await ctx.scheduler.runAfter(pollIntervalMs(), internal.suno.poll, {
      userId,
      domainId,
      attempt: attempt + 1,
    });
  },
});

/** Wywoływane z /suno-callback: natychmiastowa synchronizacja bez przeplanowania
 *  (łańcuch pollingu dalej czuwa jako zabezpieczenie). */
export const refreshFromCallback = internalAction({
  args: { userId: v.id("users"), domainId: v.string() },
  handler: async (ctx, { userId, domainId }) => {
    try {
      await syncStatus(ctx, userId, domainId);
    } catch {
      // polling ponowi
    }
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
    await ctx.runMutation(internal.limits.consumeInternal, { userId, kind: "wav" });

    const url = await runWavConversion(fetch, settings.sunoKey, track.taskId, audioId);
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

    const personaId = await createSunoPersona(fetch, settings.sunoKey, {
      taskId: track.taskId,
      audioId,
      name,
      description,
    });
    await ctx.runMutation(internal.personas.addInternal, {
      userId,
      persona: {
        id: personaId,
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
    return getSunoCredits(fetch, key);
  },
});
