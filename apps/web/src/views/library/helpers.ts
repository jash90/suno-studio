import { getVariants, imageExt, PlayQueueItem, Track, TrackVariant } from "@suno/core";

export const VARIANT_LETTERS = ["A", "B", "C", "D"];

/** Które warianty utworów albumu trafiają do kolejki i pobierania. */
export type VariantMode = "a" | "b" | "both";

export const IN_PROGRESS: Track["status"][] = ["PENDING", "TEXT_SUCCESS", "FIRST_SUCCESS"];

export const STATUS_LABELS: Record<Track["status"], string> = {
  PENDING: "W kolejce",
  TEXT_SUCCESS: "Tekst przetworzony",
  FIRST_SUCCESS: "Pierwszy utwór gotowy",
  SUCCESS: "Gotowe",
  FAILED: "Błąd",
};

/** Aktywna okładka: AI (jeśli wybrana i istnieje) albo oryginalna z Suno. */
export function activeCover(track: Track, variant?: TrackVariant): string | undefined {
  if (track.coverSource === "ai" && track.aiImageUrl) return track.aiImageUrl;
  return variant?.imageUrl ?? track.imageUrl;
}

/** Rozszerzenie pliku okładki — URL-e Convex storage (AI) nie mają rozszerzenia. */
export function coverExt(url: string, track: Track): string {
  return url === track.aiImageUrl ? "png" : imageExt(url);
}

export function plural(n: number): string {
  if (n === 1) return "utwór";
  const last = n % 10;
  const tens = n % 100;
  if (last >= 2 && last <= 4 && (tens < 12 || tens > 14)) return "utwory";
  return "utworów";
}

export function formatDuration(seconds?: number): string {
  if (!seconds) return "";
  const s = Math.round(seconds);
  return ` ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function formatElapsed(fromIso: string, now: number): string {
  const s = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Warianty wybrane trybem: "a"/"b" — jeden wskazany (fallback do A, gdy B nie istnieje). */
export function chosenVariants(track: Track, mode: VariantMode): TrackVariant[] {
  const all = getVariants(track);
  return mode === "both" ? all : [all[mode === "b" ? 1 : 0] ?? all[0]].filter(Boolean);
}

export function variantLetter(track: Track, variant: TrackVariant): string {
  const index = getVariants(track).indexOf(variant);
  return VARIANT_LETTERS[index] ?? String(index + 1);
}

export function variantName(track: Track, index: number): string {
  const count = getVariants(track).length;
  return count > 1
    ? `${track.title} (wariant ${VARIANT_LETTERS[index] ?? index + 1})`
    : track.title;
}

export function modeLabel(mode: VariantMode): string {
  return mode === "both" ? "A+B" : mode.toUpperCase();
}

/** Kolejka odtwarzania albumu z wariantów wybranych przełącznikiem. */
export function buildQueue(list: Track[], mode: VariantMode): PlayQueueItem[] {
  const items: PlayQueueItem[] = [];
  list.forEach((t, i) => {
    if (t.status !== "SUCCESS") return;
    const many = getVariants(t).length > 1;
    for (const v of chosenVariants(t, mode)) {
      const url = v.audioUrl || v.streamAudioUrl;
      if (!url) continue;
      items.push({
        trackId: t.id,
        label: `${(t.albumIndex ?? i) + 1}. ${t.title}${many ? ` (${variantLetter(t, v)})` : ""}`,
        url,
      });
    }
  });
  return items;
}

export interface LibrarySection {
  name: string | null; // null = pojedyncze utwory
  tracks: Track[];
}

/** Sekcja per album (kolejność płyty) + sekcja pojedynczych utworów; sekcje
 *  ułożone wg najświeższej aktywności. */
export function groupSections(tracks: Track[]): LibrarySection[] {
  const albumGroups = new Map<string, Track[]>();
  const singles: Track[] = [];
  for (const track of tracks) {
    if (track.album) {
      if (!albumGroups.has(track.album)) albumGroups.set(track.album, []);
      albumGroups.get(track.album)!.push(track);
    } else {
      singles.push(track);
    }
  }
  const newest = (list: Track[]) => Math.max(...list.map((t) => new Date(t.createdAt).getTime()));
  return [
    ...[...albumGroups.entries()].map(([name, list]) => ({
      name,
      tracks: [...list].sort(
        (a, b) =>
          (a.albumIndex ?? Infinity) - (b.albumIndex ?? Infinity) ||
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      ),
    })),
    ...(singles.length > 0 ? [{ name: null, tracks: singles }] : []),
  ].sort((a, b) => newest(b.tracks) - newest(a.tracks));
}
