import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { LibraryDoc, Provider, Settings, SongDraft, SunoModel } from "@suno/core";
import { generateSong } from "./lib/llm";
import { buildContext, retrieveChunks, summarizeSources } from "@suno/core";

const GUIDE_QUERY_SUFFIX =
  "styl gatunek tagi suno struktura piosenki style tags vocal ambience intro outro chorus verse bridge instrumental meta tags";

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

    let context = "";
    let guides = "";
    let usedSources: string | null = null;

    if (useLibrary) {
      const docs = (await ctx.runQuery(internal.library.listInternal, {
        userId,
      })) as LibraryDoc[];
      const active = docs.filter((d) => !excludedIds.includes(d.id));
      if (active.length > 0) {
        const contentDocs = active.filter((d) => d.kind !== "guide");
        const guideDocs = active.filter((d) => d.kind === "guide");
        const chunks = retrieveChunks(contentDocs, brief);
        context = buildContext(chunks);
        const guideChunks = retrieveChunks(guideDocs, `${brief} ${GUIDE_QUERY_SUFFIX}`, 6);
        guides = buildContext(guideChunks);
        const parts = [
          chunks.length > 0 ? `źródła: ${summarizeSources(chunks)}` : null,
          guideChunks.length > 0 ? `poradniki: ${summarizeSources(guideChunks)}` : null,
        ].filter(Boolean) as string[];
        usedSources = parts.length > 0 ? parts.join(" | ") : null;
      }
    }

    const draft = await generateSong(
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
