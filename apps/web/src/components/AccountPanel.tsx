import { useState } from "react";
import { Download, Loader2, Trash2 } from "lucide-react";
import { useConvex, useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@suno/backend/api";
import platform from "@platform";

// Plan Free Convex: 1 GB storage — archiwum audio szybko go zapełnia
const STORAGE_QUOTA_BYTES = 1024 ** 3;

const USAGE_LABELS: Record<string, string> = {
  lyrics: "teksty (LLM)",
  music: "generacje Suno",
  cover: "okładki AI",
  wav: "konwersje WAV",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/** Ustawienia → Konto: archiwum, zużycie, eksport danych, usunięcie konta. */
export default function AccountPanel() {
  const overview = useQuery(api.account.overview);
  const convex = useConvex();
  const deleteAccount = useMutation(api.account.deleteAccount);
  const { signOut } = useAuthActions();
  const [busy, setBusy] = useState<"export" | "delete" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");

  async function exportJson() {
    setBusy("export");
    setMessage(null);
    try {
      const data = await convex.query(api.account.exportData, {});
      const date = new Date().toISOString().slice(0, 10);
      const location = await platform.saveFile(
        { data: new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }) },
        `suno-studio-eksport-${date}.json`
      );
      if (location) setMessage(`Zapisano eksport (${data.tracks.length} utworów) → ${location}`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function removeAccount() {
    const ok = await platform.confirm(
      "Konto, wszystkie utwory, pliki w archiwum, biblioteka i ustawienia zostaną trwale usunięte. Kontynuować?",
      "Usunięcie konta"
    );
    if (!ok) return;
    setBusy("delete");
    try {
      await deleteAccount({ confirm: confirmText });
      await signOut();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  const usedPercent = overview ? (overview.storageBytes / STORAGE_QUOTA_BYTES) * 100 : 0;

  return (
    <>
      <h2>Konto</h2>
      {overview ? (
        <>
          <p className="hint">
            Archiwum audio i okładek: <strong>{formatBytes(overview.storageBytes)}</strong> (
            {overview.storedFiles} plików, {overview.tracks} utworów) —{" "}
            {usedPercent.toFixed(usedPercent < 10 ? 1 : 0)}% z 1 GB planu Free Convex.
            {usedPercent > 80 &&
              " Zbliżasz się do limitu — rozważ plan płatny Convex albo usunięcie starych utworów."}
          </p>
          <p className="hint">
            Ostatnie 30 dni:{" "}
            {Object.entries(overview.usage30d)
              .map(([kind, count]) => `${USAGE_LABELS[kind] ?? kind}: ${count}`)
              .join(" · ")}
          </p>
        </>
      ) : (
        <p className="hint">Wczytywanie...</p>
      )}
      <div className="controls-row">
        <button onClick={exportJson} disabled={busy !== null}>
          {busy === "export" ? <Loader2 size={14} className="spin" /> : <Download size={14} />}{" "}
          Eksport danych (JSON)
        </button>
      </div>
      <p className="hint">
        Eksport zawiera utwory, teksty, bibliotekę, persony i ustawienia — bez kluczy API. Pliki
        audio pobierzesz z Biblioteki (MP3/WAV całego albumu).
      </p>
      <label>
        Usunięcie konta — wpisz USUŃ, aby potwierdzić
        <div className="key-row">
          <input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="USUŃ"
            autoComplete="off"
          />
          <button
            className="btn-danger"
            disabled={confirmText !== "USUŃ" || busy !== null}
            onClick={removeAccount}
          >
            {busy === "delete" ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />} Usuń
            konto
          </button>
        </div>
      </label>
      {message && <p className="info">{message}</p>}
    </>
  );
}
