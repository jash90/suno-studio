import { useEffect, useRef, useState } from "react";
import { Loader2, Pause, Play } from "lucide-react";
import WaveSurfer from "wavesurfer.js";

interface Props {
  url: string;
  onFinish: () => void; // koniec utworu albo błąd ładowania → następny w kolejce
}

function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Odtwarzacz z falą dźwięku (wavesurfer.js) — klik w falę przewija. */
export default function Waveform({ url, onFinish }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  // onFinish w ref — nie chcemy przebudowywać wavesurfera przy każdym renderze
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;
    const ws = WaveSurfer.create({
      container: containerRef.current,
      url,
      height: 52,
      waveColor: "#4d4347",
      progressColor: "#f0a03c",
      cursorColor: "#ffb95a",
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      autoplay: true,
    });
    wsRef.current = ws;
    ws.on("ready", () => {
      setLoading(false);
      setDuration(ws.getDuration());
    });
    ws.on("timeupdate", (t) => setTime(t));
    ws.on("play", () => setPlaying(true));
    ws.on("pause", () => setPlaying(false));
    ws.on("finish", () => onFinishRef.current());
    ws.on("error", () => onFinishRef.current());
    return () => ws.destroy();
  }, [url]);

  return (
    <>
      <button
        className="btn-icon"
        title={playing ? "Pauza" : "Odtwórz"}
        disabled={loading}
        onClick={() => void wsRef.current?.playPause()}
      >
        {loading ? (
          <Loader2 size={18} className="spin" />
        ) : playing ? (
          <Pause size={18} />
        ) : (
          <Play size={18} />
        )}
      </button>
      <span className="wave-time">{fmt(time)}</span>
      <div ref={containerRef} className="wave-canvas" />
      <span className="wave-time">{fmt(duration)}</span>
    </>
  );
}
