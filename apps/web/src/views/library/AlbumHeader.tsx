import {
  ChevronDown,
  ChevronRight,
  Disc3,
  Download,
  Eraser,
  FileAudio,
  FileText,
  ImageDown,
  Loader2,
  Play,
  Sparkles,
  Square,
} from "lucide-react";
import { Playback, Track } from "@suno/core";
import platform from "@platform";
import { buildQueue, modeLabel, plural, VariantMode } from "./helpers";

export type AlbumTask = "mp3" | "wav" | "covers" | "lyrics" | "aicover" | "reset";

interface Props {
  name: string;
  tracks: Track[];
  collapsed: boolean;
  mode: VariantMode;
  playback: Playback | null;
  /** Trwające zadanie tego albumu; `anyBusy` blokuje akcje wszystkich albumów naraz. */
  busy: AlbumTask | null;
  anyBusy: boolean;
  onToggle: () => void;
  onModeChange: (mode: VariantMode) => void;
  onPlay: (playback: Playback) => void;
  onStopPlayback: () => void;
  onTask: (task: AlbumTask) => void;
  onSetCoverSource: (domainIds: string[], source: "suno" | "ai") => Promise<void>;
}

/** Nagłówek albumu w Bibliotece: tytuł + akcje pogrupowane w klastry
 *  (Odtwarzanie / Warianty / Pobierz / Okładki AI) w osobnym, zawijanym wierszu. */
export default function AlbumHeader({
  name,
  tracks,
  collapsed,
  mode,
  playback,
  busy,
  anyBusy,
  onToggle,
  onModeChange,
  onPlay,
  onStopPlayback,
  onTask,
  onSetCoverSource,
}: Props) {
  const queue = buildQueue(tracks, mode);
  const hasAiCovers = tracks.some((t) => t.aiImageUrl);
  const pendingCovers = tracks.filter((t) => t.coverStatus === "pending").length;
  const icon = (task: AlbumTask, Idle: typeof Download) =>
    busy === task ? <Loader2 size={13} className="spin" /> : <Idle size={13} />;
  const saveLabel = platform.kind === "desktop" ? "Zapisz" : "Pobierz";

  return (
    <div className="album-group-header">
      <button
        className="album-toggle"
        onClick={onToggle}
        title={collapsed ? "Rozwiń album" : "Zwiń album"}
      >
        {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
        <Disc3 size={15} />
        <strong>{name}</strong>
      </button>
      <span className="album-group-count">
        {tracks.length} {plural(tracks.length)}
      </span>
      <span className="album-group-actions">
        <span className="action-group">
          {playback?.name === name ? (
            <button onClick={onStopPlayback}>
              <Square size={13} /> Zatrzymaj
            </button>
          ) : (
            <button
              disabled={queue.length === 0}
              onClick={() => onPlay({ name, queue, index: 0, repeat: false })}
            >
              <Play size={13} /> Odtwórz album
            </button>
          )}
        </span>

        <span className="action-group" title="Które warianty trafiają do kolejki i pobierania">
          <span className="action-group-label">Warianty</span>
          <span className="variant-switch">
            {(["a", "b", "both"] as const).map((m) => (
              <button
                key={m}
                className={mode === m ? "active" : ""}
                onClick={() => onModeChange(m)}
              >
                {modeLabel(m)}
              </button>
            ))}
          </span>
        </span>

        <span className="action-group">
          <span className="action-group-label">{saveLabel}</span>
          <button disabled={anyBusy} onClick={() => onTask("mp3")}>
            {icon("mp3", Download)} MP3
          </button>
          <button disabled={anyBusy} onClick={() => onTask("wav")}>
            {icon("wav", FileAudio)} WAV
          </button>
          <button disabled={anyBusy} onClick={() => onTask("covers")}>
            {icon("covers", ImageDown)} Okładki
          </button>
          <button disabled={anyBusy} onClick={() => onTask("lyrics")}>
            {icon("lyrics", FileText)} Teksty
          </button>
        </span>

        <span className="action-group">
          <span className="action-group-label">Okładki AI</span>
          <button
            disabled={anyBusy || pendingCovers > 0}
            title="Wygeneruj brakujące okładki AI — osobną dla każdego utworu"
            onClick={() => onTask("aicover")}
          >
            {pendingCovers > 0 ? (
              <>
                <Loader2 size={13} className="spin" /> W kolejce: {pendingCovers}
              </>
            ) : (
              <>{icon("aicover", Sparkles)} Generuj</>
            )}
          </button>
          {hasAiCovers && (
            <>
              <button
                disabled={anyBusy}
                title="Usuń wszystkie okładki AI tego albumu"
                onClick={() => onTask("reset")}
              >
                {icon("reset", Eraser)} Reset
              </button>
              <span className="action-group-label">aktywna</span>
              <span className="variant-switch" title="Która okładka albumu jest aktywna">
                {(["suno", "ai"] as const).map((m) => (
                  <button
                    key={m}
                    className={(tracks[0]?.coverSource ?? "suno") === m ? "active" : ""}
                    onClick={() =>
                      void onSetCoverSource(
                        tracks.map((t) => t.id),
                        m
                      )
                    }
                  >
                    {m === "ai" ? "AI" : "Suno"}
                  </button>
                ))}
              </span>
            </>
          )}
        </span>
      </span>
    </div>
  );
}
