import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import {
  activeDocs,
  generateSong,
  LibraryDoc,
  Provider,
  Settings,
  SongDraft,
  songContext,
  SunoModel,
} from "@suno/core";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";

/** Dobiera fragmenty z biblioteki (jeśli włączona) i pisze tekst piosenki. */
export const generateSongAction = action({
  args: {
    brief: v.string(),
    useLibrary: v.boolean(),
    excludedIds: v.array(v.string()),
    provider: v.string(),
    sunoModel: v.string(),
  },
  handler: async (
    ctx,
    { brief, useLibrary, excludedIds, provider, sunoModel }
  ): Promise<{ draft: SongDraft; usedSources: string | null }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Niezalogowany");
    const settings = (await ctx.runQuery(internal.settings.getInternal, {
      userId,
    })) as Settings | null;
    if (!settings) throw new Error("Brak ustawień — uzupełnij klucze API");
    await ctx.runMutation(internal.limits.consumeInternal, { userId, kind: "lyrics" });

    const docs = useLibrary
      ? ((await ctx.runQuery(internal.library.listInternal, { userId })) as LibraryDoc[])
      : [];
    const { context, guides, usedSources } = songContext(
      activeDocs(docs, useLibrary, excludedIds),
      brief
    );
    const draft = await generateSong(
      fetch,
      provider as Provider,
      settings,
      context,
      guides,
      brief,
      sunoModel as SunoModel
    );
    return { draft, usedSources };
  },
});
