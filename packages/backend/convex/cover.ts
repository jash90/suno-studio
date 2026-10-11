import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { action, ActionCtx, internalAction, internalMutation, mutation } from "./_generated/server";
import { coverPrompt, generateCoverImage, Track } from "@suno/core";
import { findTrackRow, releaseCoverFile, rowsOfUser } from "./lib/trackRows";
import { consume } from "./limits";
import { requireSettings } from "./suno";

// Okładki AI: prompt i wywołanie OpenAI w @suno/core (wspólne z desktopem).

/** Zapisuje obraz do Convex storage i zwraca { url, storageId }. */
async function storeImage(ctx: ActionCtx, blob: Blob): Promise<{ url: string; storageId: string }> {
  const storageId = await ctx.storage.store(blob);
  const url = await ctx.storage.getUrl(storageId);
  if (!url) throw new Error("Nie udało się zapisać okładki");
  return { url, storageId };
}

/** Okładka AI dla utworu: generacja, zapis w storage, podmiana na tracku.
 *  Poprzedni plik AI kasujemy dopiero po udanym zapisie nowego. */
async function coverForTrack(
  ctx: ActionCtx,
  userId: Id<"users">,
  openaiKey: string,
  track: Track,
  onlyIfPending = false
): Promise<string> {
  const blob = await generateCoverImage(fetch, openaiKey, coverPrompt(track));
  const { url, storageId } = await storeImage(ctx, blob);
  await ctx.runMutation(internal.cover.setTrackCoverInternal, {
    userId,
    domainId: track.id,
    aiImageUrl: url,
    aiImageStorageId: storageId,
    onlyIfPending,
  });
  return url;
}

/** Generuje okładkę AI dla utworu i zapisuje ją na tracku (coverSource: "ai"). */
export const generateTrackCover = action({
  args: { domainId: v.string() },
  handler: async (ctx, { domainId }): Promise<string> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Niezalogowany");
    const settings = await requireSettings(ctx, userId);
    if (!settings.openaiKey) throw new Error("Brak klucza OpenAI — uzupełnij w Ustawieniach");
    const track = (await ctx.runQuery(internal.tracks.getInternal, {
      userId,
      domainId,
    })) as Track | null;
    if (!track) throw new Error("Nie znaleziono utworu");
    await ctx.runMutation(internal.limits.consumeInternal, { userId, kind: "cover" });
    return coverForTrack(ctx, userId, settings.openaiKey, track);
  },
});

/** Dogenerowuje brakujące okładki AI albumu — osobną dla każdego utworu.
 *  Każda okładka to osobne zadanie schedulera (generacja trwa 20–60 s, cały album
 *  w jednej akcji przekraczałby limit czasu); postęp widać reaktywnie po polu
 *  coverStatus na trackach. Zwraca liczbę zleconych okładek. */
export const generateAlbumCovers = mutation({
  args: { album: v.string() },
  handler: async (ctx, { album }): Promise<number> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Niezalogowany");
    const rows = (await rowsOfUser(ctx, userId)).filter((r) => {
      const t = r.data as Track;
      return (
        t.album === album && t.status === "SUCCESS" && !t.aiImageUrl && t.coverStatus !== "pending"
      );
    });
    if (rows.length === 0) throw new Error("Wszystkie utwory albumu mają już okładkę AI");
    await consume(ctx, userId, "cover", rows.length);
    for (const row of rows) {
      await ctx.db.patch(row._id, {
        data: { ...(row.data as Track), coverStatus: "pending", coverError: undefined },
      });
      await ctx.scheduler.runAfter(0, internal.cover.generateQueuedCover, {
        userId,
        domainId: row.domainId,
      });
    }
    return rows.length;
  },
});

export const generateQueuedCover = internalAction({
  args: { userId: v.id("users"), domainId: v.string() },
  handler: async (ctx, { userId, domainId }) => {
    const track = (await ctx.runQuery(internal.tracks.getInternal, {
      userId,
      domainId,
    })) as Track | null;
    // reset okładek albumu zdążył zdjąć kolejkę — nie generujemy (i nie płacimy)
    if (!track || track.coverStatus !== "pending") return;
    try {
      const settings = await requireSettings(ctx, userId);
      if (!settings.openaiKey) throw new Error("Brak klucza OpenAI — uzupełnij w Ustawieniach");
      await coverForTrack(ctx, userId, settings.openaiKey, track, true);
    } catch (e) {
      await ctx.runMutation(internal.tracks.patchInternal, {
        userId,
        domainId,
        patch: { coverStatus: "error", coverError: e instanceof Error ? e.message : String(e) },
      });
    }
  },
});

export const setTrackCoverInternal = internalMutation({
  args: {
    userId: v.id("users"),
    domainId: v.string(),
    aiImageUrl: v.string(),
    aiImageStorageId: v.string(),
    /** Z kolejki albumu: reset w trakcie generacji ma pierwszeństwo — plik idzie do kosza. */
    onlyIfPending: v.optional(v.boolean()),
  },
  handler: async (ctx, { userId, domainId, aiImageUrl, aiImageStorageId, onlyIfPending }) => {
    const row = await findTrackRow(ctx, userId, domainId);
    const track = row?.data as Track | undefined;
    if (!row || !track || (onlyIfPending && track.coverStatus !== "pending")) {
      await ctx.storage.delete(aiImageStorageId as Id<"_storage">);
      return;
    }
    const { coverStatus: _s, coverError: _e, ...rest } = track;
    await ctx.db.patch(row._id, {
      data: { ...rest, aiImageUrl, aiImageStorageId, coverSource: "ai" },
    });
    if (track.aiImageStorageId && track.aiImageStorageId !== aiImageStorageId) {
      await releaseCoverFile(ctx, userId, track.aiImageStorageId, []);
    }
  },
});

/** Usuwa okładki AI wskazanych utworów (pliki ze storage + pola na trackach). */
export const reset = mutation({
  args: { domainIds: v.array(v.string()) },
  handler: async (ctx, { domainIds }): Promise<number> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Niezalogowany");
    const files = new Set<string>();
    let count = 0;
    for (const domainId of domainIds) {
      const row = await findTrackRow(ctx, userId, domainId);
      if (!row) continue;
      const track = row.data as Track;
      if (!track.aiImageUrl && !track.coverStatus) continue;
      if (track.aiImageStorageId) files.add(track.aiImageStorageId);
      const {
        aiImageUrl: _u,
        aiImageStorageId: _id,
        coverSource: _src,
        coverStatus: _s,
        coverError: _e,
        ...rest
      } = track;
      await ctx.db.patch(row._id, { data: rest });
      count++;
    }
    if (count === 0) throw new Error("Brak okładek AI do zresetowania");
    for (const storageId of files) await releaseCoverFile(ctx, userId, storageId, domainIds);
    return count;
  },
});

/** @deprecated Zgodność ze starym frontendem z cache PWA (wołał akcję z jedną wspólną
 *  okładką albumu). Kieruje do kolejki okładek per utwór. Usunąć, gdy stare karty
 *  się zaktualizują. */
export const generateAlbumCover = action({
  args: { album: v.string() },
  handler: async (ctx, { album }): Promise<string> => {
    await ctx.runMutation(api.cover.generateAlbumCovers, { album });
    return "";
  },
});
