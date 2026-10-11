import { useMemo, useRef } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@suno/backend/api";
import { DEFAULT_SETTINGS } from "@suno/core";
import type { StudioActions, StudioBackend, StudioData } from "./types";

/** Trzyma ostatnią znaną wartość kwerendy. Przy reconnect'cie Convexa (deploy
 *  funkcji, odświeżenie tokenu, zanik sieci) useQuery chwilowo zwraca undefined —
 *  bez latcha cały interfejs przeskakiwał na „Wczytywanie..." i montował się od
 *  nowa (wszystko "skakało"). Z latchem pełny ekran ładowania jest tylko raz. */
function useLatest<T>(value: T | undefined): T | undefined {
  const ref = useRef<T | undefined>(undefined);
  if (value !== undefined) ref.current = value;
  return ref.current;
}

/** Mutacje/akcje Convex bez wyniku zwracają null — kontrakt Studia mówi void. */
const done =
  <A extends unknown[]>(call: (...args: A) => Promise<unknown>) =>
  async (...args: A): Promise<void> => {
    await call(...args);
  };

/** Studio na Convex (web): dane konta w chmurze, logika w akcjach backendu. */
export function useConvexStudio(): StudioBackend {
  const settings = useLatest(useQuery(api.settings.get));
  const tracks = useLatest(useQuery(api.tracks.list));
  const library = useLatest(useQuery(api.library.list));
  const personas = useLatest(useQuery(api.personas.list));
  const album = useLatest(useQuery(api.album.get));

  const saveSettings = useMutation(api.settings.save);
  const removeTrack = useMutation(api.tracks.remove);
  const patchTrack = useMutation(api.tracks.patch);
  const addLibrary = useMutation(api.library.add);
  const setKind = useMutation(api.library.setKind);
  const removeLibrary = useMutation(api.library.remove);
  const setAlbum = useMutation(api.album.set);
  const patchSong = useMutation(api.album.patchSong);
  const generateAlbumCovers = useMutation(api.cover.generateAlbumCovers);
  const resetCovers = useMutation(api.cover.reset);

  const writeSong = useAction(api.generate.generateSongAction);
  const startGeneration = useAction(api.suno.startGeneration);
  const retryGeneration = useAction(api.suno.retryGeneration);
  const regenerateExpired = useAction(api.suno.regenerateExpired);
  const convertToWav = useAction(api.suno.convertToWav);
  const generateCover = useAction(api.cover.generateTrackCover);
  const createPersona = useAction(api.suno.createPersona);
  const getCredits = useAction(api.suno.getCredits);
  const planAlbum = useAction(api.album.plan);
  const writeAlbumLyrics = useAction(api.album.writeLyrics);
  const fetchBalances = useAction(api.balances.fetch_);

  const actions = useMemo<StudioActions>(
    () => ({
      saveSettings: done((s) => saveSettings({ settings: s })),
      fetchBalances: () => fetchBalances({}),
      getCredits: (sunoKey) => getCredits({ sunoKey }),
      writeSong: (params) => writeSong(params),
      startGeneration: (params) => startGeneration(params),
      retryGeneration: done((id) => retryGeneration({ domainId: id })),
      regenerateExpired: done((id) => regenerateExpired({ domainId: id })),
      convertToWav: (id, audioId) => convertToWav({ domainId: id, audioId }),
      createPersona: done((id: string, audioId: string, name: string, description: string) =>
        createPersona({ domainId: id, audioId, name, description })
      ),
      removeTrack: done((id) => removeTrack({ domainId: id })),
      setCoverSource: async (ids, source) => {
        for (const id of ids) await patchTrack({ domainId: id, patch: { coverSource: source } });
      },
      generateCover: async (id) => {
        await generateCover({ domainId: id });
      },
      generateAlbumCovers: (name) => generateAlbumCovers({ album: name }),
      resetCovers: (ids) => resetCovers({ domainIds: ids }),
      planAlbum: (params) => planAlbum(params),
      writeAlbumLyrics: done((params) => writeAlbumLyrics(params)),
      setAlbum: done((next) => setAlbum({ album: next })),
      patchAlbumSong: done((index, patch) => patchSong({ index, patch })),
      addLibraryDocs: async (docs) => {
        for (const doc of docs) await addLibrary({ doc });
      },
      setDocKind: done((id, kind) => setKind({ domainId: id, kind })),
      removeLibraryDoc: done((id) => removeLibrary({ domainId: id })),
    }),
    [
      saveSettings,
      fetchBalances,
      getCredits,
      writeSong,
      startGeneration,
      retryGeneration,
      regenerateExpired,
      convertToWav,
      createPersona,
      removeTrack,
      patchTrack,
      generateCover,
      generateAlbumCovers,
      resetCovers,
      planAlbum,
      writeAlbumLyrics,
      setAlbum,
      patchSong,
      addLibrary,
      setKind,
      removeLibrary,
    ]
  );

  const ready =
    settings !== undefined &&
    tracks !== undefined &&
    library !== undefined &&
    personas !== undefined &&
    album !== undefined;
  const data: StudioData | undefined = ready
    ? { settings: { ...DEFAULT_SETTINGS, ...(settings ?? {}) }, tracks, library, personas, album }
    : undefined;
  return { data, actions };
}
