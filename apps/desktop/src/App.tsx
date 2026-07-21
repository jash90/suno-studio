import { useEffect, useRef, useState } from "react";
import { Headphones } from "lucide-react";
import BalanceBar from "./components/BalanceBar";
import { fetchBalances } from "./services/balances";
import AlbumView from "./views/AlbumView";
import CreateView from "./views/CreateView";
import FilesView from "./views/FilesView";
import LibraryView from "./views/LibraryView";
import PlayerView from "./views/PlayerView";
import SettingsView from "./views/SettingsView";
import {
  loadAlbum,
  loadLibrary,
  loadPersonas,
  loadSettings,
  loadTracks,
  saveAlbum,
  saveLibrary,
  savePersonas,
  saveSettings,
  saveTracks,
} from "./services/storage";
import { generateSong } from "./services/llm";
import { generateTrackCover } from "./services/cover";
import { buildContext, retrieveChunks } from "./services/rag";
import { createPersona, createTask, getTaskStatus, pollTask } from "./services/suno";
import {
  Album,
  Balances,
  DEFAULT_SETTINGS,
  LibraryDoc,
  Persona,
  PersonaModel,
  Playback,
  Provider,
  Settings,
  SongDraft,
  SunoModel,
  Track,
} from "./types";
import "./App.css";

type View = "create" | "album" | "files" | "library" | "player" | "settings";

export default function App() {
  const [view, setView] = useState<View>("create");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [library, setLibrary] = useState<LibraryDoc[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [album, setAlbum] = useState<Album | null>(null);
  const [albumWriting, setAlbumWriting] = useState(false);
  const [balances, setBalances] = useState<Balances>({});
  // Kolejka odtwarzania żyje na poziomie App — gra niezależnie od aktywnej zakładki
  const [playback, setPlayback] = useState<Playback | null>(null);
  const [balancesRefreshing, setBalancesRefreshing] = useState(false);
  const [ready, setReady] = useState(false);
  const pollingRef = useRef<Set<string>>(new Set());
  // Najświeższy album dla pętli sekwencyjnej działającej poza cyklem renderów
  const albumRef = useRef<Album | null>(null);
  const libraryRef = useRef<LibraryDoc[]>([]);
  const settingsRef = useRef<Settings>(DEFAULT_SETTINGS);
  const tracksRef = useRef<Track[]>([]);
  tracksRef.current = tracks;
  albumRef.current = album;
  libraryRef.current = library;
  settingsRef.current = settings;

  // Aktualizacje z pollingu muszą trafiać na świeży stan, stąd forma funkcyjna + zapis
  function updateTrack(id: string, patch: Partial<Track>) {
    setTracks((prev) => {
      const next = prev.map((t) => (t.id === id ? { ...t, ...patch } : t));
      void saveTracks(next);
      return next;
    });
  }

  async function refreshBalances() {
    setBalancesRefreshing(true);
    try {
      setBalances(await fetchBalances(settingsRef.current));
    } finally {
      setBalancesRefreshing(false);
    }
  }

  function startPolling(track: Track, sunoKey: string) {
    if (pollingRef.current.has(track.id)) return;
    pollingRef.current.add(track.id);
    void pollTask(sunoKey, track.taskId, (update) => {
      updateTrack(track.id, update);
    }).finally(() => pollingRef.current.delete(track.id));
  }

  useEffect(() => {
    void (async () => {
      const [loadedSettings, loadedTracks, loadedLibrary, loadedPersonas, loadedAlbum] =
        await Promise.all([
          loadSettings(),
          loadTracks(),
          loadLibrary(),
          loadPersonas(),
          loadAlbum(),
        ]);
      setSettings(loadedSettings);
      setTracks(loadedTracks);
      setLibrary(loadedLibrary);
      setPersonas(loadedPersonas);
      // Status "writing" nie może przeżyć restartu — żadna pętla już nie pisze
      if (loadedAlbum?.songs.some((s) => s.status === "writing")) {
        loadedAlbum.songs = loadedAlbum.songs.map((s) =>
          s.status === "writing" ? { ...s, status: "planned" as const } : s
        );
        void saveAlbum(loadedAlbum);
      }
      albumRef.current = loadedAlbum;
      setAlbum(loadedAlbum);
      // Backfill albumIndex z planu albumu (utwory wysłane przed numeracją):
      // AlbumSong.trackId wskazuje utwór, indeks piosenki w planie = numer na płycie
      if (loadedAlbum) {
        let changed = false;
        for (let i = 0; i < loadedAlbum.songs.length; i++) {
          const trackId = loadedAlbum.songs[i].trackId;
          if (!trackId) continue;
          const track = loadedTracks.find(
            (t) => t.id === trackId && t.albumIndex === undefined
          );
          if (track) {
            track.albumIndex = i;
            changed = true;
          }
        }
        if (changed) void saveTracks(loadedTracks);
      }
      setReady(true);
      // Wznów polling zadań przerwanych zamknięciem aplikacji
      for (const track of loadedTracks) {
        if (track.status !== "SUCCESS" && track.status !== "FAILED") {
          startPolling(track, loadedSettings.sunoKey);
        }
      }
      settingsRef.current = loadedSettings;
      void refreshBalances();
      // Backfill audioId/wariantów dla utworów ukończonych przed nowszymi wersjami
      for (const track of loadedTracks) {
        const missingData = !track.audioId || !track.variants;
        if (track.status === "SUCCESS" && missingData && loadedSettings.sunoKey) {
          void getTaskStatus(loadedSettings.sunoKey, track.taskId)
            .then((u) => {
              if (u.variants || u.audioId) {
                updateTrack(track.id, { variants: u.variants, audioId: u.audioId });
              }
            })
            .catch(() => {});
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleGenerateMusic(
    draft: SongDraft,
    sunoModel: SunoModel,
    provider: Provider,
    instrumental: boolean,
    persona?: { id: string; model: PersonaModel; name: string },
    albumTitle?: string,
    albumIndex?: number
  ): Promise<string> {
    const taskId = await createTask(
      settings.sunoKey,
      draft,
      sunoModel,
      instrumental,
      persona
    );
    const track: Track = {
      personaUsed: persona?.name,
      album: albumTitle,
      albumIndex,
      id: crypto.randomUUID(),
      taskId,
      title: draft.title,
      style: draft.style,
      lyrics: draft.lyrics,
      sunoModel,
      provider,
      instrumental,
      status: "PENDING",
      createdAt: new Date().toISOString(),
    };
    setTracks((prev) => {
      const next = [track, ...prev];
      void saveTracks(next);
      return next;
    });
    startPolling(track, settings.sunoKey);
    void refreshBalances(); // generacja zjada kredyty Suno
    return track.id;
  }

  function handleAlbumChange(next: Album | null) {
    albumRef.current = next;
    setAlbum(next);
    void saveAlbum(next);
  }

  function patchAlbumSong(index: number, patch: Partial<Album["songs"][number]>) {
    const current = albumRef.current;
    if (!current) return;
    handleAlbumChange({
      ...current,
      songs: current.songs.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    });
  }

  // Sekwencyjne pisanie tekstów albumu żyje na poziomie App (nie widoku),
  // żeby przełączanie zakładek nie przerywało pętli.
  // Guard na ref (synchroniczny) — stan Reacta aktualizuje się dopiero przy
  // renderze, więc sam nie chroni przed drugą równoległą pętlą.
  const albumWritingRef = useRef(false);

  async function handleWriteAlbumLyrics(
    provider: Provider,
    sunoModel: SunoModel,
    useLibrary: boolean
  ) {
    if (albumWritingRef.current || !albumRef.current) return;
    albumWritingRef.current = true;
    setAlbumWriting(true);
    try {
      const total = albumRef.current.songs.length;
      for (let i = 0; i < total; i++) {
        const current = albumRef.current;
        if (!current) return; // album usunięty w trakcie
        const song = current.songs[i];
        // "writing" też pomijamy — to piosenka w rękach innej (starszej) pętli
        if (
          !song ||
          song.status === "written" ||
          song.status === "sent" ||
          song.status === "writing"
        )
          continue;
        patchAlbumSong(i, { status: "writing", error: undefined });
        const lib = libraryRef.current;
        const contentDocs = lib.filter((d) => d.kind !== "guide");
        const guideDocs = lib.filter((d) => d.kind === "guide");
        const songBrief =
          `${song.plan.brief}\nWspólny kierunek albumu: ${current.styleDirection}` +
          `\nWskazówki stylu tego utworu: ${song.plan.styleHints}` +
          `\nProponowany tytuł: ${song.plan.title}`;
        try {
          const context =
            useLibrary && contentDocs.length > 0
              ? buildContext(retrieveChunks(contentDocs, song.plan.brief))
              : "";
          const guides =
            useLibrary && guideDocs.length > 0
              ? buildContext(
                  retrieveChunks(
                    guideDocs,
                    `${song.plan.brief} styl gatunek tagi suno struktura piosenki style tags vocal ambience intro outro chorus verse bridge instrumental meta tags`,
                    6
                  )
                )
              : "";
          const draft = await generateSong(
            provider,
            settingsRef.current,
            context,
            guides,
            songBrief,
            sunoModel
          );
          patchAlbumSong(i, { status: "written", draft });
        } catch (e) {
          patchAlbumSong(i, {
            status: "error",
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    } finally {
      albumWritingRef.current = false;
      setAlbumWriting(false);
    }
  }

  async function handleSaveSettings(next: Settings) {
    settingsRef.current = next;
    setSettings(next);
    await saveSettings(next);
    void refreshBalances(); // klucze mogły się zmienić
  }

  // Okresowe odświeżanie sald (10 min)
  useEffect(() => {
    if (!ready) return;
    const id = setInterval(() => void refreshBalances(), 10 * 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  function handleLibraryChange(docs: LibraryDoc[]) {
    setLibrary(docs);
    void saveLibrary(docs);
  }

  async function handleCreatePersona(
    track: Track,
    audioId: string,
    name: string,
    description: string
  ) {
    const personaId = await createPersona(settings.sunoKey, {
      taskId: track.taskId,
      audioId,
      name,
      description,
    });
    const persona: Persona = {
      id: personaId,
      name,
      description,
      sourceTrackTitle: track.title,
      createdAt: new Date().toISOString(),
    };
    setPersonas((prev) => {
      const next = [persona, ...prev];
      void savePersonas(next);
      return next;
    });
  }

  /** Wysyła nieudaną generację do Suno jeszcze raz — nowe zadanie, ten sam wpis. */
  async function handleRetryTrack(id: string) {
    const track = tracksRef.current.find((t) => t.id === id);
    if (!track) throw new Error("Nie znaleziono utworu");
    if (track.status !== "FAILED") throw new Error("Ponowić można tylko nieudaną generację");
    const taskId = await createTask(
      settingsRef.current.sunoKey,
      { title: track.title, style: track.style, lyrics: track.lyrics },
      track.sunoModel,
      track.instrumental
    );
    // czyścimy media i błąd po nieudanej próbie — wpis startuje od zera
    updateTrack(id, {
      taskId,
      status: "PENDING",
      error: undefined,
      variants: undefined,
      audioId: undefined,
      audioUrl: undefined,
      streamAudioUrl: undefined,
      imageUrl: undefined,
      duration: undefined,
      wavUrl: undefined,
      createdAt: new Date().toISOString(),
    });
    startPolling({ ...track, taskId }, settingsRef.current.sunoKey);
    void refreshBalances(); // ponowna generacja zjada kredyty Suno
  }

  async function handleGenerateCover(id: string) {
    const track = tracksRef.current.find((t) => t.id === id);
    if (!track) throw new Error("Nie znaleziono utworu");
    const path = await generateTrackCover(settingsRef.current.openaiKey, track);
    updateTrack(id, { aiImagePath: path, coverSource: "ai" });
  }

  /** Dogenerowuje brakujące okładki AI albumu — osobną dla każdego utworu. */
  async function handleGenerateAlbumCovers(
    album: string,
    onProgress: (done: number, total: number) => void
  ) {
    const list = tracksRef.current.filter(
      (t) => t.album === album && t.status === "SUCCESS" && !t.aiImagePath
    );
    if (list.length === 0) {
      throw new Error("Wszystkie utwory albumu mają już okładkę AI");
    }
    const errors: string[] = [];
    for (let i = 0; i < list.length; i++) {
      onProgress(i, list.length);
      try {
        const path = await generateTrackCover(settingsRef.current.openaiKey, list[i]);
        updateTrack(list[i].id, { aiImagePath: path, coverSource: "ai" });
      } catch (e) {
        errors.push(`${list[i].title}: ${e instanceof Error ? e.message : e}`);
      }
    }
    onProgress(list.length, list.length);
    if (errors.length > 0) throw new Error(`Błędy: ${errors.join("; ")}`);
  }

  function handleSetCoverSource(ids: string[], source: "suno" | "ai") {
    setTracks((prev) => {
      const next = prev.map((t) => (ids.includes(t.id) ? { ...t, coverSource: source } : t));
      void saveTracks(next);
      return next;
    });
  }

  /** Przewija kolejkę; indeks poza zakresem = koniec (albo powrót przy zapętleniu). */
  function seekPlaybackTo(index: number) {
    setPlayback((p) => {
      if (!p) return p;
      if (index < 0) return null;
      if (index >= p.queue.length) return p.repeat ? { ...p, index: 0 } : null;
      return { ...p, index };
    });
  }

  function handleDeleteTrack(id: string) {
    setTracks((prev) => {
      const next = prev.filter((t) => t.id !== id);
      void saveTracks(next);
      return next;
    });
  }

  const pendingCount = tracks.filter(
    (t) => t.status !== "SUCCESS" && t.status !== "FAILED"
  ).length;

  if (!ready) return <div className="app-loading">Wczytywanie...</div>;

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
          <h1><Headphones size={18} /> Suno Studio</h1>
          {settings.showBalances && (
            <BalanceBar
              balances={balances}
              refreshing={balancesRefreshing}
              onRefresh={() => void refreshBalances()}
            />
          )}
        </div>
        <nav>
          <button className={view === "create" ? "active" : ""} onClick={() => setView("create")}>
            Twórz
          </button>
          <button className={view === "album" ? "active" : ""} onClick={() => setView("album")}>
            Album
          </button>
          <button className={view === "files" ? "active" : ""} onClick={() => setView("files")}>
            Pliki{library.length > 0 ? ` (${library.length})` : ""}
          </button>
          <button className={view === "library" ? "active" : ""} onClick={() => setView("library")}>
            Biblioteka{pendingCount > 0 ? ` (${pendingCount})` : ""}
          </button>
          <button className={view === "player" ? "active" : ""} onClick={() => setView("player")}>
            Odtwarzacz{playback ? " ♪" : ""}
          </button>
          <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}>
            Ustawienia
          </button>
        </nav>
      </header>
      <main>
        {/* Widoki są zawsze zamontowane, nieaktywne tylko ukryte — dzięki temu
            przełączanie zakładek nie przerywa odtwarzania ani trwających generacji. */}
        <div className={view === "create" ? "" : "hidden"}>
          <CreateView
            settings={settings}
            library={library}
            personas={personas}
            onGenerateMusic={handleGenerateMusic}
          />
        </div>
        <div className={view === "album" ? "" : "hidden"}>
          <AlbumView
            settings={settings}
            library={library}
            personas={personas}
            album={album}
            writing={albumWriting}
            onWriteLyrics={handleWriteAlbumLyrics}
            onAlbumChange={handleAlbumChange}
            onPatchSong={patchAlbumSong}
            onGenerateMusic={handleGenerateMusic}
          />
        </div>
        <div className={view === "files" ? "" : "hidden"}>
          <FilesView library={library} onChange={handleLibraryChange} />
        </div>
        <div className={view === "library" ? "" : "hidden"}>
          <LibraryView
            tracks={tracks}
            sunoKey={settings.sunoKey}
            defaultSaveDir={settings.defaultSaveDir}
            playback={playback}
            onPlay={(p) => {
              setPlayback(p);
              setView("player");
            }}
            onAddToQueue={(item) =>
              setPlayback((p) =>
                p
                  ? { ...p, queue: [...p.queue, item] }
                  : { name: "Kolejka", queue: [item], index: 0, repeat: false }
              )
            }
            onStopPlayback={() => setPlayback(null)}
            onDelete={handleDeleteTrack}
            onRetry={handleRetryTrack}
            onCreatePersona={handleCreatePersona}
            onUpdateTrack={updateTrack}
            onGenerateCover={handleGenerateCover}
            onGenerateAlbumCovers={handleGenerateAlbumCovers}
            onSetCoverSource={handleSetCoverSource}
          />
        </div>
        <div className={view === "player" ? "" : "hidden"}>
          <PlayerView
            playback={playback}
            onSeekTo={seekPlaybackTo}
            onStop={() => setPlayback(null)}
            onChange={setPlayback}
          />
        </div>
        <div className={view === "settings" ? "" : "hidden"}>
          <SettingsView settings={settings} onSave={handleSaveSettings} />
        </div>
      </main>
    </div>
  );
}
