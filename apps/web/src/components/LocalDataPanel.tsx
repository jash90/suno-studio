import { useEffect, useState } from "react";
import { Download, FolderOpen, Loader2 } from "lucide-react";
import platform from "@platform";
import type { LocalStudio } from "../data/local/LocalStudio";
import type { DesktopFeatures } from "../platform/types";

function formatBytes(bytes: number): string {
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/** Ustawienia (desktop) → dane na tym komputerze: gdzie leżą, ile zajmują, eksport. */
export default function LocalDataPanel({
  engine,
  desktop,
}: {
  engine: LocalStudio;
  desktop: DesktopFeatures;
}) {
  const [dir, setDir] = useState<string | null>(null);
  const [bytes, setBytes] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const files = engine.storedFiles();

  useEffect(() => {
    void desktop.dataDir().then(setDir);
  }, [desktop]);

  const fileKey = files.join("|");
  useEffect(() => {
    let cancelled = false;
    void Promise.all(fileKey ? fileKey.split("|").map((f) => desktop.fileSize(f)) : []).then(
      (sizes) => !cancelled && setBytes(sizes.reduce((a, b) => a + b, 0))
    );
    return () => {
      cancelled = true;
    };
  }, [fileKey, desktop]);

  async function exportJson() {
    setBusy(true);
    setMessage(null);
    try {
      await engine.flush();
      const data = engine.exportData();
      const date = new Date().toISOString().slice(0, 10);
      const location = await platform.saveFile(
        { data: new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }) },
        `suno-studio-eksport-${date}.json`
      );
      if (location) setMessage(`Zapisano eksport (${data.tracks.length} utworów) → ${location}`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h2>Dane na tym komputerze</h2>
      <p className="hint">
        Wersja desktopowa nie używa konta ani chmury — utwory, biblioteka, ustawienia i klucze API
        są zapisane lokalnie
        {dir ? (
          <>
            {" "}
            w <code>{dir}</code>
          </>
        ) : null}
        . Nagrania i okładki AI kopiujemy tam od razu po wygenerowaniu (Suno kasuje pliki po 14
        dniach): {files.length} plików{bytes !== null ? `, ${formatBytes(bytes)}` : ""}.
      </p>
      <div className="controls-row">
        <button onClick={() => void desktop.revealDataDir()}>
          <FolderOpen size={14} /> Pokaż w Finderze
        </button>
        <button onClick={exportJson} disabled={busy}>
          {busy ? <Loader2 size={14} className="spin" /> : <Download size={14} />} Eksport danych
          (JSON)
        </button>
      </div>
      <p className="hint">
        Kopia zapasowa: skopiuj cały folder danych. Eksport JSON nie zawiera kluczy API.
      </p>
      {message && <p className="info">{message}</p>}
    </>
  );
}
