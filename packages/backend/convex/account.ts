import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { Album, LibraryDoc, Persona, Settings, Track } from "@suno/core";
import { Id } from "./_generated/dataModel";
import { mutation, query, QueryCtx } from "./_generated/server";
import { USAGE_KINDS, UsageKind } from "./limits";

// Konto: zużycie miejsca i limitów, eksport danych, usunięcie konta.

const DAY = 24 * 60 * 60 * 1000;

/** Klucze API nie wychodzą w eksporcie — plik bywa przesyłany dalej. */
const SECRET_SETTINGS: (keyof Settings)[] = [
  "openaiKey",
  "anthropicKey",
  "sunoKey",
  "anthropicAdminKey",
  "openaiAdminKey",
];

type UserTable = "tracks" | "library" | "personas" | "settings" | "albums";

async function rowsByUser(ctx: QueryCtx, table: UserTable, userId: Id<"users">) {
  // każda z tych tabel ma indeks by_user(userId) — patrz schema.ts
  const rows = await ctx.db
    .query(table as "tracks")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  return rows as { _id: Id<UserTable>; data: unknown }[];
}

function storageIdsOf(track: Track): string[] {
  const ids = (track.variants ?? []).flatMap((variant) => [
    variant.audioStorageId,
    variant.wavStorageId,
  ]);
  return [...ids, track.aiImageStorageId].filter((id): id is string => !!id);
}

/** Zajętość archiwum (Convex storage) i operacje płatne z ostatnich 30 dni. */
export const overview = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const tracks = (await rowsByUser(ctx, "tracks", userId)).map((r) => r.data as Track);
    const ids = new Set(tracks.flatMap(storageIdsOf));
    let storageBytes = 0;
    for (const id of ids) {
      const file = await ctx.db.system.get(id as Id<"_storage">);
      storageBytes += file?.size ?? 0;
    }
    const since = Date.now() - 30 * DAY;
    const usage = await ctx.db
      .query("usage")
      .withIndex("by_user_at", (q) => q.eq("userId", userId).gte("at", since))
      .collect();
    const usage30d = Object.fromEntries(USAGE_KINDS.map((k) => [k, 0])) as Record<
      UsageKind,
      number
    >;
    for (const event of usage) usage30d[event.kind as UsageKind] += event.count;
    return { storageBytes, storedFiles: ids.size, tracks: tracks.length, usage30d };
  },
});

/** Pełny eksport danych konta jako JSON (bez kluczy API). Pliki audio pobiera się
 *  z Biblioteki (ZIP/folder) — tu są ich adresy. */
export const exportData = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Niezalogowany");
    const [settingsRows, tracks, library, personas, albums] = await Promise.all([
      rowsByUser(ctx, "settings", userId),
      rowsByUser(ctx, "tracks", userId),
      rowsByUser(ctx, "library", userId),
      rowsByUser(ctx, "personas", userId),
      rowsByUser(ctx, "albums", userId),
    ]);
    const settings = settingsRows[0] ? { ...(settingsRows[0].data as Settings) } : null;
    if (settings) for (const key of SECRET_SETTINGS) delete settings[key];
    return {
      format: "suno-studio-export@1",
      exportedAt: new Date().toISOString(),
      settings,
      tracks: tracks.map((r) => r.data as Track),
      library: library.map((r) => r.data as LibraryDoc),
      personas: personas.map((r) => r.data as Persona),
      album: (albums[0]?.data as Album | undefined) ?? null,
    };
  },
});

/** Usuwa konto ze wszystkimi danymi i plikami. Wymaga wpisania „USUŃ”. */
export const deleteAccount = mutation({
  args: { confirm: v.string() },
  handler: async (ctx, { confirm }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Niezalogowany");
    if (confirm !== "USUŃ") throw new Error("Wpisz „USUŃ”, aby potwierdzić");

    const files = new Set<string>();
    for (const table of ["tracks", "library", "personas", "settings", "albums"] as const) {
      for (const row of await rowsByUser(ctx, table, userId)) {
        if (table === "tracks") storageIdsOf(row.data as Track).forEach((id) => files.add(id));
        await ctx.db.delete(row._id);
      }
    }
    for (const id of files) await ctx.storage.delete(id as Id<"_storage">);
    const usage = await ctx.db
      .query("usage")
      .withIndex("by_user_at", (q) => q.eq("userId", userId))
      .collect();
    for (const row of usage) await ctx.db.delete(row._id);

    // dane Convex Auth: konta logowania, kody, sesje z tokenami odświeżania
    const accounts = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", userId))
      .collect();
    for (const account of accounts) {
      const codes = await ctx.db
        .query("authVerificationCodes")
        .withIndex("accountId", (q) => q.eq("accountId", account._id))
        .collect();
      for (const code of codes) await ctx.db.delete(code._id);
      await ctx.db.delete(account._id);
    }
    const sessions = await ctx.db
      .query("authSessions")
      .withIndex("userId", (q) => q.eq("userId", userId))
      .collect();
    for (const session of sessions) {
      const tokens = await ctx.db
        .query("authRefreshTokens")
        .withIndex("sessionId", (q) => q.eq("sessionId", session._id))
        .collect();
      for (const token of tokens) await ctx.db.delete(token._id);
      await ctx.db.delete(session._id);
    }
    await ctx.db.delete(userId);
  },
});

/** Czy reset hasła e-mailem jest skonfigurowany (AUTH_RESEND_KEY w env Convex). */
export const passwordResetAvailable = query({
  args: {},
  handler: async () => !!process.env.AUTH_RESEND_KEY,
});
