import { ReactNode, useEffect, useState } from "react";
import {
  Disc3,
  FolderOpen,
  Headphones,
  ListMusic,
  LogOut,
  Settings as SettingsIcon,
  Sparkles,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { PersonaModel, Playback, Provider, SongDraft, SunoModel } from "@suno/core";
import BalanceBar from "../components/BalanceBar";
import type { StudioBackend } from "../data/types";
import AlbumView from "../views/AlbumView";
import CreateView from "../views/CreateView";
import FilesView from "../views/FilesView";
import LibraryView from "../views/library/LibraryView";
import PlayerView from "../views/PlayerView";
import SettingsView from "../views/SettingsView";
import { pathToView, View, VIEW_PATHS } from "./navigation";
import { useBalances } from "./useBalances";

interface Props {
  /** Źródło danych: Convex (web) albo lokalny silnik (desktop) */
  backend: StudioBackend;
  /** Dodatkowe sekcje Ustawień zależne od wersji (konto / dane lokalne) */
  settingsExtras?: ReactNode;
  /** Web: wylogowanie; desktop nie ma konta */
  onSignOut?: () => void;
}

export default function Studio({ backend, settingsExtras, onSignOut }: Props) {
  const { data, actions } = backend;
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

  function seekPlaybackTo(index: number) {
    setPlayback((p) => {
      if (!p) return p;
      if (index < 0) return null;
      if (index >= p.queue.length) return p.repeat ? { ...p, index: 0 } : null;
      return { ...p, index };
    });
  }

  const ready = data !== undefined;
  const {
    balances,
    refreshing: balancesRefreshing,
    refresh: refreshBalances,
  } = useBalances(actions.fetchBalances, ready);

  if (!data) return <div className="app-loading">Wczytywanie...</div>;
  const { settings, tracks, library, personas, album } = data;

  async function generateMusic(
    draft: SongDraft,
    sunoModel: SunoModel,
    provider: Provider,
    instrumental: boolean,
    persona?: { id: string; model: PersonaModel; name: string },
    albumTitle?: string,
    albumIndex?: number
  ): Promise<string> {
    const trackId = await actions.startGeneration({
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

  const albumWriting = album?.songs.some((s) => s.status === "writing") ?? false;
  const pendingCount = tracks.filter((t) => t.status !== "SUCCESS" && t.status !== "FAILED").length;

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
    { id: "files", label: "Pliki", Icon: FolderOpen, count: library.length },
    { id: "library", label: "Biblioteka", Icon: ListMusic, count: pendingCount },
    { id: "player", label: "Odtwarzacz", Icon: Headphones, dot: playback !== null },
    { id: "settings", label: "Ustawienia", Icon: SettingsIcon },
  ];

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
          <h1>
            <Headphones size={18} /> Suno Studio
          </h1>
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
          {onSignOut && (
            <button className="btn-icon" title="Wyloguj" onClick={onSignOut}>
              <LogOut size={16} />
            </button>
          )}
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
            onWriteLyrics={actions.writeSong}
            onGenerateMusic={generateMusic}
          />
        </div>
        <div className={view === "album" ? "" : "hidden"}>
          <AlbumView
            settings={settings}
            library={library}
            personas={personas}
            album={album}
            writing={albumWriting}
            onPlan={actions.planAlbum}
            onWriteLyrics={(provider, sunoModel, useLibrary, excludedIds) =>
              // błąd pojedynczej piosenki zapisuje się w jej statusie; całość nie przerywa UI
              actions
                .writeAlbumLyrics({ provider, sunoModel, useLibrary, excludedIds })
                .catch(() => {})
            }
            onAlbumChange={(next) => void actions.setAlbum(next)}
            onPatchSong={(index, patch) => void actions.patchAlbumSong(index, patch)}
            onGenerateMusic={generateMusic}
          />
        </div>
        <div className={view === "files" ? "" : "hidden"}>
          <FilesView
            library={library}
            onAdd={(docs) => void actions.addLibraryDocs(docs)}
            onToggleKind={(id) => {
              const doc = library.find((d) => d.id === id);
              if (doc) void actions.setDocKind(id, doc.kind === "guide" ? "content" : "guide");
            }}
            onRemove={(id) => void actions.removeLibraryDoc(id)}
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
            tracks={tracks}
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
            onDelete={(id) => void actions.removeTrack(id)}
            onRetry={async (id) => {
              await actions.retryGeneration(id);
              void refreshBalances(); // ponowna generacja zjada kredyty Suno
            }}
            onRegenerate={async (id) => {
              await actions.regenerateExpired(id);
              void refreshBalances(); // przegenerowanie zjada kredyty Suno
            }}
            onCreatePersona={(track, audioId, name, description) =>
              actions.createPersona(track.id, audioId, name, description)
            }
            onConvertToWav={actions.convertToWav}
            onGenerateCover={actions.generateCover}
            onGenerateAlbumCovers={actions.generateAlbumCovers}
            onResetCovers={actions.resetCovers}
            onSetCoverSource={actions.setCoverSource}
          />
        </div>
        <div className={view === "settings" ? "" : "hidden"}>
          <SettingsView
            settings={settings}
            onSave={async (next) => {
              await actions.saveSettings(next);
              void refreshBalances(); // klucze mogły się zmienić
            }}
            onCheckCredits={actions.getCredits}
            extras={settingsExtras}
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
