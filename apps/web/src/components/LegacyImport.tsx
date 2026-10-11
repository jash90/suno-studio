import { useEffect, useState } from "react";
import { DatabaseBackup, Loader2 } from "lucide-react";
import { useMutation } from "convex/react";
import { api } from "@suno/backend/api";
import type { Id } from "@suno/backend/dataModel";
import type { DesktopFeatures, LegacyDesktopData } from "../platform/types";

const TRACK_BATCH = 20;

/** Jednorazowy import danych starej wersji desktopowej (lokalne pliki) na konto.
 *  Widoczny tylko w powłoce desktopowej i tylko, gdy są dane do przeniesienia. */
export default function LegacyImport({ desktop }: { desktop: DesktopFeatures }) {
  const [data, setData] = useState<LegacyDesktopData | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const uploadUrl = useMutation(api.legacyImport.generateUploadUrl);
  const importBatch = useMutation(api.legacyImport.importBatch);

  useEffect(() => {
    void desktop
      .readLegacyData()
      .then(setData)
      .catch(() => setData(null));
  }, [desktop]);

  if (!data && !status) return null;

  async function run(legacy: LegacyDesktopData) {
    setBusy(true);
    try {
      const covers: { path: string; storageId: Id<"_storage"> }[] = [];
      let i = 0;
      for (const [path, blob] of legacy.covers) {
        setStatus(`Wgrywanie okładek AI: ${++i}/${legacy.covers.size}`);
        const res = await fetch(await uploadUrl({}), {
          method: "POST",
          headers: { "Content-Type": blob.type || "image/png" },
          body: blob,
        });
        if (!res.ok) throw new Error(`Wgrywanie okładki nie powiodło się (HTTP ${res.status})`);
        const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
        covers.push({ path, storageId });
      }

      setStatus("Import ustawień, biblioteki i albumu...");
      const first = await importBatch({
        settings: legacy.settings ?? undefined,
        library: legacy.library,
        personas: legacy.personas,
        album: legacy.album ?? undefined,
      });
      let tracks = 0;
      for (let start = 0; start < legacy.tracks.length; start += TRACK_BATCH) {
        setStatus(`Import utworów: ${start}/${legacy.tracks.length}`);
        const batch = legacy.tracks.slice(start, start + TRACK_BATCH);
        // okładki tylko dla utworów z tej partii — mutacja dostaje mniej argumentów
        const paths = new Set(batch.map((t) => t.aiImagePath));
        const res = await importBatch({
          tracks: batch,
          covers: covers.filter((c) => paths.has(c.path)),
        });
        tracks += res.tracks;
      }
      await desktop.markLegacyImported();
      setData(null);
      setStatus(
        `Przeniesiono: ${tracks} utworów, ${first.library} plików biblioteki, ` +
          `${first.personas} person${first.album ? ", aktywny album" : ""}` +
          `${first.settings ? ", ustawienia" : ""}. Wygasłe nagrania można przegenerować w Bibliotece.`
      );
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h2>Dane z poprzedniej wersji</h2>
      {data && (
        <>
          <p className="hint">
            Na tym komputerze są dane starej aplikacji desktopowej: {data.tracks.length} utworów,{" "}
            {data.library.length} plików biblioteki, {data.covers.size} okładek AI
            {data.album ? ", aktywny album" : ""}. Import przeniesie je na Twoje konto (puste pola
            ustawień uzupełni kluczami z desktopu). Można go bezpiecznie powtórzyć.
          </p>
          <button className="btn-primary" disabled={busy} onClick={() => void run(data)}>
            {busy ? <Loader2 size={14} className="spin" /> : <DatabaseBackup size={14} />} Importuj
            dane lokalne
          </button>
        </>
      )}
      {status && <p className="info">{status}</p>}
    </>
  );
}
