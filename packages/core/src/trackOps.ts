import { Track, TrackVariant } from "./types";

// Operacje na utworach wspólne dla Convex i lokalnego silnika desktopu.

/** Ustawia `fields` i usuwa `clear` (opcjonalnie tylko klucze z `only`). */
function merge<T extends object>(
  obj: T,
  fields: Record<string, unknown>,
  clear: string[],
  only?: string[]
): T {
  const next = { ...obj } as Record<string, unknown>;
  for (const [k, val] of Object.entries(fields)) if (!only || only.includes(k)) next[k] = val;
  for (const k of clear) if (!only || only.includes(k)) delete next[k];
  return next as T;
}

/** Zmienia pola jednego wariantu (`clear` usuwa pola). Wariant 0 jest lustrzany
 *  w płaskich polach utworu, więc audioUrl/streamAudioUrl/wavUrl synchronizujemy. */
export function patchVariant(
  track: Track,
  audioId: string,
  fields: Partial<TrackVariant>,
  clear: (keyof TrackVariant)[] = []
): Track {
  const variants = (track.variants ?? []).map((variant) =>
    variant.audioId === audioId ? merge(variant, fields, clear) : variant
  );
  let next: Track = { ...track, variants };
  if (track.audioId === audioId) {
    next = merge(next, fields, clear, ["audioUrl", "streamAudioUrl", "wavUrl"]);
  }
  return next;
}

/** Zapisuje status taska Suno na utworze. null = nic do zmiany (stary task po
 *  ponowieniu albo utwór już zamknięty). */
export function applyTaskUpdate(
  track: Track,
  taskId: string,
  update: Partial<Track>
): Track | null {
  if (track.taskId !== taskId || track.status === "SUCCESS" || track.status === "FAILED") {
    return null;
  }
  return { ...track, ...update };
}

export const IN_PROGRESS_STATUSES: Track["status"][] = ["PENDING", "TEXT_SUCCESS", "FIRST_SUCCESS"];

/** Usuwa pola okładki AI (reset). */
export function withoutAiCover(track: Track): Track {
  const {
    aiImageUrl: _u,
    aiImageStorageId: _id,
    coverSource: _src,
    coverStatus: _s,
    coverError: _e,
    ...rest
  } = track;
  return rest;
}
