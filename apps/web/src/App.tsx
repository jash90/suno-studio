import { FormEvent, useEffect, useRef, useState } from "react";
import {
  Disc3,
  FolderOpen,
  Headphones,
  ListMusic,
  LogOut,
  Settings as SettingsIcon,
  Sparkles,
} from "lucide-react";
import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useAction,
  useMutation,
  useQuery,
} from "convex/react";
import { useAuthActions, useAuthToken } from "@convex-dev/auth/react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "@suno/backend/api";
import platform from "@platform";
import BalanceBar from "./components/BalanceBar";
import AlbumView from "./views/AlbumView";
import CreateView from "./views/CreateView";
import FilesView from "./views/FilesView";
import LibraryView from "./views/library/LibraryView";
import PlayerView from "./views/PlayerView";
import SettingsView from "./views/SettingsView";
import {
  Album,
  AlbumConcept,
  AlbumSong,
  Balances,
  DEFAULT_SETTINGS,
  LibraryDoc,
  PersonaModel,
  Playback,
  Provider,
  Settings,
  SongDraft,
  SunoModel,
} from "@suno/core";

type View = "create" | "album" | "files" | "library" | "player" | "settings";

const VIEW_PATHS: Record<View, string> = {
  create: "/tworz",
  album: "/album",
  files: "/pliki",
  library: "/biblioteka",
  player: "/odtwarzacz",
  settings: "/ustawienia",
};

function pathToView(pathname: string): View | null {
  const hit = (Object.entries(VIEW_PATHS) as [View, string][]).find(
    ([, path]) => path === pathname
  );
  return hit ? hit[0] : null;
}

/** Trzyma ostatnią znaną wartość kwerendy. Przy reconnect'cie Convexa (deploy
 *  funkcji, odświeżenie tokenu, zanik sieci) useQuery chwilowo zwraca undefined —
 *  bez latcha cały interfejs przeskakiwał na „Wczytywanie..." i montował się od
 *  nowa (wszystko "skakało"). Z latchem pełny ekran ładowania jest tylko raz. */
function useLatest<T>(value: T | undefined): T | undefined {
  const ref = useRef<T | undefined>(undefined);
  if (value !== undefined) ref.current = value;
  return ref.current;
}

function SignIn() {
  const { signIn } = useAuthActions();
  const [flow, setFlow] = useState<"signIn" | "signUp">("signIn");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const formData = new FormData(event.currentTarget);
    formData.set("flow", flow);
    void signIn("password", formData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  }

  return (
    <div className="app-loading">
      <form className="signin" onSubmit={submit}>
        <h1><Headphones size={20} /> Suno Studio</h1>
        <p className="hint">
          {flow === "signIn" ? "Zaloguj się" : "Załóż konto"} — dane i klucze API
          zapisują się na Twoim koncie.
        </p>
        <input name="email" type="email" placeholder="E-mail" required autoComplete="email" />
        <input
          name="password"
          type="password"
          placeholder="Hasło"
          required
          autoComplete={flow === "signIn" ? "current-password" : "new-password"}
        />
        <button className="btn-primary" type="submit" disabled={busy}>
          {busy ? "..." : flow === "signIn" ? "Zaloguj" : "Zarejestruj"}
        </button>
        <button
          type="button"
          className="btn-link"
          onClick={() => setFlow(flow === "signIn" ? "signUp" : "signIn")}
        >
          {flow === "signIn" ? "Nie masz konta? Zarejestruj się" : "Masz konto? Zaloguj się"}
        </button>
        {error && <p className="error">{error}</p>}
      </form>
    </div>
  );
}

function Studio() {
  const { signOut } = useAuthActions();
  // Proxy /download (web) wymaga tokenu — przekazujemy aktualny do warstwy platformy
  const authToken = useAuthToken();
  useEffect(() => platform.setAuthToken(authToken ?? null), [authToken]);
  // Widok wynika z URL-a; złe/nieznane ścieżki normalizujemy efektem (nie
  // <Navigate>), żeby ani na jeden render nie odmontować zawsze-żywych widoków.
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const view: View = pathToView(pathname) ?? "create";
  useEffect(() => {
    if (pathToView(pathname) === null) navigate(VIEW_PATHS.create, { replace: true });
  }, [pathname, navigate]);
  // odtwarzanie albumu — na poziomie Studio, żeby grało niezależnie od zakładki
  const [playback, setPlayback] = useState<Playback | null>(null);
  const [balances, setBalances] = useState<Balances>({});

  function seekPlaybackTo(index: number) {
    setPlayback((p) => {
      if (!p) return p;
      if (index < 0) return null;
      if (index >= p.queue.length) return p.repeat ? { ...p, index: 0 } : null;
      return { ...p, index };
    });
  }
  const [balancesRefreshing, setBalancesRefreshing] = useState(false);

  const settingsData = useLatest(useQuery(api.settings.get));
  const tracks = useLatest(useQuery(api.tracks.list));
  const library = useLatest(useQuery(api.library.list));
  const personas = useLatest(useQuery(api.personas.list));
  const album = useLatest(useQuery(api.album.get));

  const saveSettingsM = useMutation(api.settings.save);
  const removeTrackM = useMutation(api.tracks.remove);
  const patchTrackM = useMutation(api.tracks.patch);
  const addLibraryM = useMutation(api.library.add);
  const setKindM = useMutation(api.library.setKind);
  const removeLibraryM = useMutation(api.library.remove);
  const setAlbumM = useMutation(api.album.set);
  const patchSongM = useMutation(api.album.patchSong);

  const writeSongA = useAction(api.generate.generateSongAction);
  const startGenA = useAction(api.suno.startGeneration);
  const retryGenA = useAction(api.suno.retryGeneration);
  const regenerateA = useAction(api.suno.regenerateExpired);
  const convertWavA = useAction(api.suno.convertToWav);
  const genCoverA = useAction(api.cover.generateTrackCover);
  const genAlbumCoversM = useMutation(api.cover.generateAlbumCovers);
  const resetCoversM = useMutation(api.cover.reset);
  const createPersonaA = useAction(api.suno.createPersona);
  const getCreditsA = useAction(api.suno.getCredits);
  const planAlbumA = useAction(api.album.plan);
  const writeAlbumA = useAction(api.album.writeLyrics);
  const balancesA = useAction(api.balances.fetch_);

  const settings: Settings = { ...DEFAULT_SETTINGS, ...(settingsData ?? {}) };
  const ready =
    settingsData !== undefined &&
    tracks !== undefined &&
    library !== undefined &&
    personas !== undefined &&
    album !== undefined;

  async function refreshBalances() {
    setBalancesRefreshing(true);
    try {
      setBalances(await balancesA({}));
    } finally {
      setBalancesRefreshing(false);
    }
  }

  // Odśwież salda po załadowaniu i cyklicznie co 10 min
  useEffect(() => {
    if (!ready) return;
    void refreshBalances();
    const id = setInterval(() => void refreshBalances(), 10 * 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  async function handleWriteLyrics(params: {
    brief: string;
    useLibrary: boolean;
    excludedIds: string[];
    provider: Provider;
    sunoModel: SunoModel;
  }): Promise<{ draft: SongDraft; usedSources: string | null }> {
    return writeSongA(params);
  }

  async function handleGenerateMusic(
    draft: SongDraft,
    sunoModel: SunoModel,
    provider: Provider,
    instrumental: boolean,
    persona?: { id: string; model: PersonaModel; name: string },
    albumTitle?: string,
    albumIndex?: number
  ): Promise<string> {
    const trackId = await startGenA({
      draft,
      sunoModel,
      provider,
      instrumental,
      persona,
      albumTitle,
      albumIndex,
    });
    void refreshBalances(); // generacja zjada kredyty Suno
    return trackId;
  }

  async function handlePlanAlbum(params: {
    brief: string;
    songCount: number;
    provider: Provider;
    useLibrary: boolean;
    excludedIds: string[];
  }): Promise<AlbumConcept> {
    return planAlbumA(params);
  }

  async function handleWriteAlbumLyrics(
    provider: Provider,
    sunoModel: SunoModel,
    useLibrary: boolean,
    excludedIds: string[]
  ): Promise<void> {
    try {
      await writeAlbumA({ provider, sunoModel, useLibrary, excludedIds });
    } catch {
      // błąd pojedynczej piosenki zapisuje się w jej statusie; całość nie przerywa UI
    }
  }

  function handleAlbumChange(next: Album | null) {
    void setAlbumM({ album: next });
  }

  function patchAlbumSong(index: number, patch: Partial<AlbumSong>) {
    void patchSongM({ index, patch });
  }

  async function handleSaveSettings(next: Settings) {
    await saveSettingsM({ settings: next });
    void refreshBalances(); // klucze mogły się zmienić
  }

  function handleLibraryAdd(docs: LibraryDoc[]) {
    for (const doc of docs) void addLibraryM({ doc });
  }

  function handleToggleKind(id: string) {
    const doc = (library ?? []).find((d) => d.id === id);
    if (!doc) return;
    void setKindM({ domainId: id, kind: doc.kind === "guide" ? "content" : "guide" });
  }

  async function handleCreatePersona(
    track: { id: string },
    audioId: string,
    name: string,
    description: string
  ) {
    await createPersonaA({ domainId: track.id, audioId, name, description });
  }

  const albumWriting = album?.songs.some((s) => s.status === "writing") ?? false;
  const pendingCount = (tracks ?? []).filter(
    (t) => t.status !== "SUCCESS" && t.status !== "FAILED"
  ).length;

  if (!ready) return <div className="app-loading">Wczytywanie...</div>;

  // Jedno źródło zakładek dla górnego paska (desktop) i dolnego (mobile)
  const tabs: {
    id: View;
    label: string;
    Icon: typeof Headphones;
    count?: number;
    dot?: boolean;
  }[] = [
    { id: "create", label: "Twórz", Icon: Sparkles },
    { id: "album", label: "Album", Icon: Disc3 },
    { id: "files", label: "Pliki", Icon: FolderOpen, count: library!.length },
    { id: "library", label: "Biblioteka", Icon: ListMusic, count: pendingCount },
    { id: "player", label: "Odtwarzacz", Icon: Headphones, dot: playback !== null },
    { id: "settings", label: "Ustawienia", Icon: SettingsIcon },
  ];

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
          {tabs.map(({ id, label, count, dot }) => (
            <button
              key={id}
              className={view === id ? "active" : ""}
              onClick={() => navigate(VIEW_PATHS[id])}
            >
              {label}
              {count ? ` (${count})` : ""}
              {dot ? " ♪" : ""}
            </button>
          ))}
          <button className="btn-icon" title="Wyloguj" onClick={() => void signOut()}>
            <LogOut size={16} />
          </button>
        </nav>
      </header>
      <main>
        {/* Widoki są zawsze zamontowane, nieaktywne tylko ukryte — dzięki temu
            przełączanie zakładek nie przerywa odtwarzania ani trwających generacji. */}
        <div className={view === "create" ? "" : "hidden"}>
          <CreateView
            settings={settings}
            library={library!}
            personas={personas!}
            onWriteLyrics={handleWriteLyrics}
            onGenerateMusic={handleGenerateMusic}
          />
        </div>
        <div className={view === "album" ? "" : "hidden"}>
          <AlbumView
            settings={settings}
            library={library!}
            personas={personas!}
            album={album!}
            writing={albumWriting}
            onPlan={handlePlanAlbum}
            onWriteLyrics={handleWriteAlbumLyrics}
            onAlbumChange={handleAlbumChange}
            onPatchSong={patchAlbumSong}
            onGenerateMusic={handleGenerateMusic}
          />
        </div>
        <div className={view === "files" ? "" : "hidden"}>
          <FilesView
            library={library!}
            onAdd={handleLibraryAdd}
            onToggleKind={handleToggleKind}
            onRemove={(id) => void removeLibraryM({ domainId: id })}
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
        <div className={view === "library" ? "" : "hidden"}>
          <LibraryView
            tracks={tracks!}
            playback={playback}
            onPlay={(p) => {
              setPlayback(p);
              navigate(VIEW_PATHS.player);
            }}
            onAddToQueue={(item) =>
              setPlayback((p) =>
                p
                  ? { ...p, queue: [...p.queue, item] }
                  : { name: "Kolejka", queue: [item], index: 0, repeat: false }
              )
            }
            onStopPlayback={() => setPlayback(null)}
            onDelete={(id) => void removeTrackM({ domainId: id })}
            onRetry={async (id) => {
              await retryGenA({ domainId: id });
              void refreshBalances(); // ponowna generacja zjada kredyty Suno
            }}
            onRegenerate={async (id) => {
              await regenerateA({ domainId: id });
              void refreshBalances(); // przegenerowanie zjada kredyty Suno
            }}
            onCreatePersona={handleCreatePersona}
            onConvertToWav={(domainId, audioId) => convertWavA({ domainId, audioId })}
            onGenerateCover={async (id) => {
              await genCoverA({ domainId: id });
            }}
            onGenerateAlbumCovers={(name) => genAlbumCoversM({ album: name })}
            onResetCovers={(ids) => resetCoversM({ domainIds: ids })}
            onSetCoverSource={async (ids, source) => {
              for (const id of ids) {
                await patchTrackM({ domainId: id, patch: { coverSource: source } });
              }
            }}
          />
        </div>
        <div className={view === "settings" ? "" : "hidden"}>
          <SettingsView
            settings={settings}
            onSave={handleSaveSettings}
            onCheckCredits={(sunoKey) => getCreditsA({ sunoKey })}
          />
        </div>
      </main>
      {/* Dolny pasek zakładek — widoczny tylko na mobile (CSS) */}
      <nav className="bottom-nav">
        {tabs.map(({ id, label, Icon, count, dot }) => (
          <button
            key={id}
            className={view === id ? "active" : ""}
            onClick={() => navigate(VIEW_PATHS[id])}
          >
            <span className="bottom-nav-icon">
              <Icon size={20} />
              {count ? <span className="bottom-nav-badge">{count}</span> : null}
              {dot ? <span className="bottom-nav-dot" /> : null}
            </span>
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}

export default function App() {
  return (
    <>
      <AuthLoading>
        <div className="app-loading">Wczytywanie...</div>
      </AuthLoading>
      <Unauthenticated>
        <SignIn />
      </Unauthenticated>
      <Authenticated>
        <Studio />
      </Authenticated>
    </>
  );
}
