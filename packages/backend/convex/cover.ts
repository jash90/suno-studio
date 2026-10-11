import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, ActionCtx } from "./_generated/server";
import { Track } from "@suno/core";
import { requireSettings } from "./suno";

// Okładki AI przez OpenAI Images API (gpt-image-1.5) — obok okładek Suno.
// Prompt w pełni automatyczny, po angielsku (lepsze wyniki), bez tekstu na obrazie.

/** Prompt okładki utworu z metadanych; instrumental → sam tytuł i styl. */
function coverPrompt(title: string, style: string, lyrics?: string): string {
  const fragment = lyrics
    ?.replace(/\[[^\]]*\]/g, " ") // tagi Suno: [Verse], [Chorus]...
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
  return (
    `Album cover artwork for a song titled "${title}". ` +
    `Musical style and genre: ${style}. ` +
    (fragment
      ? `Mood, themes and imagery inspired by these lyrics: ${fragment}. `
      : "") +
    `Square professional album cover, striking composition, no text, no words, no letters, no typography.`
  );
}

/** Prompt jednej wspólnej okładki albumu. */
function albumCoverPrompt(albumName: string, tracks: Track[]): string {
  const styles = [...new Set(tracks.map((t) => t.style))].join("; ").slice(0, 600);
  const titles = tracks.map((t) => t.title).join(", ").slice(0, 300);
  return (
    `Album cover artwork for a music album titled "${albumName}". ` +
    `Track titles: ${titles}. Musical styles across the album: ${styles}. ` +
    `One cohesive square professional album cover, striking composition, no text, no words, no letters, no typography.`
  );
}

/** Generuje obraz w OpenAI (gpt-image zwraca zawsze b64_json) i zwraca Blob PNG. */
async function generateImage(openaiKey: string, prompt: string): Promise<Blob> {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-image-1.5",
      prompt,
      size: "1024x1024",
      quality: "medium", // ponytail: medium wystarcza na okładkę; "high" gdyby jakość zawiodła
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI Images (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { data?: { b64_json?: string }[] };
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI nie zwróciło obrazu");
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: "image/png" });
}

/** Zapisuje obraz do Convex storage i zwraca { url, storageId }. */
// ponytail: stare pliki storage nie są sprzątane przy regeneracji — storageId
// jest zapisywany na tracku, więc sprzątanie da się dodać później.
async function storeImage(
  ctx: ActionCtx,
  blob: Blob
): Promise<{ url: string; storageId: string }> {
  const storageId = await ctx.storage.store(blob);
  const url = await ctx.storage.getUrl(storageId);
  if (!url) throw new Error("Nie udało się zapisać okładki");
  return { url, storageId };
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

    const blob = await generateImage(
      settings.openaiKey,
      coverPrompt(track.title, track.style, track.instrumental ? undefined : track.lyrics)
    );
    const { url, storageId } = await storeImage(ctx, blob);
    await ctx.runMutation(internal.tracks.patchInternal, {
      userId,
      domainId,
      patch: { aiImageUrl: url, aiImageStorageId: storageId, coverSource: "ai" },
    });
    return url;
  },
});

/** Generuje jedną wspólną okładkę AI dla albumu i zapisuje ją na każdym tracku. */
export const generateAlbumCover = action({
  args: { album: v.string() },
  handler: async (ctx, { album }): Promise<string> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Niezalogowany");
    const settings = await requireSettings(ctx, userId);
    if (!settings.openaiKey) throw new Error("Brak klucza OpenAI — uzupełnij w Ustawieniach");
    const tracks = (await ctx.runQuery(internal.tracks.listByAlbumInternal, {
      userId,
      album,
    })) as Track[];
    if (tracks.length === 0) throw new Error("Nie znaleziono utworów albumu");

    const blob = await generateImage(settings.openaiKey, albumCoverPrompt(album, tracks));
    const { url, storageId } = await storeImage(ctx, blob);
    for (const t of tracks) {
      await ctx.runMutation(internal.tracks.patchInternal, {
        userId,
        domainId: t.id,
        patch: { aiImageUrl: url, aiImageStorageId: storageId, coverSource: "ai" },
      });
    }
    return url;
  },
});
