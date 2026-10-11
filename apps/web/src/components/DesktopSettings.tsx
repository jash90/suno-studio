import { useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";
import type { DesktopFeatures } from "../platform/types";

/** Ustawienia tej maszyny (tylko desktop): domyślny folder zapisu. Trzymane
 *  lokalnie w powłoce, nie na koncie — ścieżki różnią się między komputerami. */
export default function DesktopSettings({ desktop }: { desktop: DesktopFeatures }) {
  const [dir, setDir] = useState<string | null>(null);

  useEffect(() => {
    void desktop.getDefaultSaveDir().then(setDir);
  }, [desktop]);

  async function change(next: string) {
    await desktop.setDefaultSaveDir(next);
    setDir(next);
  }

  async function pick() {
    const picked = await desktop.pickDirectory("Domyślny folder zapisu");
    if (picked) await change(picked);
  }

  return (
    <>
      <h2>Ten komputer</h2>
      <label>
        Domyślny folder zapisu
        <div className="key-row">
          <input
            value={dir ?? ""}
            placeholder="Nie ustawiono — przy każdym zapisie pojawi się okno wyboru"
            readOnly
          />
          <button className="btn-icon" type="button" title="Wybierz folder" onClick={pick}>
            <FolderOpen size={16} />
          </button>
        </div>
      </label>
      <p className="hint">
        Pliki i albumy zapisują się tu bez pytania (album trafia do podfolderu „Nazwa (A+B)”).
        {dir && (
          <>
            {" "}
            <button type="button" className="btn-link" onClick={() => void change("")}>
              Pytaj za każdym razem
            </button>
          </>
        )}
      </p>
    </>
  );
}
