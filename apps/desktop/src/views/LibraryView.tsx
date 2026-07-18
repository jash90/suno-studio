import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Disc3,
  Download,
  FileAudio,
  ImageDown,
  Loader2,
  Play,
  Square,
  UserRound,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import Player from "../components/Player";
import {
  convertToWav,
  downloadImageFile,
  downloadMp3,
  downloadToPath,
  downloadWavFile,
  imageExt,
  sanitizeFileName,
} from "../services/suno";
import { Track, TrackVariant } from "../types";

/** Warianty utworu; starsze wpisy historii mają tylko pola płaskie — sklejamy z nich wariant A. */
function getVariants(track: Track): TrackVariant[] {
  if (track.variants && track.variants.length > 0) return track.variants;
  if (!track.audioId) return [];
  return [
    {
      audioId: track.audioId,
      audioUrl: track.audioUrl,
      streamAudioUrl: track.streamAudioUrl,
      imageUrl: track.imageUrl,
      duration: track.duration,
      wavUrl: track.wavUrl,
    },
  ];
}

const VARIANT_LETTERS = ["A", "B", "C", "D"];

function plural(n: number): string {
  if (n === 1) return "utwór";
  const last = n % 10;
  const tens = n % 100;
  if (last >= 2 && last <= 4 && (tens < 12 || tens > 14)) return "utwory";
  return "utworów";
}

function formatDuration(seconds?: number): string {
  if (!seconds) return "";
  const s = Math.round(seconds);
  return ` ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function PersonaForm({
  track,
  onSubmit,
  onClose,
}: {
  track: Track;
  onSubmit: (name: string, description: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(track.title);
  const [description, setDescription] = useState(track.style);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim() || !description.trim()) {
      setError("Podaj nazwę i opis persony");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(name.trim(), description.trim());
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="persona-form">
      <label>
        Nazwa persony
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Opis (charakterystyka muzyczna — im dokładniej, tym lepiej)
        <textarea
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <div className="track-actions">
        <button className="btn-primary" onClick={submit} disabled={busy}>
          {busy ? "Tworzenie..." : "Utwórz personę"}
        </button>
        <button onClick={onClose} disabled={busy}>Anuluj</button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

const IN_PROGRESS: Track["status"][] = ["PENDING", "TEXT_SUCCESS", "FIRST_SUCCESS"];

// Postęp wg etapów Suno; ETA nieznane, więc pokazujemy etap + czas, jaki upłynął
const STATUS_PROGRESS: Record<string, number> = {
  PENDING: 15,
  TEXT_SUCCESS: 45,
  FIRST_SUCCESS: 75,
};

function formatElapsed(fromIso: string, now: number): string {
  const s = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function TrackProgress({ track, now }: { track: Track; now: number }) {
  return (
    <div className="progress-wrap">
      <div className="progress">
        <div
          className="progress-bar"
          style={{ width: `${STATUS_PROGRESS[track.status] ?? 0}%` }}
        />
      </div>
      <span className="progress-label">
        <Loader2 size={13} className="spin" /> {formatElapsed(track.createdAt, now)}
        {" · zwykle 1–3 min"}
      </span>
    </div>
  );
}

interface Props {
  tracks: Track[];
  sunoKey: string;
  onDelete: (id: string) => void;
  onCreatePersona: (
    track: Track,
    audioId: string,
    name: string,
    description: string
  ) => Promise<void>;
  onUpdateTrack: (id: string, patch: Partial<Track>) => void;
}

const STATUS_LABELS: Record<Track["status"], string> = {
  PENDING: "W kolejce",
  TEXT_SUCCESS: "Tekst przetworzony",
  FIRST_SUCCESS: "Pierwszy utwór gotowy",
  SUCCESS: "Gotowe",
  FAILED: "Błąd",
};

export default function LibraryView({
  tracks,
  sunoKey,
  onDelete,
  onCreatePersona,
  onUpdateTrack,
}: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [personaFor, setPersonaFor] = useState<string | null>(null);
  const [wavBusy, setWavBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // wybrany wariant per utwór (domyślnie A)
  const [variantIndex, setVariantIndex] = useState<Record<string, number>>({});
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [albumBusy, setAlbumBusy] = useState<string | null>(null);
  // odtwarzanie albumu po kolei: nazwa albumu + id aktualnego utworu
  const [albumPlay, setAlbumPlay] = useState<{ name: string; trackId: string } | null>(null);

  function playableTracks(list: Track[]): Track[] {
    return list.filter((t) => {
      const v = getVariants(t)[variantIndex[t.id] ?? 0];
      return t.status === "SUCCESS" && (v?.audioUrl || v?.streamAudioUrl);
    });
  }

  function advanceAlbum(name: string, list: Track[]) {
    const playable = playableTracks(list);
    const current = playable.findIndex((t) => t.id === albumPlay?.trackId);
    if (current >= 0 && current + 1 < playable.length) {
      setAlbumPlay({ name, trackId: playable[current + 1].id });
    } else {
      setAlbumPlay(null); // koniec płyty
    }
  }

  function toggleCollapsed(name: string) {
    const next = new Set(collapsed);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setCollapsed(next);
  }

  /** Pobiera cały album do wybranego folderu: pliki "NN - Tytuł.mp3/.wav" wg kolejności płyty. */
  async function downloadAlbum(name: string, list: Track[], format: "mp3" | "wav") {
    setMessage(null);
    const done = list.filter((t) => t.status === "SUCCESS");
    if (done.length === 0) {
      setMessage("Album nie ma jeszcze ukończonych utworów");
      return;
    }
    const dir = await open({ directory: true, title: `Folder na album „${name}”` });
    if (!dir) return;
    setAlbumBusy(`${name}:${format}`);
    let saved = 0;
    const errors: string[] = [];
    try {
      for (let i = 0; i < done.length; i++) {
        const track = done[i];
        const variant = getVariants(track)[variantIndex[track.id] ?? 0];
        if (!variant) continue;
        setMessage(`Pobieranie albumu (${format.toUpperCase()}): ${i + 1}/${done.length} — ${track.title}`);
        const fileName = `${String((track.albumIndex ?? i) + 1).padStart(2, "0")} - ${sanitizeFileName(track.title)}.${format}`;
        try {
          let url = variant.audioUrl;
          if (format === "wav") {
            url = variant.wavUrl;
            if (!url) {
              url = await convertToWav(sunoKey, track.taskId, variant.audioId);
              const variants = getVariants(track).map((v) =>
                v.audioId === variant.audioId ? { ...v, wavUrl: url } : v
              );
              onUpdateTrack(track.id, { variants });
            }
          }
          if (!url) throw new Error("brak pliku audio");
          await downloadToPath(url, `${dir}/${fileName}`);
          saved++;
        } catch (e) {
          errors.push(`${track.title}: ${e instanceof Error ? e.message : e}`);
        }
      }
      setMessage(
        `Zapisano ${saved}/${done.length} plików ${format.toUpperCase()} albumu „${name}”` +
          (errors.length ? ` (błędy: ${errors.join("; ")})` : "")
      );
    } finally {
      setAlbumBusy(null);
    }
  }

  /** Pobiera okładki wszystkich utworów albumu do wybranego folderu. */
  async function downloadAlbumCovers(name: string, list: Track[]) {
    setMessage(null);
    const withCovers = list
      .map((t, i) => ({
        track: t,
        order: t.albumIndex ?? i,
        imageUrl: getVariants(t)[variantIndex[t.id] ?? 0]?.imageUrl ?? t.imageUrl,
      }))
      .filter((x) => x.imageUrl);
    if (withCovers.length === 0) {
      setMessage("Album nie ma jeszcze okładek");
      return;
    }
    const dir = await open({ directory: true, title: `Folder na okładki „${name}”` });
    if (!dir) return;
    setAlbumBusy(`${name}:covers`);
    let saved = 0;
    try {
      for (const { track, order, imageUrl } of withCovers) {
        const fileName = `${String(order + 1).padStart(2, "0")} - ${sanitizeFileName(track.title)}.${imageExt(imageUrl!)}`;
        try {
          await downloadToPath(imageUrl!, `${dir}/${fileName}`);
          saved++;
        } catch {
          /* pojedynczy błąd nie przerywa reszty */
        }
      }
      setMessage(`Zapisano ${saved}/${withCovers.length} okładek albumu „${name}”`);
    } finally {
      setAlbumBusy(null);
    }
  }

  const anyInProgress = tracks.some((t) => IN_PROGRESS.includes(t.status));
  useEffect(() => {
    if (!anyInProgress) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [anyInProgress]);

  function variantName(track: Track, index: number): string {
    const count = getVariants(track).length;
    return count > 1 ? `${track.title} (wariant ${VARIANT_LETTERS[index] ?? index + 1})` : track.title;
  }

  async function download(track: Track, variant: TrackVariant, index: number) {
    if (!variant.audioUrl) return;
    setMessage(null);
    try {
      const saved = await downloadMp3(variant.audioUrl, variantName(track, index));
      if (saved) setMessage(`Zapisano „${variantName(track, index)}"`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }

  async function downloadWav(track: Track, variant: TrackVariant, index: number) {
    setMessage(null);
    setWavBusy(track.id);
    try {
      // konwersja jest jednorazowa per wariant — zapamiętany URL pozwala pobierać od razu
      let url = variant.wavUrl;
      if (!url) {
        url = await convertToWav(sunoKey, track.taskId, variant.audioId);
        const variants = getVariants(track).map((v, i) =>
          i === index ? { ...v, wavUrl: url } : v
        );
        onUpdateTrack(track.id, { variants });
      }
      const saved = await downloadWavFile(url, variantName(track, index));
      if (saved) setMessage(`Zapisano WAV „${variantName(track, index)}"`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setWavBusy(null);
    }
  }

  if (tracks.length === 0) {
    return (
      <div className="view">
        <p className="empty">Brak wygenerowanych utworów. Przejdź do zakładki „Twórz".</p>
      </div>
    );
  }

  // Grupowanie: sekcja per album (kolejność płyty) + sekcja pojedynczych utworów;
  // sekcje ułożone wg najświeższej aktywności
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
  const newest = (list: Track[]) =>
    Math.max(...list.map((t) => new Date(t.createdAt).getTime()));
  const sections: { name: string | null; tracks: Track[] }[] = [
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

  const renderTrack = (track: Track) => {
          const variants = getVariants(track);
          const selectedIndex = Math.min(variantIndex[track.id] ?? 0, Math.max(variants.length - 1, 0));
          const variant = variants[selectedIndex];
          return (
          <li
            key={track.id}
            className={`track${albumPlay?.trackId === track.id ? " playing" : ""}`}
          >
            <div className="track-header">
              {(variant?.imageUrl ?? track.imageUrl) && (
                <img className="track-cover" src={variant?.imageUrl ?? track.imageUrl} alt="" />
              )}
              <div className="track-meta">
                <strong>{track.title}</strong>
                <span className="track-sub">
                  {new Date(track.createdAt).toLocaleString("pl-PL")} ·{" "}
                  {track.sunoModel.replace(/_/g, ".")} ·{" "}
                  {track.provider === "openai" ? "OpenAI" : "Anthropic"}
                  {track.instrumental ? " · instrumental" : ""}
                  {track.personaUsed ? ` · persona: ${track.personaUsed}` : ""}
                  {track.albumIndex !== undefined ? ` · #${track.albumIndex + 1}` : ""}
                </span>
              </div>
              <span className={`badge badge-${track.status.toLowerCase()}`}>
                {STATUS_LABELS[track.status]}
              </span>
            </div>

            {IN_PROGRESS.includes(track.status) && (
              <TrackProgress track={track} now={now} />
            )}

            {track.status === "FAILED" && track.error && (
              <p className="error">{track.error}</p>
            )}

            {variants.length > 1 && (
              <div className="variant-switch">
                {variants.map((v, i) => (
                  <button
                    key={v.audioId}
                    className={i === selectedIndex ? "active" : ""}
                    onClick={() => setVariantIndex({ ...variantIndex, [track.id]: i })}
                  >
                    Wariant {VARIANT_LETTERS[i] ?? i + 1}
                    {formatDuration(v.duration)}
                  </button>
                ))}
              </div>
            )}

            {(track.status === "SUCCESS" || track.status === "FIRST_SUCCESS") && variant && (
              <Player
                key={variant.audioId}
                audioUrl={variant.audioUrl}
                streamAudioUrl={variant.streamAudioUrl}
              />
            )}

            <div className="track-actions">
              {variant?.audioUrl && (
                <button onClick={() => download(track, variant, selectedIndex)}>
                  <Download size={14} /> Pobierz MP3
                </button>
              )}
              {track.status === "SUCCESS" && variant && (
                <button
                  onClick={() => downloadWav(track, variant, selectedIndex)}
                  disabled={wavBusy === track.id}
                >
                  {wavBusy === track.id ? (
                    <><Loader2 size={14} className="spin" /> Konwertuję do WAV...</>
                  ) : (
                    <><FileAudio size={14} /> Pobierz WAV</>
                  )}
                </button>
              )}
              {variant?.imageUrl && (
                <button
                  onClick={async () => {
                    try {
                      const saved = await downloadImageFile(
                        variant.imageUrl!,
                        variantName(track, selectedIndex)
                      );
                      if (saved) setMessage(`Zapisano okładkę „${track.title}"`);
                    } catch (e) {
                      setMessage(e instanceof Error ? e.message : String(e));
                    }
                  }}
                >
                  <ImageDown size={14} /> Okładka
                </button>
              )}
              <button onClick={() => setExpanded(expanded === track.id ? null : track.id)}>
                {expanded === track.id ? "Ukryj tekst" : "Pokaż tekst"}
              </button>
              {track.status === "SUCCESS" && variant && (
                <button
                  onClick={() => setPersonaFor(personaFor === track.id ? null : track.id)}
                >
                  <UserRound size={14} /> Utwórz personę
                </button>
              )}
              <button className="btn-danger" onClick={() => onDelete(track.id)}>
                Usuń
              </button>
            </div>

            {personaFor === track.id && variant && (
              <PersonaForm
                track={track}
                onSubmit={async (name, description) => {
                  await onCreatePersona(track, variant.audioId, name, description);
                  setMessage(
                    `Persona „${name}” utworzona z wariantu ${VARIANT_LETTERS[selectedIndex] ?? selectedIndex + 1} — wybierz ją w zakładce „Twórz”`
                  );
                }}
                onClose={() => setPersonaFor(null)}
              />
            )}

            {expanded === track.id && (
              <div className="track-details">
                <p className="track-style">{track.style}</p>
                <pre className="track-lyrics">{track.lyrics}</pre>
              </div>
            )}
          </li>
          );
  };

  return (
    <div className="view">
      {message && <p className="info">{message}</p>}
      {sections.map((section) => {
        const isCollapsed = section.name !== null && collapsed.has(section.name);
        const busyKey = albumBusy?.startsWith(`${section.name}:`) ? albumBusy : null;
        return (
          <section key={section.name ?? "__singles__"} className="album-group">
            <div className="album-group-header">
              {section.name ? (
                <button
                  className="album-toggle"
                  onClick={() => toggleCollapsed(section.name!)}
                  title={isCollapsed ? "Rozwiń album" : "Zwiń album"}
                >
                  {isCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                  <Disc3 size={15} />
                  <strong>{section.name}</strong>
                </button>
              ) : (
                <strong>Pojedyncze utwory</strong>
              )}
              <span className="album-group-count">
                {section.tracks.length} {plural(section.tracks.length)}
              </span>
              {section.name && (
                <span className="album-group-actions">
                  {albumPlay?.name === section.name ? (
                    <button onClick={() => setAlbumPlay(null)}>
                      <Square size={13} /> Zatrzymaj
                    </button>
                  ) : (
                    <button
                      disabled={playableTracks(section.tracks).length === 0}
                      onClick={() =>
                        setAlbumPlay({
                          name: section.name!,
                          trackId: playableTracks(section.tracks)[0].id,
                        })
                      }
                    >
                      <Play size={13} /> Odtwórz album
                    </button>
                  )}
                  <button
                    disabled={albumBusy !== null}
                    onClick={() => downloadAlbum(section.name!, section.tracks, "mp3")}
                  >
                    {busyKey === `${section.name}:mp3` ? (
                      <Loader2 size={13} className="spin" />
                    ) : (
                      <Download size={13} />
                    )}{" "}
                    MP3
                  </button>
                  <button
                    disabled={albumBusy !== null}
                    onClick={() => downloadAlbum(section.name!, section.tracks, "wav")}
                  >
                    {busyKey === `${section.name}:wav` ? (
                      <Loader2 size={13} className="spin" />
                    ) : (
                      <FileAudio size={13} />
                    )}{" "}
                    WAV
                  </button>
                  <button
                    disabled={albumBusy !== null}
                    onClick={() => downloadAlbumCovers(section.name!, section.tracks)}
                  >
                    {busyKey === `${section.name}:covers` ? (
                      <Loader2 size={13} className="spin" />
                    ) : (
                      <ImageDown size={13} />
                    )}{" "}
                    Okładki
                  </button>
                </span>
              )}
            </div>
            {albumPlay?.name === section.name &&
              (() => {
                const current = section.tracks.find((t) => t.id === albumPlay.trackId);
                const v = current
                  ? getVariants(current)[variantIndex[current.id] ?? 0]
                  : undefined;
                if (!current || !v) return null;
                return (
                  <div className="album-player">
                    <span className="album-player-now">
                      Teraz: {(current.albumIndex ?? 0) + 1}. {current.title}
                    </span>
                    <audio
                      key={current.id}
                      className="player"
                      controls
                      autoPlay
                      src={v.audioUrl || v.streamAudioUrl}
                      onEnded={() => advanceAlbum(section.name!, section.tracks)}
                      onError={() => advanceAlbum(section.name!, section.tracks)}
                    />
                  </div>
                );
              })()}
            {!isCollapsed && (
              <ul className="track-list">{section.tracks.map(renderTrack)}</ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
