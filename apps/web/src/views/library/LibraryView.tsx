import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { getVariants, Playback, Track } from "@suno/core";
import platform from "@platform";
import AlbumHeader, { AlbumTask } from "./AlbumHeader";
import { downloadAlbum, downloadAlbumCovers, downloadAlbumLyrics } from "./downloads";
import { errorText, groupSections, IN_PROGRESS, plural, VariantMode } from "./helpers";
import TrackCard, { TrackActions } from "./TrackCard";

interface Props extends TrackActions {
  tracks: Track[];
  playback: Playback | null;
  onPlay: (playback: Playback) => void;
  onStopPlayback: () => void;
  onGenerateAlbumCovers: (album: string) => Promise<number>;
}

export default function LibraryView({
  tracks,
  playback,
  onPlay,
  onStopPlayback,
  onGenerateAlbumCovers,
  ...trackActions
}: Props) {
  const [message, setMessage] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // wybrany wariant per utwór (domyślnie A)
  const [variantIndex, setVariantIndex] = useState<Record<string, number>>({});
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // trwające zadanie albumu: [nazwa, zadanie] — blokuje akcje albumów na czas trwania
  const [albumBusy, setAlbumBusy] = useState<[string, AlbumTask] | null>(null);
  // które warianty trafiają do kolejki i pobierania (per album, domyślnie oba)
  const [albumMode, setAlbumMode] = useState<Record<string, VariantMode>>({});

  const anyInProgress = tracks.some((t) => IN_PROGRESS.includes(t.status));
  useEffect(() => {
    if (!anyInProgress) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [anyInProgress]);

  if (tracks.length === 0) {
    return (
      <div className="view">
        <p className="empty">Brak wygenerowanych utworów. Przejdź do zakładki „Twórz".</p>
      </div>
    );
  }

  function toggleCollapsed(name: string) {
    const next = new Set(collapsed);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setCollapsed(next);
  }

  const selectedVariant = (t: Track) => getVariants(t)[variantIndex[t.id] ?? 0];

  async function runAlbumTask(name: string, list: Track[], task: AlbumTask) {
    const mode = albumMode[name] ?? "both";
    const convert = trackActions.onConvertToWav;
    if (task === "reset") {
      const withCovers = list.filter((t) => t.aiImageUrl);
      const ok = await platform.confirm(
        `Usunąć okładki AI albumu „${name}” (${withCovers.length} ${plural(withCovers.length)})? Ponowne wygenerowanie kosztuje w OpenAI.`,
        "Reset okładek AI"
      );
      if (!ok) return;
    }
    setMessage(null);
    setAlbumBusy([name, task]);
    try {
      switch (task) {
        case "mp3":
        case "wav":
          await downloadAlbum(name, list, task, mode, convert, setMessage);
          break;
        case "covers":
          await downloadAlbumCovers(name, list, selectedVariant, setMessage);
          break;
        case "lyrics":
          await downloadAlbumLyrics(name, list, setMessage);
          break;
        case "aicover": {
          const queued = await onGenerateAlbumCovers(name);
          setMessage(
            `Zlecono ${queued} ${queued === 1 ? "okładkę" : "okładek"} AI albumu „${name}” — pojawią się przy utworach`
          );
          break;
        }
        case "reset": {
          const count = await trackActions.onResetCovers(list.map((t) => t.id));
          setMessage(`Usunięto okładki AI albumu „${name}” (${count})`);
          break;
        }
      }
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setAlbumBusy(null);
    }
  }

  const playingId = playback?.queue[playback.index]?.trackId;

  return (
    <div className="view">
      {message &&
        (albumBusy ? (
          <p className="info info-loading">
            <Loader2 size={15} className="spin" /> {message}
          </p>
        ) : (
          <p className="info">{message}</p>
        ))}
      {groupSections(tracks).map((section) => {
        const isCollapsed = section.name !== null && collapsed.has(section.name);
        return (
          <section key={section.name ?? "__singles__"} className="album-group">
            {section.name !== null ? (
              <AlbumHeader
                name={section.name}
                tracks={section.tracks}
                collapsed={isCollapsed}
                mode={albumMode[section.name] ?? "both"}
                playback={playback}
                busy={albumBusy?.[0] === section.name ? albumBusy[1] : null}
                anyBusy={albumBusy !== null}
                onToggle={() => toggleCollapsed(section.name!)}
                onModeChange={(m) => setAlbumMode({ ...albumMode, [section.name!]: m })}
                onPlay={onPlay}
                onStopPlayback={onStopPlayback}
                onTask={(task) => void runAlbumTask(section.name!, section.tracks, task)}
                onSetCoverSource={trackActions.onSetCoverSource}
              />
            ) : (
              <div className="album-group-header">
                <strong>Pojedyncze utwory</strong>
                <span className="album-group-count">
                  {section.tracks.length} {plural(section.tracks.length)}
                </span>
              </div>
            )}
            {!isCollapsed && (
              <ul className="track-list">
                {section.tracks.map((track) => (
                  <TrackCard
                    key={track.id}
                    track={track}
                    now={now}
                    playing={playingId === track.id}
                    selectedIndex={variantIndex[track.id] ?? 0}
                    onSelectVariant={(i) => setVariantIndex({ ...variantIndex, [track.id]: i })}
                    report={setMessage}
                    {...trackActions}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
