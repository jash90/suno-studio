"use node";
// Node runtime: WAV-y mają ~40 MB, a domyślny runtime Convex ma tylko 64 MiB RAM.

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { ActionCtx, internalAction } from "./_generated/server";
import { fetchArchiveSource, getVariants, Track } from "@suno/core";

const MAX_ATTEMPTS = 5;
const RETRY_MS = 60_000;

// Pobieranie z CDN Suno (z rozpoznaniem wygasłych plików) — wspólne z desktopem
const fetchSource = (url: string, track: Track) => fetchArchiveSource(fetch, url, track);

async function store(ctx: ActionCtx, blob: Blob): Promise<{ storageId: string; url: string }> {
  const storageId = await ctx.storage.store(blob);
  const url = await ctx.storage.getUrl(storageId);
  if (!url) throw new Error("Nie udało się zapisać pliku w storage");
  return { storageId, url };
}

/** Wczytuje utwór; starsze wpisy mają tylko pola płaskie — zapisujemy je jako
 *  wariant A, żeby archiwizacja (i oznaczanie wygasłych) objęła też je. */
async function loadTrack(ctx: ActionCtx, userId: Id<"users">, domainId: string) {
  const track = (await ctx.runQuery(internal.tracks.getInternal, {
    userId,
    domainId,
  })) as Track | null;
  if (!track || (track.variants?.length ?? 0) > 0 || !track.audioId) return track;
  const variants = getVariants(track);
  await ctx.runMutation(internal.tracks.patchInternal, { userId, domainId, patch: { variants } });
  return { ...track, variants };
}

/** Kopiuje MP3 wszystkich wariantów utworu do Convex storage. */
export const archiveTrack = internalAction({
  args: { userId: v.id("users"), domainId: v.string(), attempt: v.number() },
  handler: async (ctx, { userId, domainId, attempt }) => {
    const track = await loadTrack(ctx, userId, domainId);
    if (!track || track.status !== "SUCCESS") return;

    let retry = false;
    for (const variant of track.variants ?? []) {
      if (!variant.audioUrl || variant.audioStorageId || variant.audioExpired) continue;
      const got = await fetchSource(variant.audioUrl, track);
      if ("blob" in got) {
        const { storageId, url } = await store(ctx, got.blob);
        const attached = await ctx.runMutation(internal.tracks.patchVariantInternal, {
          userId,
          domainId,
          audioId: variant.audioId,
          fields: { audioUrl: url, audioStorageId: storageId, sourceAudioUrl: variant.audioUrl },
        });
        // utwór (albo konto) usunięty w trakcie pobierania — nie zostawiaj sieroty w storage
        if (!attached) await ctx.storage.delete(storageId as Id<"_storage">);
      } else if ("gone" in got) {
        // martwe linki chowają odtwarzacz i przyciski pobierania w UI
        await ctx.runMutation(internal.tracks.patchVariantInternal, {
          userId,
          domainId,
          audioId: variant.audioId,
          fields: { audioExpired: true, sourceAudioUrl: variant.audioUrl },
          clear: ["audioUrl", "streamAudioUrl"],
        });
      } else {
        retry = true;
      }
    }

    if (retry && attempt + 1 < MAX_ATTEMPTS) {
      await ctx.scheduler.runAfter(RETRY_MS * (attempt + 1), internal.archive.archiveTrack, {
        userId,
        domainId,
        attempt: attempt + 1,
      });
    }
  },
});

/** Kopiuje WAV jednego wariantu (po konwersji) do Convex storage. */
export const archiveWav = internalAction({
  args: { userId: v.id("users"), domainId: v.string(), audioId: v.string(), attempt: v.number() },
  handler: async (ctx, { userId, domainId, audioId, attempt }) => {
    const track = await loadTrack(ctx, userId, domainId);
    const variant = track?.variants?.find((x) => x.audioId === audioId);
    if (!track || !variant?.wavUrl || variant.wavStorageId) return;

    const got = await fetchSource(variant.wavUrl, track);
    if ("blob" in got) {
      const { storageId, url } = await store(ctx, got.blob);
      const attached = await ctx.runMutation(internal.tracks.patchVariantInternal, {
        userId,
        domainId,
        audioId,
        fields: { wavUrl: url, wavStorageId: storageId, sourceWavUrl: variant.wavUrl },
      });
      // utwór (albo konto) usunięty w trakcie pobierania — nie zostawiaj sieroty w storage
      if (!attached) await ctx.storage.delete(storageId as Id<"_storage">);
    } else if ("gone" in got) {
      await ctx.runMutation(internal.tracks.patchVariantInternal, {
        userId,
        domainId,
        audioId,
        fields: { sourceWavUrl: variant.wavUrl },
        clear: ["wavUrl"],
      });
    } else if (attempt + 1 < MAX_ATTEMPTS) {
      await ctx.scheduler.runAfter(RETRY_MS * (attempt + 1), internal.archive.archiveWav, {
        userId,
        domainId,
        audioId,
        attempt: attempt + 1,
      });
    }
  },
});

/** Jednorazowo po wdrożeniu: `npx convex run archive:backfill --prod`.
 *  Planuje archiwizację wszystkich utworów, których pliki nie są jeszcze w storage. */
export const backfill = internalAction({
  args: {},
  handler: async (ctx): Promise<{ tracks: number; wavs: number }> => {
    const pending = await ctx.runQuery(internal.tracks.listUnarchivedInternal, {});
    let delay = 0;
    let wavs = 0;
    // rozłożone w czasie, żeby nie ściągać kilkudziesięciu plików naraz
    for (const p of pending) {
      if (p.audio) {
        await ctx.scheduler.runAfter(delay, internal.archive.archiveTrack, {
          userId: p.userId,
          domainId: p.domainId,
          attempt: 0,
        });
        delay += 2_000;
      }
      for (const audioId of p.wavAudioIds) {
        await ctx.scheduler.runAfter(delay, internal.archive.archiveWav, {
          userId: p.userId,
          domainId: p.domainId,
          audioId,
          attempt: 0,
        });
        delay += 2_000;
        wavs++;
      }
    }
    return { tracks: pending.filter((p) => p.audio).length, wavs };
  },
});
