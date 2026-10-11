import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Disc3,
  Download,
  FileAudio,
  FileText,
  ImageDown,
  ListPlus,
  Loader2,
  Play,
  RotateCcw,
  Sparkles,
  Square,
  UserRound,
} from "lucide-react";
import Player from "../components/Player";
import {
  beginBusy,
  downloadFile,
  downloadText,
  downloadZip,
  endBusy,
  imageExt,
  sanitizeFileName,
} from "../services/download";
import {
  canRegenerate,
  getVariants,
  isAudioLost,
  Playback,
  PlayQueueItem,
  Track,
  TrackVariant,
} from "../types";

const VARIANT_LETTERS = ["A", "B", "C", "D"];

/** Aktywna okładka: AI (jeśli wybrana i istnieje) albo oryginalna z Suno. */
function activeCover(track: Track, variant?: TrackVariant): string | undefined {
  if (track.coverSource === "ai" && track.aiImageUrl) return track.aiImageUrl;
  return variant?.imageUrl ?? track.imageUrl;
}

/** Rozszerzenie pliku okładki — URL-e Convex storage (AI) nie mają rozszerzenia. */
function coverExt(url: string, track: Track): string {
  return url === track.aiImageUrl ? "png" : imageExt(url);
}

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
        <Loader2 size={13} className="spin" /> {formatElapsed(track.generatedAt ?? track.createdAt, now)}
        {" · zwykle 1–3 min"}
      </span>
    </div>
  );
}

interface Props {
  tracks: Track[];
  playback: Playback | null;
  onPlay: (playback: Playback) => void;
  onAddToQueue: (item: PlayQueueItem) => void;
  onStopPlayback: () => void;
  onDelete: (id: string) => void;
  onRetry: (id: string) => Promise<void>;
  onRegenerate: (id: string) => Promise<void>;
  onCreatePersona: (
    track: Track,
    audioId: string,
    name: string,
    description: string
  ) => Promise<void>;
  onConvertToWav: (domainId: string, audioId: string) => Promise<string>;
  onGenerateCover: (domainId: string) => Promise<void>;
  onGenerateAlbumCover: (album: string) => Promise<void>;
  onSetCoverSource: (domainIds: string[], source: "suno" | "ai") => Promise<void>;
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
  playback,
  onPlay,
  onAddToQueue,
  onStopPlayback,
  onDelete,
  onRetry,
  onRegenerate,
  onCreatePersona,
  onConvertToWav,
  onGenerateCover,
  onGenerateAlbumCover,
  onSetCoverSource,
}: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [retryBusy, setRetryBusy] = useState<string | null>(null);
  const [personaFor, setPersonaFor] = useState<string | null>(null);
  const [wavBusy, setWavBusy] = useState<string | null>(null);
  const [coverBusy, setCoverBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // wybrany wariant per utwór (domyślnie A)
  const [variantIndex, setVariantIndex] = useState<Record<string, number>>({});
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [albumBusy, setAlbumBusy] = useState<string | null>(null);
  // które warianty trafiają do ZIP-ów albumu (per album, domyślnie oba)
  const [zipMode, setZipMode] = useState<Record<string, "a" | "b" | "both">>({});
  /** Buduje kolejkę odtwarzania albumu z wariantów wybranych przełącznikiem. */
  function buildQueue(list: Track[], mode: "a" | "b" | "both"): PlayQueueItem[] {
    const items: PlayQueueItem[] = [];
    list.forEach((t, i) => {
      if (t.status !== "SUCCESS") return;
      const all = getVariants(t);
      const chosen =
        mode === "both" ? all : [all[mode === "b" ? 1 : 0] ?? all[0]].filter(Boolean);
      for (const v of chosen) {
        const url = v.audioUrl || v.streamAudioUrl;
        if (!url) continue;
        const letter =
          all.length > 1 ? ` (${VARIANT_LETTERS[all.indexOf(v)] ?? all.indexOf(v) + 1})` : "";
        items.push({
          trackId: t.id,
          label: `${(t.albumIndex ?? i) + 1}. ${t.title}${letter}`,
          url,
        });
      }
    });
    return items;
  }

  function toggleCollapsed(name: string) {
    const next = new Set(collapsed);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setCollapsed(next);
  }

  /** Pobiera cały album jako ZIP wg kolejności płyty; mode decyduje, które
   *  warianty trafiają do paczki (A / B / oba — pliki "NN - Tytuł (A/B)"). */
  async function downloadAlbum(
    name: string,
    list: Track[],
    format: "mp3" | "wav",
    mode: "a" | "b" | "both"
  ) {
    setMessage(null);
    const done = list.filter((t) => t.status === "SUCCESS");
    if (done.length === 0) {
      setMessage("Album nie ma jeszcze ukończonych utworów");
      return;
    }
    setAlbumBusy(`${name}:${format}`);
    beginBusy(); // konwersje WAV przed downloadZip też blokują auto-reload PWA
    const files: { url: string; name: string }[] = [];
    const errors: string[] = [];
    try {
      for (let i = 0; i < done.length; i++) {
        const track = done[i];
        const all = getVariants(track);
        // "a"/"b" — jeden wskazany wariant (fallback do A, gdy B nie istnieje)
        const variants =
          mode === "both" ? all : [all[mode === "b" ? 1 : 0] ?? all[0]].filter(Boolean);
        const nn = String((track.albumIndex ?? i) + 1).padStart(2, "0");
        for (let vi = 0; vi < variants.length; vi++) {
          const variant = variants[vi];
          const letter = VARIANT_LETTERS[all.indexOf(variant)] ?? String(vi + 1);
          const suffix = variants.length > 1 ? ` (${letter})` : "";
          const fileName = `${nn} - ${sanitizeFileName(track.title)}${suffix}.${format}`;
          setMessage(
            `Przygotowanie (${format.toUpperCase()}): ${i + 1}/${done.length} — ${track.title}${suffix}`
          );
          try {
            let url = variant.audioUrl;
            if (format === "wav") {
              url = variant.wavUrl ?? (await onConvertToWav(track.id, variant.audioId));
            }
            if (!url) throw new Error("brak pliku audio");
            files.push({ url, name: fileName });
          } catch (e) {
            errors.push(`${track.title}${suffix}: ${e instanceof Error ? e.message : e}`);
          }
        }
      }
      const { saved, errors: dlErrors } = await downloadZip(
        files,
        `${sanitizeFileName(name)}.zip`,
        (d, t) => setMessage(`Pakowanie ZIP: ${d}/${t}`)
      );
      const allErrors = [...errors, ...dlErrors];
      setMessage(
        `Zapisano ZIP „${name}” (${format.toUpperCase()}): ${saved}/${files.length + errors.length} plików` +
          (allErrors.length ? ` (błędy: ${allErrors.join("; ")})` : "")
      );
    } finally {
      endBusy();
      setAlbumBusy(null);
    }
  }

  /** Pobiera okładki wszystkich utworów albumu jako ZIP.
   *  Wspólna okładka AI jest deduplikowana — jeden URL → pojedynczy plik zamiast ZIP. */
  async function downloadAlbumCovers(name: string, list: Track[]) {
    setMessage(null);
    const withCovers = list
      .map((t, i) => ({
        track: t,
        order: t.albumIndex ?? i,
        imageUrl: activeCover(t, getVariants(t)[variantIndex[t.id] ?? 0]),
      }))
      .filter((x) => x.imageUrl);
    if (withCovers.length === 0) {
      setMessage("Album nie ma jeszcze okładek");
      return;
    }
    const unique = withCovers.filter(
      (x, i) => withCovers.findIndex((y) => y.imageUrl === x.imageUrl) === i
    );
    setAlbumBusy(`${name}:covers`);
    try {
      if (unique.length === 1) {
        const { track, imageUrl } = unique[0];
        await downloadFile(
          imageUrl!,
          `${sanitizeFileName(name)} - okładka.${coverExt(imageUrl!, track)}`
        );
        setMessage(`Zapisano okładkę albumu „${name}”`);
        return;
      }
      const files = unique.map(({ track, order, imageUrl }) => ({
        url: imageUrl!,
        name: `${String(order + 1).padStart(2, "0")} - ${sanitizeFileName(track.title)}.${coverExt(imageUrl!, track)}`,
      }));
      const { saved } = await downloadZip(
        files,
        `${sanitizeFileName(name)} - okładki.zip`,
        (d, t) => setMessage(`Pakowanie okładek: ${d}/${t}`)
      );
      setMessage(`Zapisano ZIP z okładkami albumu „${name}”: ${saved}/${unique.length}`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setAlbumBusy(null);
    }
  }

  /** Zapisuje teksty wszystkich piosenek albumu do jednego pliku .txt. */
  function downloadAlbumLyrics(name: string, list: Track[]) {
    const withLyrics = list.filter((t) => t.lyrics);
    if (withLyrics.length === 0) {
      setMessage("Album nie ma jeszcze tekstów");
      return;
    }
    const sep = "\n\n" + "—".repeat(40) + "\n\n";
    const body = withLyrics
      .map(
        (t, i) =>
          `${String((t.albumIndex ?? i) + 1).padStart(2, "0")}. ${t.title}\nStyl: ${t.style}\n\n${t.lyrics}`
      )
      .join(sep);
    downloadText(`${name}${sep}${body}`, `${sanitizeFileName(name)} - teksty.txt`);
    setMessage(`Zapisano teksty albumu „${name}” (${withLyrics.length})`);
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
      await downloadFile(variant.audioUrl, `${sanitizeFileName(variantName(track, index))}.mp3`);
      setMessage(`Zapisano „${variantName(track, index)}"`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }

  async function downloadWav(track: Track, variant: TrackVariant, index: number) {
    setMessage(null);
    setWavBusy(track.id);
    try {
      // konwersja jest jednorazowa per wariant — serwer zapamiętuje wavUrl
      const url = variant.wavUrl ?? (await onConvertToWav(track.id, variant.audioId));
      await downloadFile(url, `${sanitizeFileName(variantName(track, index))}.wav`);
      setMessage(`Zapisano WAV „${variantName(track, index)}"`);
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
            className={`track${playback?.queue[playback.index]?.trackId === track.id ? " playing" : ""}`}
          >
            <div className="track-header">
              {activeCover(track, variant) && (
                <img className="track-cover" src={activeCover(track, variant)} alt="" />
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

            {variant?.audioExpired && (
              <p className="error">
                Plik audio wygasł na serwerach Suno (trzymają pliki 14 dni), zanim trafił do archiwum.
                {!canRegenerate(track) && variants.some((v) => !isAudioLost(v)) &&
                  " Pozostałe pliki tego utworu są dostępne."}
              </p>
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
              {track.status === "SUCCESS" && variant && (variant.wavUrl || !variant.audioExpired) && (
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
              {activeCover(track, variant) && (
                <button
                  onClick={async () => {
                    const url = activeCover(track, variant)!;
                    try {
                      await downloadFile(
                        url,
                        `${sanitizeFileName(variantName(track, selectedIndex))}.${coverExt(url, track)}`
                      );
                      setMessage(`Zapisano okładkę „${track.title}"`);
                    } catch (e) {
                      setMessage(e instanceof Error ? e.message : String(e));
                    }
                  }}
                >
                  <ImageDown size={14} /> Okładka
                </button>
              )}
              {track.status === "SUCCESS" && (
                <button
                  disabled={coverBusy === track.id}
                  onClick={async () => {
                    setMessage(null);
                    setCoverBusy(track.id);
                    try {
                      await onGenerateCover(track.id);
                      setMessage(`Wygenerowano okładkę AI „${track.title}"`);
                    } catch (e) {
                      setMessage(e instanceof Error ? e.message : String(e));
                    } finally {
                      setCoverBusy(null);
                    }
                  }}
                >
                  {coverBusy === track.id ? (
                    <><Loader2 size={14} className="spin" /> Generuję okładkę...</>
                  ) : (
                    <><Sparkles size={14} /> Okładka AI</>
                  )}
                </button>
              )}
              {track.aiImageUrl && (
                <span className="variant-switch" title="Która okładka jest aktywna">
                  {(["suno", "ai"] as const).map((m) => (
                    <button
                      key={m}
                      className={(track.coverSource ?? "suno") === m ? "active" : ""}
                      onClick={() => void onSetCoverSource([track.id], m)}
                    >
                      {m === "ai" ? "AI" : "Suno"}
                    </button>
                  ))}
                </span>
              )}
              {track.status === "FAILED" && (
                <button
                  disabled={retryBusy === track.id}
                  onClick={async () => {
                    setRetryBusy(track.id);
                    try {
                      await onRetry(track.id);
                      setMessage(`„${track.title}" wysłano ponownie do Suno`);
                    } catch (e) {
                      setMessage(e instanceof Error ? e.message : String(e));
                    } finally {
                      setRetryBusy(null);
                    }
                  }}
                >
                  {retryBusy === track.id ? (
                    <><Loader2 size={14} className="spin" /> Wysyłanie...</>
                  ) : (
                    <><RotateCcw size={14} /> Generuj ponownie</>
                  )}
                </button>
              )}
              {canRegenerate(track) && (
                <button
                  disabled={retryBusy === track.id}
                  onClick={async () => {
                    const personaNote =
                      track.personaUsed && !track.personaId
                        ? `\n\nPersona „${track.personaUsed}" nie zostanie użyta — utwór nie ma zapisanego jej id.`
                        : "";
                    if (
                      !window.confirm(
                        `Suno wygeneruje NOWĄ wersję „${track.title}" z tym samym tekstem, stylem i modelem — ` +
                          "nagranie będzie inne niż oryginał, którego nie da się odzyskać. " +
                          "Zużyje to kredyty Suno." +
                          personaNote
                      )
                    )
                      return;
                    setMessage(null);
                    setRetryBusy(track.id);
                    try {
                      await onRegenerate(track.id);
                      setMessage(`„${track.title}" wysłano do Suno do przegenerowania`);
                    } catch (e) {
                      setMessage(e instanceof Error ? e.message : String(e));
                    } finally {
                      setRetryBusy(null);
                    }
                  }}
                >
                  {retryBusy === track.id ? (
                    <><Loader2 size={14} className="spin" /> Wysyłanie...</>
                  ) : (
                    <><RotateCcw size={14} /> Przegeneruj</>
                  )}
                </button>
              )}
              <button onClick={() => setExpanded(expanded === track.id ? null : track.id)}>
                {expanded === track.id ? "Ukryj tekst" : "Pokaż tekst"}
              </button>
              {track.status === "SUCCESS" && variant && (variant.audioUrl || variant.streamAudioUrl) && (
                <button
                  onClick={() => {
                    onAddToQueue({
                      trackId: track.id,
                      label:
                        (track.albumIndex !== undefined ? `${track.albumIndex + 1}. ` : "") +
                        variantName(track, selectedIndex),
                      url: (variant.audioUrl || variant.streamAudioUrl)!,
                    });
                    setMessage(`Dodano do kolejki: ${variantName(track, selectedIndex)}`);
                  }}
                >
                  <ListPlus size={14} /> Do kolejki
                </button>
              )}
              {track.lyrics && (
                <button
                  onClick={() => {
                    downloadText(
                      `${track.title}\nStyl: ${track.style}\n\n${track.lyrics}`,
                      `${sanitizeFileName(track.title)}.txt`
                    );
                    setMessage(`Zapisano tekst „${track.title}"`);
                  }}
                >
                  <FileText size={14} /> Tekst (TXT)
                </button>
              )}
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
                  {playback?.name === section.name ? (
                    <button onClick={onStopPlayback}>
                      <Square size={13} /> Zatrzymaj
                    </button>
                  ) : (
                    <button
                      disabled={
                        buildQueue(section.tracks, zipMode[section.name!] ?? "both").length === 0
                      }
                      onClick={() =>
                        onPlay({
                          name: section.name!,
                          queue: buildQueue(section.tracks, zipMode[section.name!] ?? "both"),
                          index: 0,
                          repeat: false,
                        })
                      }
                    >
                      <Play size={13} /> Odtwórz album
                    </button>
                  )}
                  <span className="variant-switch" title="Które warianty trafiają do ZIP (MP3/WAV)">
                    {(["a", "b", "both"] as const).map((m) => (
                      <button
                        key={m}
                        className={(zipMode[section.name!] ?? "both") === m ? "active" : ""}
                        onClick={() => setZipMode({ ...zipMode, [section.name!]: m })}
                      >
                        {m === "both" ? "A+B" : m.toUpperCase()}
                      </button>
                    ))}
                  </span>
                  <button
                    disabled={albumBusy !== null}
                    onClick={() =>
                      downloadAlbum(
                        section.name!,
                        section.tracks,
                        "mp3",
                        zipMode[section.name!] ?? "both"
                      )
                    }
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
                    onClick={() =>
                      downloadAlbum(
                        section.name!,
                        section.tracks,
                        "wav",
                        zipMode[section.name!] ?? "both"
                      )
                    }
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
                  <button
                    disabled={albumBusy !== null}
                    onClick={() => downloadAlbumLyrics(section.name!, section.tracks)}
                  >
                    <FileText size={13} /> Teksty
                  </button>
                  <button
                    disabled={albumBusy !== null}
                    onClick={async () => {
                      setMessage(null);
                      setAlbumBusy(`${section.name}:aicover`);
                      try {
                        await onGenerateAlbumCover(section.name!);
                        setMessage(`Wygenerowano okładkę AI albumu „${section.name}”`);
                      } catch (e) {
                        setMessage(e instanceof Error ? e.message : String(e));
                      } finally {
                        setAlbumBusy(null);
                      }
                    }}
                  >
                    {busyKey === `${section.name}:aicover` ? (
                      <Loader2 size={13} className="spin" />
                    ) : (
                      <Sparkles size={13} />
                    )}{" "}
                    Okładka AI
                  </button>
                  {section.tracks.some((t) => t.aiImageUrl) && (
                    <span className="variant-switch" title="Która okładka albumu jest aktywna">
                      {(["suno", "ai"] as const).map((m) => (
                        <button
                          key={m}
                          className={
                            (section.tracks[0]?.coverSource ?? "suno") === m ? "active" : ""
                          }
                          onClick={() =>
                            void onSetCoverSource(section.tracks.map((t) => t.id), m)
                          }
                        >
                          {m === "ai" ? "AI" : "Suno"}
                        </button>
                      ))}
                    </span>
                  )}
                </span>
              )}
            </div>
            {!isCollapsed && (
              <ul className="track-list">{section.tracks.map(renderTrack)}</ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
