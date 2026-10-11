import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  MutationCtx,
  query,
  QueryCtx,
} from "./_generated/server";
import {
  Album,
  AlbumConcept,
  AlbumSong,
  LibraryDoc,
  Provider,
  Settings,
  SunoModel,
} from "@suno/core";
import { generateAlbumConcept, generateSong } from "./lib/llm";
import { buildContext, retrieveChunks } from "@suno/core";

const GUIDE_QUERY_SUFFIX =
  "styl gatunek tagi suno struktura piosenki style tags vocal ambience intro outro chorus verse bridge instrumental meta tags";

async function readAlbum(
  ctx: QueryCtx,
  userId: Id<"users">
): Promise<Album | null> {
  const row = await ctx.db
    .query("albums")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  return (row?.data as Album) ?? null;
}

export const get = query({
  args: {},
  handler: async (ctx): Promise<Album | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    return readAlbum(ctx, userId);
  },
});

/** Ustawia (lub usuwa, gdy null) aktywny album usera. */
export const set = mutation({
  args: { album: v.any() },
  handler: async (ctx, { album }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Niezalogowany");
    const row = await ctx.db
      .query("albums")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (album === null) {
      if (row) await ctx.db.delete(row._id);
      return;
    }
    if (row) await ctx.db.patch(row._id, { data: album });
    else await ctx.db.insert("albums", { userId, data: album });
  },
});

export const patchSong = mutation({
  args: { index: v.number(), patch: v.any() },
  handler: async (ctx, { index, patch }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Niezalogowany");
    await applySongPatch(ctx, userId, index, patch);
  },
});

async function applySongPatch(
  ctx: MutationCtx,
  userId: Id<"users">,
  index: number,
  patch: Partial<AlbumSong>
) {
  const row = await ctx.db
    .query("albums")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (!row) return;
  const album = row.data as Album;
  const songs = album.songs.map((s, i) => {
    if (i !== index) return s;
    const merged: AlbumSong = { ...s, ...patch };
    // Convex pomija undefined w argumentach, więc czyścimy błąd jawnie przy każdej
    // zmianie statusu na inny niż "error" (piosenka pisana ponownie po błędzie).
    if (patch.status && patch.status !== "error") delete merged.error;
    return merged;
  });
  await ctx.db.patch(row._id, { data: { ...album, songs } });
}

// --- Wersje internal dla akcji ---

export const getInternal = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<Album | null> => {
    return readAlbum(ctx, userId);
  },
});

export const patchSongInternal = internalMutation({
  args: { userId: v.id("users"), index: v.number(), patch: v.any() },
  handler: async (ctx, { userId, index, patch }) => {
    await applySongPatch(ctx, userId, index, patch);
  },
});

function retrieveGuides(
  docs: LibraryDoc[],
  useLibrary: boolean,
  query: string
): string {
  if (!useLibrary) return "";
  const guideDocs = docs.filter((d) => d.kind === "guide");
  if (guideDocs.length === 0) return "";
  return buildContext(retrieveChunks(guideDocs, `${query} ${GUIDE_QUERY_SUFFIX}`, 6));
}

/** Planuje koncept-album (retrieval poradników + LLM) i zwraca gotowy AlbumConcept. */
export const plan = action({
  args: {
    brief: v.string(),
    songCount: v.number(),
    provider: v.string(),
    useLibrary: v.boolean(),
    // opcjonalne dla kompatybilności ze starszym, zbuforowanym frontendem
    excludedIds: v.optional(v.array(v.string())),
  },
  handler: async (
    ctx,
    { brief, songCount, provider, useLibrary, excludedIds }
  ): Promise<AlbumConcept> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Niezalogowany");
    const settings = (await ctx.runQuery(internal.settings.getInternal, {
      userId,
    })) as Settings | null;
    if (!settings) throw new Error("Brak ustawień — uzupełnij klucze API");
    const excluded = excludedIds ?? [];
    const docs = useLibrary
      ? ((await ctx.runQuery(internal.library.listInternal, { userId })) as LibraryDoc[]).filter(
          (d) => !excluded.includes(d.id)
        )
      : [];
    const guides = retrieveGuides(docs, useLibrary, brief);
    return generateAlbumConcept(
      provider as Provider,
      settings,
      brief,
      songCount,
      guides
    );
  },
});

/** Sekwencyjnie pisze teksty wszystkich zaplanowanych piosenek, patchując wiersz
 *  albumu po każdej — działa server-side, więc przeżywa reload strony. */
export const writeLyrics = action({
  args: {
    provider: v.string(),
    sunoModel: v.string(),
    useLibrary: v.boolean(),
    // opcjonalne dla kompatybilności ze starszym, zbuforowanym frontendem
    excludedIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { provider, sunoModel, useLibrary, excludedIds }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Niezalogowany");
    const settings = (await ctx.runQuery(internal.settings.getInternal, {
      userId,
    })) as Settings | null;
    if (!settings) throw new Error("Brak ustawień — uzupełnij klucze API");
    const excluded = excludedIds ?? [];
    const docs = useLibrary
      ? ((await ctx.runQuery(internal.library.listInternal, { userId })) as LibraryDoc[]).filter(
          (d) => !excluded.includes(d.id)
        )
      : [];
    const contentDocs = docs.filter((d) => d.kind !== "guide");
    const guideDocs = docs.filter((d) => d.kind === "guide");

    const start = (await ctx.runQuery(internal.album.getInternal, {
      userId,
    })) as Album | null;
    if (!start) return;
    const total = start.songs.length;

    for (let i = 0; i < total; i++) {
      const album = (await ctx.runQuery(internal.album.getInternal, {
        userId,
      })) as Album | null;
      if (!album) return; // album usunięty w trakcie
      const song = album.songs[i];
      if (
        !song ||
        song.status === "written" ||
        song.status === "sent" ||
        song.status === "writing"
      )
        continue;
      await ctx.runMutation(internal.album.patchSongInternal, {
        userId,
        index: i,
        patch: { status: "writing", error: undefined },
      });
      const songBrief =
        `${song.plan.brief}\nWspólny kierunek albumu: ${album.styleDirection}` +
        `\nWskazówki stylu tego utworu: ${song.plan.styleHints}` +
        `\nProponowany tytuł: ${song.plan.title}`;
      try {
        const context =
          useLibrary && contentDocs.length > 0
            ? buildContext(retrieveChunks(contentDocs, song.plan.brief))
            : "";
        const guides = retrieveGuides(guideDocs, useLibrary, song.plan.brief);
        const draft = await generateSong(
          provider as Provider,
          settings,
          context,
          guides,
          songBrief,
          sunoModel as SunoModel
        );
        await ctx.runMutation(internal.album.patchSongInternal, {
          userId,
          index: i,
          patch: { status: "written", draft },
        });
      } catch (e) {
        await ctx.runMutation(internal.album.patchSongInternal, {
          userId,
          index: i,
          patch: { status: "error", error: e instanceof Error ? e.message : String(e) },
        });
      }
    }
  },
});
