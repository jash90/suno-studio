import { load, Store } from "@tauri-apps/plugin-store";
import {
  Album,
  DEFAULT_SETTINGS,
  guessDocKind,
  LibraryDoc,
  Persona,
  Settings,
  Track,
} from "../types";

let settingsStore: Store | null = null;
let historyStore: Store | null = null;

async function getSettingsStore(): Promise<Store> {
  if (!settingsStore) settingsStore = await load("settings.json");
  return settingsStore;
}

async function getHistoryStore(): Promise<Store> {
  if (!historyStore) historyStore = await load("history.json");
  return historyStore;
}

export async function loadSettings(): Promise<Settings> {
  const store = await getSettingsStore();
  const saved = await store.get<Partial<Settings>>("settings");
  return { ...DEFAULT_SETTINGS, ...saved };
}

export async function saveSettings(settings: Settings): Promise<void> {
  const store = await getSettingsStore();
  await store.set("settings", settings);
  await store.save();
}

export async function loadTracks(): Promise<Track[]> {
  const store = await getHistoryStore();
  return (await store.get<Track[]>("tracks")) ?? [];
}

export async function saveTracks(tracks: Track[]): Promise<void> {
  const store = await getHistoryStore();
  await store.set("tracks", tracks);
  await store.save();
}

let libraryStore: Store | null = null;

async function getLibraryStore(): Promise<Store> {
  if (!libraryStore) libraryStore = await load("library.json");
  return libraryStore;
}

export async function loadLibrary(): Promise<LibraryDoc[]> {
  const store = await getLibraryStore();
  const docs = (await store.get<LibraryDoc[]>("docs")) ?? [];
  // Migracja starych wpisów bez pola kind
  let migrated = false;
  for (const doc of docs) {
    if (!doc.kind) {
      doc.kind = guessDocKind(doc.name);
      migrated = true;
    }
  }
  if (migrated) await saveLibrary(docs);
  return docs;
}

export async function saveLibrary(docs: LibraryDoc[]): Promise<void> {
  const store = await getLibraryStore();
  await store.set("docs", docs);
  await store.save();
}

let personaStore: Store | null = null;

async function getPersonaStore(): Promise<Store> {
  if (!personaStore) personaStore = await load("personas.json");
  return personaStore;
}

export async function loadPersonas(): Promise<Persona[]> {
  const store = await getPersonaStore();
  return (await store.get<Persona[]>("personas")) ?? [];
}

export async function savePersonas(personas: Persona[]): Promise<void> {
  const store = await getPersonaStore();
  await store.set("personas", personas);
  await store.save();
}

// Jeden aktywny album — sekwencyjna generacja tekstów musi przeżyć restart
let albumStore: Store | null = null;

async function getAlbumStore(): Promise<Store> {
  if (!albumStore) albumStore = await load("album.json");
  return albumStore;
}

export async function loadAlbum(): Promise<Album | null> {
  const store = await getAlbumStore();
  return (await store.get<Album>("album")) ?? null;
}

export async function saveAlbum(album: Album | null): Promise<void> {
  const store = await getAlbumStore();
  if (album) await store.set("album", album);
  else await store.delete("album");
  await store.save();
}
