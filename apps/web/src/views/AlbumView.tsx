import { useState } from "react";
import { Disc3, Loader2, Music, PenLine, RotateCcw, Trash2 } from "lucide-react";
import DocPicker from "../components/DocPicker";
import platform from "@platform";
import SongEditor, { validateDraft } from "../components/SongEditor";
import {
  Album,
  AlbumConcept,
  AlbumSong,
  LibraryDoc,
  Persona,
  PersonaModel,
  Provider,
  Settings,
  SongDraft,
  SunoModel,
} from "@suno/core";

const SUNO_MODELS: SunoModel[] = ["V4", "V4_5", "V4_5PLUS", "V4_5ALL", "V5", "V5_5"];

const SONG_STATUS_LABELS: Record<AlbumSong["status"], string> = {
  planned: "zaplanowana",
  writing: "AI pisze...",
  written: "tekst gotowy",
  error: "błąd",
  sent: "wysłana do Suno",
};

interface Props {
  settings: Settings;
  library: LibraryDoc[];
  personas: Persona[];
  album: Album | null;
  writing: boolean;
  onPlan: (params: {
    brief: string;
    songCount: number;
    provider: Provider;
    useLibrary: boolean;
    excludedIds: string[];
  }) => Promise<AlbumConcept>;
  onWriteLyrics: (
    provider: Provider,
    sunoModel: SunoModel,
    useLibrary: boolean,
    excludedIds: string[]
  ) => Promise<void>;
  onAlbumChange: (album: Album | null) => void;
  onPatchSong: (index: number, patch: Partial<AlbumSong>) => void;
  onGenerateMusic: (
    draft: SongDraft,
    sunoModel: SunoModel,
    provider: Provider,
    instrumental: boolean,
    persona: { id: string; model: PersonaModel; name: string } | undefined,
    albumTitle: string,
    albumIndex: number
  ) => Promise<string>;
}

export default function AlbumView({
  settings,
  library,
  personas,
  album,
  writing,
  onPlan,
  onWriteLyrics,
  onAlbumChange,
  onPatchSong,
  onGenerateMusic,
}: Props) {
  const [brief, setBrief] = useState(album?.brief ?? "");
  const [songCount, setSongCount] = useState(6);
  const [useLibrary, setUseLibrary] = useState(true);
  // Zbiór ODZNACZONYCH plików — nowe pliki są domyślnie zaznaczone
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());
  const [provider, setProvider] = useState<Provider>(settings.provider);
  const [sunoModel, setSunoModel] = useState<SunoModel>(settings.sunoModel);
  const [personaId, setPersonaId] = useState("");
  const [personaModel, setPersonaModel] = useState<PersonaModel>("voice_persona");
  const [planning, setPlanning] = useState(false);
  const [sendingAll, setSendingAll] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function planAlbum() {
    setError(null);
    setInfo(null);
    if (!brief.trim()) {
      setError("Opisz album w briefie — to podstawa całego planu");
      return;
    }
    if (album && !(await platform.confirm("Masz już aktywny album — zastąpić go nowym planem?")))
      return;
    setPlanning(true);
    try {
      const concept = await onPlan({
        brief,
        songCount,
        provider,
        useLibrary,
        excludedIds: [...excludedIds],
      });
      onAlbumChange({
        id: crypto.randomUUID(),
        title: concept.albumTitle,
        styleDirection: concept.styleDirection,
        brief,
        songs: concept.songs.map((plan) => ({ plan, status: "planned" as const })),
        createdAt: new Date().toISOString(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPlanning(false);
    }
  }

  function writeLyricsSequentially() {
    setError(null);
    void onWriteLyrics(provider, sunoModel, useLibrary, [...excludedIds]);
  }

  /** Wysyła jedną piosenkę do Suno; song przekazany jawnie (snapshot z chwili kliknięcia). */
  async function sendSong(index: number, song: AlbumSong, albumTitle: string) {
    if (!song.draft) return;
    setError(null);
    const invalid = validateDraft(song.draft, sunoModel);
    if (invalid) {
      setError(`„${song.draft.title}”: ${invalid}`);
      return;
    }
    if (!settings.sunoKey) {
      setError("Brak klucza sunoapi.org — uzupełnij w Ustawieniach");
      return;
    }
    const persona = personas.find((p) => p.id === personaId);
    const trackId = await onGenerateMusic(
      song.draft,
      sunoModel,
      provider,
      false,
      persona ? { id: persona.id, model: personaModel, name: persona.name } : undefined,
      albumTitle,
      index
    );
    onPatchSong(index, { status: "sent", trackId });
  }

  async function sendAll() {
    if (!album) return;
    setSendingAll(true);
    setError(null);
    try {
      const snapshot = album.songs;
      for (let i = 0; i < snapshot.length; i++) {
        if (snapshot[i].status !== "written") continue;
        await sendSong(i, snapshot[i], album.title);
      }
      setInfo("Utwory wysłane do Suno — postęp w zakładce Biblioteka");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSendingAll(false);
    }
  }

  const writtenCount = album?.songs.filter((s) => s.status === "written").length ?? 0;
  const doneCount =
    album?.songs.filter((s) => s.status === "written" || s.status === "sent").length ?? 0;
  const writingIndex = album?.songs.findIndex((s) => s.status === "writing") ?? -1;

  return (
    <div className="view">
      <h2>1. Koncepcja albumu</h2>
      <textarea
        rows={3}
        placeholder="Opisz album: temat, klimat, język, historia którą ma opowiadać... Np. koncept-album o mitologii słowiańskiej, od świtu do nocy, mroczny folk."
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
      />
      <div className="controls-row">
        <label>
          Liczba utworów
          <select value={songCount} onChange={(e) => setSongCount(Number(e.target.value))}>
            {[3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          AI
          <select value={provider} onChange={(e) => setProvider(e.target.value as Provider)}>
            <option value="anthropic">Anthropic ({settings.anthropicModel})</option>
            <option value="openai">OpenAI ({settings.openaiModel})</option>
          </select>
        </label>
        <label>
          Model Suno
          <select value={sunoModel} onChange={(e) => setSunoModel(e.target.value as SunoModel)}>
            {SUNO_MODELS.map((m) => (
              <option key={m} value={m}>
                {m.replace(/_/g, ".")}
              </option>
            ))}
          </select>
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={useLibrary}
            onChange={(e) => setUseLibrary(e.target.checked)}
            disabled={library.length === 0}
          />
          {library.length > 0
            ? "Użyj biblioteki plików"
            : "Biblioteka plików jest pusta — dodaj pliki w zakładce „Pliki”"}
        </label>
      </div>

      {useLibrary && library.length > 0 && (
        <DocPicker library={library} excludedIds={excludedIds} onChange={setExcludedIds} />
      )}

      {personas.length > 0 && (
        <div className="controls-row">
          <label>
            Persona (spójny wokal całego albumu)
            <select value={personaId} onChange={(e) => setPersonaId(e.target.value)}>
              <option value="">Brak — nowy głos</option>
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {personaId && (
            <label>
              Co przejąć z persony
              <select
                value={personaModel}
                onChange={(e) => setPersonaModel(e.target.value as PersonaModel)}
              >
                <option value="voice_persona">Głos (voice persona)</option>
                <option value="style_persona">Styl (style persona)</option>
              </select>
            </label>
          )}
        </div>
      )}

      <button className="btn-primary" onClick={planAlbum} disabled={planning || writing}>
        {planning ? (
          <>
            <Loader2 size={16} className="spin" /> AI planuje album...
          </>
        ) : (
          <>
            <Disc3 size={16} /> Zaplanuj album
          </>
        )}
      </button>

      {album && (
        <>
          <div className="album-header">
            <div>
              <h2>2. Album: {album.title}</h2>
              <p className="hint">{album.styleDirection}</p>
            </div>
            <button
              className="btn-danger"
              title="Usuń plan albumu"
              onClick={async () => {
                if (
                  await platform.confirm(
                    "Usunąć plan albumu? (utwory wysłane do Suno zostają w Bibliotece)"
                  )
                ) {
                  onAlbumChange(null);
                }
              }}
            >
              <Trash2 size={14} /> Usuń plan
            </button>
          </div>

          <div className="controls-row">
            <button
              className="btn-primary"
              onClick={writeLyricsSequentially}
              disabled={writing || doneCount === album.songs.length}
            >
              {writing ? (
                <>
                  <Loader2 size={16} className="spin" /> Piosenka {writingIndex + 1}/
                  {album.songs.length}...
                </>
              ) : doneCount > 0 && doneCount < album.songs.length ? (
                <>
                  <RotateCcw size={16} /> Wznów pisanie tekstów ({doneCount}/{album.songs.length})
                </>
              ) : (
                <>
                  <PenLine size={16} /> Generuj teksty (po kolei)
                </>
              )}
            </button>
            {writtenCount > 0 && (
              <button className="btn-primary" onClick={sendAll} disabled={sendingAll || writing}>
                {sendingAll ? (
                  <>
                    <Loader2 size={16} className="spin" /> Wysyłanie...
                  </>
                ) : (
                  <>
                    <Music size={16} /> Generuj muzykę dla wszystkich ({writtenCount})
                  </>
                )}
              </button>
            )}
          </div>

          {writing && (
            <div className="progress">
              <div
                className="progress-bar"
                style={{ width: `${(doneCount / album.songs.length) * 100}%` }}
              />
            </div>
          )}

          <ol className="album-songs">
            {album.songs.map((song, i) => (
              <li key={i} className="album-song">
                <div className="album-song-header">
                  <strong>{song.draft?.title ?? song.plan.title}</strong>
                  <span className={`badge badge-song-${song.status}`}>
                    {song.status === "writing" && <Loader2 size={11} className="spin" />}
                    {SONG_STATUS_LABELS[song.status]}
                  </span>
                </div>
                <p className="hint">{song.plan.brief}</p>
                {song.error && <p className="error">{song.error}</p>}
                {song.draft && song.status !== "sent" && (
                  <div className="track-actions">
                    <button onClick={() => setExpanded(expanded === i ? null : i)}>
                      {expanded === i ? "Zwiń edycję" : "Edytuj tekst"}
                    </button>
                    <button
                      onClick={() =>
                        void sendSong(i, song, album.title).catch((e) => setError(String(e)))
                      }
                    >
                      <Music size={14} /> Generuj muzykę
                    </button>
                  </div>
                )}
                {song.draft && expanded === i && (
                  <SongEditor
                    draft={song.draft}
                    sunoModel={sunoModel}
                    onChange={(draft) => onPatchSong(i, { draft })}
                  />
                )}
              </li>
            ))}
          </ol>
        </>
      )}

      {error && <p className="error">{error}</p>}
      {info && <p className="info">{info}</p>}
    </div>
  );
}
