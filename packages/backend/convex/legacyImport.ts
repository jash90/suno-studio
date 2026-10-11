import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import {
  DEFAULT_SETTINGS,
  guessDocKind,
  LibraryDoc,
  Persona,
  sanitizeAlbum,
  sanitizeSettings,
  Settings,
  Track,
} from "@suno/core";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { mutation, MutationCtx } from "./_generated/server";

// Jednorazowy import danych starej aplikacji desktopowej (pliki tauri-plugin-store)
// na konto Convex. Klient (powłoka Tauri) czyta pliki i wysyła je partiami.
// Idempotentny: ponowne uruchomienie niczego nie dubluje ani nie nadpisuje.

async function requireUser(ctx: MutationCtx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Niezalogowany");
  return userId;
}

/** URL do wgrania okładki AI z dysku do Convex storage (przed importem utworów). */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx): Promise<string> => {
    await requireUser(ctx);
    return ctx.storage.generateUploadUrl();
  },
});

/** Pola desktopowe, których nie ma w modelu web/Convex. */
const LOCAL_ONLY_TRACK_FIELDS = ["aiImagePath"] as const;

export const importBatch = mutation({
  args: {
    settings: v.optional(v.any()),
    tracks: v.optional(v.array(v.any())),
    library: v.optional(v.array(v.any())),
    personas: v.optional(v.array(v.any())),
    album: v.optional(v.any()),
    /** aiImagePath (ścieżka z dysku) → storageId wgranej okładki */
    covers: v.optional(v.array(v.object({ path: v.string(), storageId: v.id("_storage") }))),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const result = { tracks: 0, library: 0, personas: 0, album: false, settings: false };

    if (args.settings) result.settings = await importSettings(ctx, userId, args.settings);

    const coverUrls = new Map<string, { storageId: string; url: string }>();
    for (const { path, storageId } of args.covers ?? []) {
      const url = await ctx.storage.getUrl(storageId);
      if (url) coverUrls.set(path, { storageId, url });
    }

    for (const raw of args.tracks ?? []) {
      const legacy = raw as Track & { aiImagePath?: string };
      if (!legacy?.id) continue;
      const exists = await ctx.db
        .query("tracks")
        .withIndex("by_user_domain", (q) => q.eq("userId", userId).eq("domainId", legacy.id))
        .unique();
      if (exists) continue;
      const cover = legacy.aiImagePath ? coverUrls.get(legacy.aiImagePath) : undefined;
      const track: Record<string, unknown> = { ...legacy };
      for (const field of LOCAL_ONLY_TRACK_FIELDS) delete track[field];
      if (cover) {
        track.aiImageUrl = cover.url;
        track.aiImageStorageId = cover.storageId;
      } else if (track.coverSource === "ai") {
        delete track.coverSource; // plik okładki nie przyszedł — zostaje okładka Suno
      }
      // generacja przerwana zamknięciem desktopu — polling nie wróci, oznacz jako błąd
      if (!["SUCCESS", "FAILED"].includes(legacy.status)) {
        track.status = "FAILED";
        track.error =
          "Generacja przerwana przed migracją z aplikacji desktopowej — wygeneruj ponownie";
      }
      await ctx.db.insert("tracks", { userId, domainId: legacy.id, data: track });
      result.tracks++;
      // archiwizacja skopiuje żywe pliki, a wygasłe (>14 dni) oznaczy do przegenerowania
      if (track.status === "SUCCESS") {
        await ctx.scheduler.runAfter(0, internal.archive.archiveTrack, {
          userId,
          domainId: legacy.id,
          attempt: 0,
        });
      }
    }

    for (const raw of args.library ?? []) {
      const doc = raw as LibraryDoc;
      if (!doc?.id) continue;
      const exists = await ctx.db
        .query("library")
        .withIndex("by_user_domain", (q) => q.eq("userId", userId).eq("domainId", doc.id))
        .unique();
      if (exists) continue;
      const data: LibraryDoc = { ...doc, kind: doc.kind ?? guessDocKind(doc.name) };
      await ctx.db.insert("library", { userId, domainId: doc.id, data });
      result.library++;
    }

    if (args.personas?.length) {
      const known = new Set(
        (
          await ctx.db
            .query("personas")
            .withIndex("by_user", (q) => q.eq("userId", userId))
            .collect()
        ).map((r) => (r.data as Persona).id)
      );
      for (const raw of args.personas) {
        const persona = raw as Persona;
        if (!persona?.id || known.has(persona.id)) continue;
        await ctx.db.insert("personas", { userId, data: persona });
        known.add(persona.id);
        result.personas++;
      }
    }

    if (args.album) {
      const current = await ctx.db
        .query("albums")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique();
      // jeden aktywny album per user — nie nadpisujemy tego, nad którym trwa praca
      const album = sanitizeAlbum(args.album);
      if (!current && album) {
        await ctx.db.insert("albums", { userId, data: album });
        result.album = true;
      }
    }

    return result;
  },
});

/** Uzupełnia tylko puste pola ustawień konta wartościami z desktopu. */
async function importSettings(
  ctx: MutationCtx,
  userId: Id<"users">,
  legacy: Record<string, unknown>
): Promise<boolean> {
  const row = await ctx.db
    .query("settings")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  const current: Record<string, unknown> = {
    ...DEFAULT_SETTINGS,
    ...((row?.data as Settings) ?? {}),
  };
  let changed = false;
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const value = legacy[key];
    const empty = current[key] === "" || current[key] === undefined;
    const sameAsDefault = row === null; // świeże konto — ustawienia desktopu wygrywają
    if (value !== undefined && value !== "" && (empty || sameAsDefault) && current[key] !== value) {
      current[key] = value;
      changed = true;
    }
  }
  if (!changed) return false;
  const data = sanitizeSettings(current);
  if (row) await ctx.db.patch(row._id, { data });
  else await ctx.db.insert("settings", { userId, data });
  return true;
}
