import { ArrowDown, ArrowUp, Disc3, Repeat, Shuffle, SkipBack, SkipForward, Square, X } from "lucide-react";
import Waveform from "../components/Waveform";
import { Playback } from "../types";

interface Props {
  playback: Playback | null;
  onSeekTo: (index: number) => void; // indeks spoza zakresu = stop / repeat
  onStop: () => void;
  onChange: (next: Playback | null) => void;
}

/** Zakładka Odtwarzacz: sterowanie, fala dźwięku i zarządzanie kolejką
 *  (usuwanie, przesuwanie, losowanie reszty, zapętlenie). */
export default function PlayerView({ playback, onSeekTo, onStop, onChange }: Props) {
  if (!playback) {
    return (
      <div className="view">
        <p className="empty">
          Nic nie gra — uruchom album przyciskiem „Odtwórz album" w Bibliotece
          albo dodaj utwory przyciskiem „Do kolejki".
        </p>
      </div>
    );
  }
  const { queue, index } = playback;
  const item = queue[index];

  function removeAt(i: number) {
    const next = queue.filter((_, j) => j !== i);
    if (next.length === 0) return onChange(null);
    let nextIndex = index;
    if (i < index) nextIndex--;
    else if (i === index && nextIndex >= next.length) nextIndex = next.length - 1;
    onChange({ ...playback!, queue: next, index: nextIndex });
  }

  function move(i: number, delta: -1 | 1) {
    const j = i + delta;
    if (j < 0 || j >= queue.length) return;
    const next = [...queue];
    [next[i], next[j]] = [next[j], next[i]];
    let nextIndex = index;
    if (i === index) nextIndex = j;
    else if (j === index) nextIndex = i;
    onChange({ ...playback!, queue: next, index: nextIndex });
  }

  /** Losuje kolejność pozycji PO bieżącej (odtworzone i bieżąca zostają). */
  function shuffleRest() {
    const rest = queue.slice(index + 1);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    onChange({ ...playback!, queue: [...queue.slice(0, index + 1), ...rest] });
  }

  return (
    <div className="view">
      <h2>
        <Disc3 size={14} /> {playback.name}
      </h2>
      <div className="album-player standalone">
        <div className="album-player-bar">
          <button
            className="btn-icon"
            title="Poprzedni"
            disabled={index === 0}
            onClick={() => onSeekTo(index - 1)}
          >
            <SkipBack size={16} />
          </button>
          <button className="btn-icon" title="Następny" onClick={() => onSeekTo(index + 1)}>
            <SkipForward size={16} />
          </button>
          <span className="album-player-now">
            {index + 1}/{queue.length} · {item.label}
          </span>
          <button
            className={`btn-icon${playback.repeat ? " accent" : ""}`}
            title={playback.repeat ? "Zapętlenie włączone" : "Zapętl kolejkę"}
            onClick={() => onChange({ ...playback, repeat: !playback.repeat })}
          >
            <Repeat size={15} />
          </button>
          <button
            className="btn-icon"
            title="Losuj kolejność pozostałych"
            disabled={queue.length - index < 3}
            onClick={shuffleRest}
          >
            <Shuffle size={15} />
          </button>
          <button className="btn-icon" title="Zatrzymaj i wyczyść" onClick={onStop}>
            <Square size={16} />
          </button>
        </div>
        <div className="album-player-bar">
          {/* klucz po URL: zmiana pozycji w kolejce nie restartuje bieżącego utworu */}
          <Waveform key={item.url} url={item.url} onFinish={() => onSeekTo(index + 1)} />
        </div>
        <ol className="album-queue open">
          {queue.map((q, i) => (
            <li key={i}>
              <button
                className={i === index ? "active" : ""}
                onClick={() => onSeekTo(i)}
              >
                {i === index ? "▸ " : ""}
                {q.label}
              </button>
              <span className="queue-item-actions">
                <button
                  className="btn-icon"
                  title="Przesuń w górę"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  <ArrowUp size={13} />
                </button>
                <button
                  className="btn-icon"
                  title="Przesuń w dół"
                  disabled={i === queue.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown size={13} />
                </button>
                <button
                  className="btn-icon"
                  title="Usuń z kolejki"
                  onClick={() => removeAt(i)}
                >
                  <X size={13} />
                </button>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
