import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { canRegenerate, getVariants, Track } from "@suno/core";
import { findTrackRow, releaseCoverFile } from "./lib/trackRows";
import { trackClientPatch } from "./validators";

const findRow = findTrackRow;

export const list = query({
  args: {},
  handler: async (ctx): Promise<Track[]> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const rows = await ctx.db
      .query("tracks")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    // najnowsze pierwsze — jak dawna historia
    return rows
      .map((r) => r.data as Track)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },
});

export const remove = mutation({
  args: { domainId: v.string() },
  handler: async (ctx, { domainId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Niezalogowany");
    const row = await findRow(ctx, userId, domainId);
    if (!row) return;
    const track = row.data as Track;
    for (const variant of track.variants ?? []) {
      for (const id of [variant.audioStorageId, variant.wavStorageId]) {
        if (id) await ctx.storage.delete(id as Id<"_storage">);
      }
    }
    await ctx.db.delete(row._id);
    // dawne wspólne okładki albumu: plik kasujemy dopiero, gdy nikt go nie używa
    if (track.aiImageStorageId) {
      await releaseCoverFile(ctx, userId, track.aiImageStorageId, [domainId]);
    }
  },
});

export const patch = mutation({
  args: { domainId: v.string(), patch: trackClientPatch },
  handler: async (ctx, { domainId, patch }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Niezalogowany");
    const row = await findRow(ctx, userId, domainId);
    if (row) await ctx.db.patch(row._id, { data: { ...row.data, ...patch } });
  },
});

// --- Wywoływane z actions (suno.ts) ---

export const getInternal = internalQuery({
  args: { userId: v.id("users"), domainId: v.string() },
  handler: async (ctx, { userId, domainId }): Promise<Track | null> => {
    const row = await ctx.db
      .query("tracks")
      .withIndex("by_user_domain", (q) => q.eq("userId", userId).eq("domainId", domainId))
      .unique();
    return (row?.data as Track) ?? null;
  },
});

export const listByAlbumInternal = internalQuery({
  args: { userId: v.id("users"), album: v.string() },
  handler: async (ctx, { userId, album }): Promise<Track[]> => {
    const rows = await ctx.db
      .query("tracks")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return rows.map((r) => r.data as Track).filter((t) => t.album === album);
  },
});

export const insertInternal = internalMutation({
  args: { userId: v.id("users"), track: v.any() },
  handler: async (ctx, { userId, track }) => {
    await ctx.db.insert("tracks", {
      userId,
      domainId: (track as Track).id,
      data: track,
    });
  },
});

/** Podmienia cały obiekt utworu (patchInternal merguje, więc nie umie czyścić pól). */
export const replaceInternal = internalMutation({
  args: { userId: v.id("users"), domainId: v.string(), track: v.any() },
  handler: async (ctx, { userId, domainId, track }) => {
    const row = await findRow(ctx, userId, domainId);
    if (row) await ctx.db.patch(row._id, { data: track });
  },
});

/** Atomowo zajmuje utwór do przegenerowania (status PENDING) i zwraca jego stan
 *  sprzed zmiany — drugie kliknięcie/druga karta nie zleci drugiego taska w Suno. */
export const claimRegenerationInternal = internalMutation({
  args: { userId: v.id("users"), domainId: v.string() },
  handler: async (ctx, { userId, domainId }): Promise<Track> => {
    const row = await findRow(ctx, userId, domainId);
    if (!row) throw new Error("Nie znaleziono utworu");
    const track = row.data as Track;
    if (!canRegenerate(track)) {
      throw new Error(
        track.status === "SUCCESS"
          ? "Ten utwór ma jeszcze dostępne audio — nie trzeba go przegenerowywać"
          : "Utwór jest już generowany"
      );
    }
    await ctx.db.patch(row._id, { data: { ...track, status: "PENDING" } });
    return track;
  },
});

/** Ustawia `fields` i usuwa `clear` (opcjonalnie tylko klucze z `only`). */
function merge<T extends object>(
  obj: T,
  fields: Record<string, unknown>,
  clear: string[],
  only?: string[]
): T {
  const next = { ...obj } as Record<string, unknown>;
  for (const [k, val] of Object.entries(fields)) if (!only || only.includes(k)) next[k] = val;
  for (const k of clear) if (!only || only.includes(k)) delete next[k];
  return next as T;
}

/** Merguje pola jednego wariantu w transakcji — archiwizacja i konwersja WAV
 *  działają równolegle, więc nadpisywanie całej tablicy variants gubiłoby zmiany.
 *  `clear` usuwa pola (merge nie umie ich wyczyścić). Wariant 0 jest lustrzany
 *  w płaskich polach utworu, więc audioUrl/streamAudioUrl/wavUrl synchronizujemy. */
export const patchVariantInternal = internalMutation({
  args: {
    userId: v.id("users"),
    domainId: v.string(),
    audioId: v.string(),
    fields: v.any(),
    clear: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { userId, domainId, audioId, fields, clear = [] }): Promise<boolean> => {
    const row = await findRow(ctx, userId, domainId);
    if (!row) return false;
    const track = row.data as Track;
    const variants = (track.variants ?? []).map((variant) =>
      variant.audioId === audioId ? merge(variant, fields, clear) : variant
    );
    let next: Track = { ...track, variants };
    if (track.audioId === audioId) {
      next = merge(next, fields, clear, ["audioUrl", "streamAudioUrl", "wavUrl"]);
    }
    await ctx.db.patch(row._id, { data: next });
    return true;
  },
});

/** Utwory z wariantami, których pliki nie są jeszcze w Convex storage (do backfillu). */
export const listUnarchivedInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("tracks").collect();
    const pending: {
      userId: Id<"users">;
      domainId: string;
      wavAudioIds: string[];
      audio: boolean;
    }[] = [];
    for (const row of rows) {
      const track = row.data as Track;
      if (track.status !== "SUCCESS") continue;
      // getVariants: starsze wpisy z polami płaskimi archiveTrack zamieni na wariant A
      const variants = getVariants(track);
      const audio = variants.some((v) => v.audioUrl && !v.audioStorageId && !v.audioExpired);
      const wavAudioIds = variants.filter((v) => v.wavUrl && !v.wavStorageId).map((v) => v.audioId);
      if (audio || wavAudioIds.length > 0) {
        pending.push({ userId: row.userId, domainId: row.domainId, audio, wavAudioIds });
      }
    }
    return pending;
  },
});

/** Zapisuje status taska Suno. Ignoruje odpowiedź dla starego taska (utwór w
 *  międzyczasie ponowiono) i już zamknięte utwory; przy przejściu w SUCCESS planuje
 *  archiwizację plików — w mutacji, więc dokładnie raz. Zwraca bieżący status. */
export const applyTaskUpdateInternal = internalMutation({
  args: { userId: v.id("users"), domainId: v.string(), taskId: v.string(), update: v.any() },
  handler: async (ctx, { userId, domainId, taskId, update }): Promise<string | null> => {
    const row = await findRow(ctx, userId, domainId);
    if (!row) return null;
    const track = row.data as Track;
    if (track.taskId !== taskId || track.status === "SUCCESS" || track.status === "FAILED") {
      return track.status;
    }
    await ctx.db.patch(row._id, { data: { ...track, ...update } });
    if (update.status === "SUCCESS") {
      // Suno kasuje pliki po 14 dniach — od razu kopiujemy je do Convex storage
      await ctx.scheduler.runAfter(0, internal.archive.archiveTrack, {
        userId,
        domainId,
        attempt: 0,
      });
    }
    return update.status as string;
  },
});

export const failIfPendingInternal = internalMutation({
  args: { userId: v.id("users"), domainId: v.string(), error: v.string() },
  handler: async (ctx, { userId, domainId, error }) => {
    const row = await findRow(ctx, userId, domainId);
    const track = row?.data as Track | undefined;
    if (!row || !track || track.status === "SUCCESS" || track.status === "FAILED") return;
    await ctx.db.patch(row._id, { data: { ...track, status: "FAILED", error } });
  },
});

export const patchInternal = internalMutation({
  args: { userId: v.id("users"), domainId: v.string(), patch: v.any() },
  handler: async (ctx, { userId, domainId, patch }) => {
    const row = await findRow(ctx, userId, domainId);
    if (row) await ctx.db.patch(row._id, { data: { ...row.data, ...patch } });
  },
});
