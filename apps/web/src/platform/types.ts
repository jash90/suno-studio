// Kontrakt funkcji zależnych od platformy. Jedna implementacja trafia do bundla
// przez alias `@platform` (vite.config.ts): web.ts albo tauri.ts. Reszta UI zna
// wyłącznie ten interfejs — żadnych importów @tauri-apps/* poza platform/tauri.ts.

export interface BundleFile {
  /** Nazwa pliku w paczce, np. "01 - Tytuł (A).mp3". */
  name: string;
  /** Źródło: URL do pobrania albo gotowa treść (np. tekst piosenki). */
  url?: string;
  data?: Blob | string;
}

export interface BundleResult {
  saved: number;
  errors: string[];
  /** Gdzie trafiły pliki (ścieżka folderu / nazwa ZIP); null = anulowano. */
  location: string | null;
}

/** Dane z lokalnych plików starej aplikacji desktopowej (przed migracją na Convex). */
export interface LegacyDesktopData {
  settings: Record<string, unknown> | null;
  tracks: Record<string, unknown>[];
  library: Record<string, unknown>[];
  personas: Record<string, unknown>[];
  album: Record<string, unknown> | null;
  /** Okładki AI: aiImagePath (ścieżka z history.json) → plik PNG. */
  covers: Map<string, Blob>;
}

/** Funkcje dostępne tylko w powłoce desktopowej. */
export interface DesktopFeatures {
  /** Domyślny folder zapisu — ustawienie tej maszyny, nie konta (nie trafia do Convex). */
  getDefaultSaveDir(): Promise<string>;
  setDefaultSaveDir(dir: string): Promise<void>;
  pickDirectory(title: string): Promise<string | null>;
  /** Jednorazowy import danych z plików tauri-plugin-store sprzed migracji. */
  readLegacyData(): Promise<LegacyDesktopData | null>;
  markLegacyImported(): Promise<void>;
}

export interface Platform {
  kind: "web" | "desktop";
  /** Uruchamiane raz przy starcie (web: rejestracja service workera PWA). */
  init(): void;
  /** Token Convex Auth — web potrzebuje go dla proxy /download. */
  setAuthToken(token: string | null): void;
  /** Pobiera plik binarny (CDN Suno, Convex storage) z obejściem CORS. */
  fetchBlob(url: string): Promise<Blob>;
  /** Źródło dla odtwarzacza z falą (wavesurfer musi móc pobrać plik). */
  loadAudio(url: string): Promise<{ src: string; release: () => void }>;
  /** Zapisuje pojedynczy plik. Zwraca miejsce zapisu albo null, gdy anulowano. */
  saveFile(
    source: { url?: string; data?: Blob | string },
    fileName: string
  ): Promise<string | null>;
  /** Zapisuje wiele plików: web → jeden ZIP, desktop → folder `bundleName`. */
  saveBundle(
    files: BundleFile[],
    bundleName: string,
    onProgress?: (done: number, total: number) => void
  ): Promise<BundleResult>;
  confirm(message: string, title?: string): Promise<boolean>;
  desktop?: DesktopFeatures;
}
