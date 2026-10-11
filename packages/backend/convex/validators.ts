import { v } from "convex/values";

// Walidatory argumentów mutacji wywoływanych z klienta. Tabele trzymają obiekt
// domenowy w `data: v.any()` (patrz schema.ts), więc to tu — na wejściu — pilnujemy
// kształtu tego, co klient może zapisać.

export const songDraft = v.object({
  title: v.string(),
  style: v.string(),
  lyrics: v.string(),
});

export const docKind = v.union(v.literal("content"), v.literal("guide"));

export const libraryDoc = v.object({
  id: v.string(),
  name: v.string(),
  path: v.string(),
  chunks: v.array(v.string()),
  kind: docKind,
  addedAt: v.string(),
});

/** Klient zmienia w utworze wyłącznie wybór aktywnej okładki — reszta pól
 *  (status, URL-e audio, storage) należy do backendu. */
export const trackClientPatch = v.object({
  coverSource: v.optional(v.union(v.literal("suno"), v.literal("ai"))),
});

export const albumSongPatch = v.object({
  status: v.optional(
    v.union(
      v.literal("planned"),
      v.literal("writing"),
      v.literal("written"),
      v.literal("error"),
      v.literal("sent")
    )
  ),
  draft: v.optional(songDraft),
  error: v.optional(v.string()),
  trackId: v.optional(v.string()),
});
