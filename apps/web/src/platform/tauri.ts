import { confirm as askConfirm, open, save } from "@tauri-apps/plugin-dialog";
import { exists, mkdir, readFile, writeFile } from "@tauri-apps/plugin-fs";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { load, Store } from "@tauri-apps/plugin-store";
import { sanitizeFileName } from "@suno/core";
import { withBusy } from "./busy";
import type { BundleFile, LegacyDesktopData, Platform } from "./types";

// Powłoka desktopowa (apps/desktop). Pobieranie idzie przez plugin-http (proces Rust)
// — webview nie dostaje nagłówków CORS ze wszystkich CDN-ów Suno; zapis bezpośrednio
// na dysk (domyślny folder albo dialog), album → podfolder zamiast ZIP-a.

let deviceStore: Store | null = null;
async function device(): Promise<Store> {
  if (!deviceStore) deviceStore = await load("device.json");
  return deviceStore;
}

async function fetchBlob(url: string): Promise<Blob> {
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
  const store = await device();
  const dir = await store.get<string>("defaultSaveDir");
  if (dir !== undefined) return dir;
  // pierwsze uruchomienie po migracji — przejmij folder z dawnych ustawień
  const legacy = await (await load("settings.json")).get<{ defaultSaveDir?: string }>("settings");
  return legacy?.defaultSaveDir ?? "";
}

function extension(name: string): string {
  return name.split(".").pop() ?? "";
}

async function readJson<T>(file: string, key: string): Promise<T | undefined> {
  return (await load(file)).get<T>(key);
}

const tauriPlatform: Platform = {
  kind: "desktop",

  init() {},

  setAuthToken() {
    // plugin-http nie potrzebuje proxy Convex — token zbędny
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
        (await open({ directory: true, title: `Gdzie zapisać „${bundleName}”` }));
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

  desktop: {
    getDefaultSaveDir,

    async setDefaultSaveDir(dir) {
      const store = await device();
      await store.set("defaultSaveDir", dir);
      await store.save();
    },

    async pickDirectory(title) {
      const dir = await open({ directory: true, title });
      return typeof dir === "string" ? dir : null;
    },

    async readLegacyData(): Promise<LegacyDesktopData | null> {
      if (await (await device()).get<boolean>("legacyImported")) return null;
      const tracks = (await readJson<Record<string, unknown>[]>("history.json", "tracks")) ?? [];
      const library = (await readJson<Record<string, unknown>[]>("library.json", "docs")) ?? [];
      const personas =
        (await readJson<Record<string, unknown>[]>("personas.json", "personas")) ?? [];
      const album = (await readJson<Record<string, unknown>>("album.json", "album")) ?? null;
      const settings =
        (await readJson<Record<string, unknown>>("settings.json", "settings")) ?? null;
      if (!tracks.length && !library.length && !personas.length && !album) return null;

      const covers = new Map<string, Blob>();
      for (const track of tracks) {
        const path = track.aiImagePath;
        if (typeof path !== "string" || covers.has(path)) continue;
        try {
          if (await exists(path)) {
            covers.set(path, new Blob([await readFile(path)], { type: "image/png" }));
          }
        } catch {
          // brak pliku okładki — utwór zaimportuje się z okładką Suno
        }
      }
      return { settings, tracks, library, personas, album, covers };
    },

    async markLegacyImported() {
      const store = await device();
      await store.set("legacyImported", true);
      await store.save();
    },
  },
};

export default tauriPlatform;
