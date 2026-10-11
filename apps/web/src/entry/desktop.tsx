import { useEffect, useState } from "react";
import { HashRouter } from "react-router-dom";
import platform from "@platform";
import Studio from "../app/Studio";
import DesktopSettings from "../components/DesktopSettings";
import LocalDataPanel from "../components/LocalDataPanel";
import { LocalStudio } from "../data/local/LocalStudio";
import { useLocalStudio } from "../data/local/useLocalStudio";

// Wersja desktopowa: bez konta i chmury — dane i cała logika lokalnie (LocalStudio).
// HashRouter: bundle ładowany z tauri://localhost, reload podścieżki nie trafiłby do index.html.

const desktop = platform.desktop!;
const engine = new LocalStudio(desktop);

function DesktopStudio() {
  const backend = useLocalStudio(engine);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    engine.load().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (error) {
    return (
      <div className="app-loading">
        <p className="error">Nie udało się wczytać danych: {error}</p>
      </div>
    );
  }
  return (
    <Studio
      backend={backend}
      settingsExtras={
        <>
          <DesktopSettings desktop={desktop} />
          <LocalDataPanel engine={engine} desktop={desktop} />
        </>
      }
    />
  );
}

export default function Root() {
  return (
    <HashRouter>
      <DesktopStudio />
    </HashRouter>
  );
}
