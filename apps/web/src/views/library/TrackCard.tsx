import { useState } from "react";
import {
  Download,
  Eraser,
  FileAudio,
  FileText,
  ImageDown,
  ListPlus,
  Loader2,
  RotateCcw,
  Sparkles,
  UserRound,
} from "lucide-react";
import { canRegenerate, getVariants, isAudioLost, PlayQueueItem, Track } from "@suno/core";
import platform from "@platform";
import Player from "../../components/Player";
import { downloadCover, downloadLyrics, downloadMp3, downloadWav } from "./downloads";
import {
  activeCover,
  errorText,
  formatDuration,
  formatElapsed,
  IN_PROGRESS,
  STATUS_LABELS,
  VARIANT_LETTERS,
  variantName,
} from "./helpers";

// Postęp wg etapów Suno; ETA nieznane, więc pokazujemy etap + czas, jaki upłynął
const STATUS_PROGRESS: Record<string, number> = {
  PENDING: 15,
  TEXT_SUCCESS: 45,
  FIRST_SUCCESS: 75,
};

function TrackProgress({ track, now }: { track: Track; now: number }) {
  return (
    <div className="progress-wrap">
      <div className="progress">
        <div className="progress-bar" style={{ width: `${STATUS_PROGRESS[track.status] ?? 0}%` }} />
      </div>
      <span className="progress-label">
        <Loader2 size={13} className="spin" />{" "}
        {formatElapsed(track.generatedAt ?? track.createdAt, now)}
        {" · zwykle 1–3 min"}
      </span>
    </div>
  );
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
      setError(errorText(e));
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
        <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <div className="track-actions">
        <button className="btn-primary" onClick={submit} disabled={busy}>
          {busy ? "Tworzenie..." : "Utwórz personę"}
        </button>
        <button onClick={onClose} disabled={busy}>
          Anuluj
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

export interface TrackActions {
  onAddToQueue: (item: PlayQueueItem) => void;
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
  onSetCoverSource: (domainIds: string[], source: "suno" | "ai") => Promise<void>;
  onResetCovers: (domainIds: string[]) => Promise<number>;
}

interface Props extends TrackActions {
  track: Track;
  now: number;
  playing: boolean;
  selectedIndex: number;
  onSelectVariant: (index: number) => void;
  report: (message: string | null) => void;
}

type Busy = null | "wav" | "cover" | "retry" | "reset";

export default function TrackCard({
  track,
  now,
  playing,
  selectedIndex: requestedIndex,
  onSelectVariant,
  report,
  ...actions
}: Props) {
  const [busy, setBusy] = useState<Busy>(null);
  const [expanded, setExpanded] = useState(false);
  const [personaOpen, setPersonaOpen] = useState(false);

  const variants = getVariants(track);
  const selectedIndex = Math.min(requestedIndex, Math.max(variants.length - 1, 0));
  const variant = variants[selectedIndex];
  const cover = activeCover(track, variant);

  /** Akcja z blokadą przycisku i komunikatem sukcesu/błędu. */
  async function run(kind: Busy, work: () => Promise<string | void>) {
    report(null);
    setBusy(kind);
    try {
      const message = await work();
      if (message) report(message);
    } catch (e) {
      report(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function regenerate() {
    const personaNote =
      track.personaUsed && !track.personaId
        ? `\n\nPersona „${track.personaUsed}" nie zostanie użyta — utwór nie ma zapisanego jej id.`
        : "";
    const ok = await platform.confirm(
      `Suno wygeneruje NOWĄ wersję „${track.title}" z tym samym tekstem, stylem i modelem — ` +
        "nagranie będzie inne niż oryginał, którego nie da się odzyskać. " +
        "Zużyje to kredyty Suno." +
        personaNote,
      "Przegenerowanie utworu"
    );
    if (!ok) return;
    await run("retry", async () => {
      await actions.onRegenerate(track.id);
      return `„${track.title}" wysłano do Suno do przegenerowania`;
    });
  }

  async function resetCover() {
    const ok = await platform.confirm(
      `Usunąć okładkę AI „${track.title}”? Ponowne wygenerowanie kosztuje w OpenAI.`,
      "Reset okładki AI"
    );
    if (!ok) return;
    await run("reset", async () => {
      await actions.onResetCovers([track.id]);
      return `Usunięto okładkę AI „${track.title}”`;
    });
  }

  const done = track.status === "SUCCESS";
  const spinner = <Loader2 size={14} className="spin" />;

  return (
    <li className={`track${playing ? " playing" : ""}`}>
      <div className="track-header">
        {cover && <img className="track-cover" src={cover} alt="" />}
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

      {IN_PROGRESS.includes(track.status) && <TrackProgress track={track} now={now} />}

      {track.status === "FAILED" && track.error && <p className="error">{track.error}</p>}

      {variants.length > 1 && (
        <div className="variant-switch">
          {variants.map((v, i) => (
            <button
              key={v.audioId}
              className={i === selectedIndex ? "active" : ""}
              onClick={() => onSelectVariant(i)}
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
          {!canRegenerate(track) &&
            variants.some((v) => !isAudioLost(v)) &&
            " Pozostałe pliki tego utworu są dostępne."}
        </p>
      )}

      {track.coverStatus === "pending" && (
        <p className="hint">
          <Loader2 size={13} className="spin" /> Okładka AI w kolejce generacji...
        </p>
      )}
      {track.coverStatus === "error" && track.coverError && (
        <p className="error">Okładka AI: {track.coverError}</p>
      )}

      {(done || track.status === "FIRST_SUCCESS") && variant && (
        <Player
          key={variant.audioId}
          audioUrl={variant.audioUrl}
          streamAudioUrl={variant.streamAudioUrl}
        />
      )}

      <div className="track-actions">
        {variant?.audioUrl && (
          <button onClick={() => void downloadMp3(track, variant, selectedIndex, report)}>
            <Download size={14} /> Pobierz MP3
          </button>
        )}
        {done && variant && (variant.wavUrl || !variant.audioExpired) && (
          <button
            onClick={() =>
              run("wav", () =>
                downloadWav(track, variant, selectedIndex, actions.onConvertToWav, report)
              )
            }
            disabled={busy === "wav"}
          >
            {busy === "wav" ? (
              <>{spinner} Konwertuję do WAV...</>
            ) : (
              <>
                <FileAudio size={14} /> Pobierz WAV
              </>
            )}
          </button>
        )}
        {cover && (
          <button onClick={() => void downloadCover(track, variant, selectedIndex, report)}>
            <ImageDown size={14} /> Okładka
          </button>
        )}
        {done && (
          <button
            disabled={busy === "cover" || track.coverStatus === "pending"}
            onClick={() =>
              run("cover", async () => {
                await actions.onGenerateCover(track.id);
                return `Wygenerowano okładkę AI „${track.title}"`;
              })
            }
          >
            {busy === "cover" ? (
              <>{spinner} Generuję okładkę...</>
            ) : (
              <>
                <Sparkles size={14} /> Okładka AI
              </>
            )}
          </button>
        )}
        {track.aiImageUrl && (
          <>
            <span className="variant-switch" title="Która okładka jest aktywna">
              {(["suno", "ai"] as const).map((m) => (
                <button
                  key={m}
                  className={(track.coverSource ?? "suno") === m ? "active" : ""}
                  onClick={() => void actions.onSetCoverSource([track.id], m)}
                >
                  {m === "ai" ? "AI" : "Suno"}
                </button>
              ))}
            </span>
            <button disabled={busy === "reset"} title="Usuń okładkę AI" onClick={resetCover}>
              {busy === "reset" ? spinner : <Eraser size={14} />} Reset okładki
            </button>
          </>
        )}
        {track.status === "FAILED" && (
          <button
            disabled={busy === "retry"}
            onClick={() =>
              run("retry", async () => {
                await actions.onRetry(track.id);
                return `„${track.title}" wysłano ponownie do Suno`;
              })
            }
          >
            {busy === "retry" ? (
              <>{spinner} Wysyłanie...</>
            ) : (
              <>
                <RotateCcw size={14} /> Generuj ponownie
              </>
            )}
          </button>
        )}
        {canRegenerate(track) && (
          <button disabled={busy === "retry"} onClick={regenerate}>
            {busy === "retry" ? (
              <>{spinner} Wysyłanie...</>
            ) : (
              <>
                <RotateCcw size={14} /> Przegeneruj
              </>
            )}
          </button>
        )}
        <button onClick={() => setExpanded(!expanded)}>
          {expanded ? "Ukryj tekst" : "Pokaż tekst"}
        </button>
        {done && variant && (variant.audioUrl || variant.streamAudioUrl) && (
          <button
            onClick={() => {
              actions.onAddToQueue({
                trackId: track.id,
                label:
                  (track.albumIndex !== undefined ? `${track.albumIndex + 1}. ` : "") +
                  variantName(track, selectedIndex),
                url: (variant.audioUrl || variant.streamAudioUrl)!,
              });
              report(`Dodano do kolejki: ${variantName(track, selectedIndex)}`);
            }}
          >
            <ListPlus size={14} /> Do kolejki
          </button>
        )}
        {track.lyrics && (
          <button onClick={() => void downloadLyrics(track, report)}>
            <FileText size={14} /> Tekst (TXT)
          </button>
        )}
        {done && variant && (
          <button onClick={() => setPersonaOpen(!personaOpen)}>
            <UserRound size={14} /> Utwórz personę
          </button>
        )}
        <button className="btn-danger" onClick={() => actions.onDelete(track.id)}>
          Usuń
        </button>
      </div>

      {personaOpen && variant && (
        <PersonaForm
          track={track}
          onSubmit={async (name, description) => {
            await actions.onCreatePersona(track, variant.audioId, name, description);
            report(
              `Persona „${name}” utworzona z wariantu ${VARIANT_LETTERS[selectedIndex] ?? selectedIndex + 1} — wybierz ją w zakładce „Twórz”`
            );
          }}
          onClose={() => setPersonaOpen(false)}
        />
      )}

      {expanded && (
        <div className="track-details">
          <p className="track-style">{track.style}</p>
          <pre className="track-lyrics">{track.lyrics}</pre>
        </div>
      )}
    </li>
  );
}
