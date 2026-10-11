import { buildContext, retrieveChunks, summarizeSources } from "./rag";
import { Album, AlbumSong, LibraryDoc } from "./types";

// Dobór kontekstu z biblioteki dla LLM — wspólny dla Convex i silnika desktopu.

const GUIDE_QUERY_SUFFIX =
  "styl gatunek tagi suno struktura piosenki style tags vocal ambience intro outro chorus verse bridge instrumental meta tags";

export interface SongContext {
  context: string;
  guides: string;
  usedSources: string | null;
}

/** Aktywne dokumenty: biblioteka włączona i plik nie odznaczony przez użytkownika. */
export function activeDocs(docs: LibraryDoc[], useLibrary: boolean, excludedIds: string[] = []) {
  return useLibrary ? docs.filter((d) => !excludedIds.includes(d.id)) : [];
}

/** Fragmenty treści (BM25 po briefie) + poradniki doklejane do promptu systemowego. */
export function songContext(docs: LibraryDoc[], brief: string): SongContext {
  if (docs.length === 0) return { context: "", guides: "", usedSources: null };
  const chunks = retrieveChunks(
    docs.filter((d) => d.kind !== "guide"),
    brief
  );
  const guideChunks = retrieveChunks(
    docs.filter((d) => d.kind === "guide"),
    `${brief} ${GUIDE_QUERY_SUFFIX}`,
    6
  );
  const parts = [
    chunks.length > 0 ? `źródła: ${summarizeSources(chunks)}` : null,
    guideChunks.length > 0 ? `poradniki: ${summarizeSources(guideChunks)}` : null,
  ].filter((p): p is string => p !== null);
  return {
    context: buildContext(chunks),
    guides: buildContext(guideChunks),
    usedSources: parts.length > 0 ? parts.join(" | ") : null,
  };
}

/** Same poradniki (plan albumu). */
export function guidesFor(docs: LibraryDoc[], query: string): string {
  const guideDocs = docs.filter((d) => d.kind === "guide");
  if (guideDocs.length === 0) return "";
  return buildContext(retrieveChunks(guideDocs, `${query} ${GUIDE_QUERY_SUFFIX}`, 6));
}

/** Brief jednej piosenki albumu: plan utworu + wspólny kierunek płyty. */
export function albumSongBrief(song: AlbumSong, album: Album): string {
  return (
    `${song.plan.brief}\nWspólny kierunek albumu: ${album.styleDirection}` +
    `\nWskazówki stylu tego utworu: ${song.plan.styleHints}` +
    `\nProponowany tytuł: ${song.plan.title}`
  );
}

/** Kontekst piosenki albumu: treść dobierana po briefie planu, poradniki jak przy planie. */
export function albumSongContext(docs: LibraryDoc[], song: AlbumSong): SongContext {
  const content = docs.filter((d) => d.kind !== "guide");
  return {
    context: content.length > 0 ? buildContext(retrieveChunks(content, song.plan.brief)) : "",
    guides: guidesFor(docs, song.plan.brief),
    usedSources: null,
  };
}

/** Piosenki albumu, które jeszcze trzeba napisać (pomija gotowe, wysłane i w toku). */
export function songsToWrite(album: Album): number[] {
  return album.songs
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => !["written", "sent", "writing"].includes(s.status))
    .map(({ i }) => i);
}
