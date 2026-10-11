import { convertFileSrc } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import { confirm as askConfirm, open, save } from "@tauri-apps/plugin-dialog";
import { mkdir, readFile, remove, stat, writeFile } from "@tauri-apps/plugin-fs";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { load, Store } from "@tauri-apps/plugin-store";
import { check } from "@tauri-apps/plugin-updater";
import { sanitizeFileName } from "@suno/core";
import { withBusy } from "./busy";
import type { BundleFile, DesktopFeatures, Platform } from "./types";

// Powłoka desktopowa (apps/desktop). Dane studia leżą lokalnie (data/local/LocalStudio):
// pliki JSON tauri-plugin-store + audio/ i covers/ w katalogu danych aplikacji.
// Sieć przez plugin-http (proces Rust) — bez CORS; zapis plików bezpośrednio na dysk.

const stores = new Map<string, Promise<Store>>();
function store(file: string): Promise<Store> {
  if (!stores.has(file)) stores.set(file, load(file));
  return stores.get(file)!;
}

/** Ścieżka pliku z adresu protokołu asset (convertFileSrc) albo null. */
function assetPath(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "asset:" && u.hostname !== "asset.localhost") return null;
    return decodeURIComponent(u.pathname.slice(1));
  } catch {
    return null;
  }
}

async function fetchBlob(url: string): Promise<Blob> {
  // pliki z archiwum na dysku — czytamy wprost, bez HTTP
  const local = assetPath(url);
  if (local) return new Blob([await readFile(local)]);
  const res = await tauriFetch(url);
  if (!res.ok) throw new Error(`Pobieranie nie powiodło się (HTTP ${res.status})`);
  return new Blob([await res.arrayBuffer()], {
    type: res.headers.get("content-type") ?? "application/octet-stream",
  });
}

async function toBytes(source: { url?: string; data?: Blob | string }): Promise<Uint8Array> {
  if (typeof source.data === "string") return new TextEncoder().encode(source.data);
  const blob = source.data ?? (source.url ? await fetchBlob(source.url) : null);
  if (!blob) throw new Error("brak pliku");
  return new Uint8Array(await blob.arrayBuffer());
}

async function getDefaultSaveDir(): Promise<string> {
  const dir = await (await store("device.json")).get<string>("defaultSaveDir");
  if (dir !== undefined) return dir;
  // dawna wersja desktopowa trzymała folder w ustawieniach
  const legacy = await (await store("settings.json")).get<{ defaultSaveDir?: string }>("settings");
  return legacy?.defaultSaveDir ?? "";
}

function extension(name: string): string {
  return name.split(".").pop() ?? "";
}

/** Sprawdza GitHub Releases; po zgodzie użytkownika instaluje i restartuje aplikację.
 *  Brak sieci / brak wydań nie przeszkadza w pracy — błąd tylko w konsoli. */
async function checkForUpdate() {
  try {
    const update = await check();
    if (!update) return;
    const ok = await askConfirm(
      `Dostępna jest nowa wersja Suno Studio (${update.version}). Zainstalować teraz?` +
        (update.body ? `\n\n${update.body}` : ""),
      { title: "Aktualizacja", kind: "info" }
    );
    if (!ok) return;
    await update.downloadAndInstall();
    await relaunch();
  } catch (e) {
    console.warn("Sprawdzanie aktualizacji nie powiodło się:", e);
  }
}

const desktop: DesktopFeatures = {
  http: (input, init) => tauriFetch(input, init),

  async readStore<T>(file: string, key: string) {
    return (await store(file)).get<T>(key);
  },

  async writeStore(file, key, value) {
    const s = await store(file);
    await s.set(key, value);
    await s.save();
  },

  async writeDataFile(relativePath, data) {
    const path = await join(await appDataDir(), relativePath);
    const dir = path.slice(0, path.lastIndexOf("/"));
    await mkdir(dir, { recursive: true });
    await writeFile(path, new Uint8Array(await data.arrayBuffer()));
    return path;
  },

  async removeFile(path) {
    await remove(path);
  },

  fileUrl: (path) => convertFileSrc(path),

  dataDir: () => appDataDir(),

  async fileSize(path) {
    try {
      return (await stat(path)).size;
    } catch {
      return 0;
    }
  },

  async revealDataDir() {
    await revealItemInDir(await join(await appDataDir(), "history.json"));
  },

  getDefaultSaveDir,

  async setDefaultSaveDir(dir) {
    const s = await store("device.json");
    await s.set("defaultSaveDir", dir);
    await s.save();
  },

  async pickDirectory(title) {
    const dir = await open({ directory: true, recursive: true, title });
    return typeof dir === "string" ? dir : null;
  },
};

const tauriPlatform: Platform = {
  kind: "desktop",

  init() {
    if (import.meta.env.PROD) void checkForUpdate();
  },

  setAuthToken() {
    // desktop nie używa Convex — brak tokenu
  },

  fetchBlob,

  async loadAudio(url) {
    const objectUrl = URL.createObjectURL(await fetchBlob(url));
    return { src: objectUrl, release: () => URL.revokeObjectURL(objectUrl) };
  },

  async saveFile(source, fileName) {
    const dir = await getDefaultSaveDir();
    const ext = extension(fileName);
    const path =
      (dir ? `${dir}/${fileName}` : null) ??
      (await save({
        defaultPath: fileName,
        filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : undefined,
      }));
    if (!path) return null;
    await writeFile(path, await toBytes(source));
    return path;
  },

  saveBundle(files: BundleFile[], bundleName, onProgress) {
    return withBusy(async () => {
      const parent =
        (await getDefaultSaveDir()) ||
        (await open({ directory: true, recursive: true, title: `Gdzie zapisać „${bundleName}”` }));
      if (!parent || Array.isArray(parent)) return { saved: 0, errors: [], location: null };
      const dir = `${parent}/${sanitizeFileName(bundleName)}`;
      await mkdir(dir, { recursive: true });
      const errors: string[] = [];
      let saved = 0;
      for (let i = 0; i < files.length; i++) {
        onProgress?.(i, files.length);
        try {
          await writeFile(`${dir}/${files[i].name}`, await toBytes(files[i]));
          saved++;
        } catch (e) {
          errors.push(`${files[i].name}: ${e instanceof Error ? e.message : e}`);
        }
      }
      onProgress?.(files.length, files.length);
      return { saved, errors, location: dir };
    });
  },

  confirm(message, title) {
    return askConfirm(message, { title: title ?? "Suno Studio", kind: "warning" });
  },

  desktop,
};

export default tauriPlatform;
