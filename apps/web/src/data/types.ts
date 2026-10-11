import type {
  Album,
  AlbumConcept,
  AlbumSong,
  Balances,
  DocKind,
  LibraryDoc,
  Persona,
  PersonaModel,
  Provider,
  Settings,
  SongDraft,
  SunoModel,
  Track,
} from "@suno/core";

// Źródło danych Studia. UI (app/Studio + widoki) zna tylko ten kontrakt:
//  - web: Convex (konto, dane w chmurze, logika w akcjach)  → data/convex.ts
//  - desktop: lokalny silnik (pliki w danych aplikacji, logika w procesie) → data/local/

export interface StudioData {
  settings: Settings;
  tracks: Track[];
  library: LibraryDoc[];
  personas: Persona[];
  album: Album | null;
}

export interface WriteSongParams {
  brief: string;
  useLibrary: boolean;
  excludedIds: string[];
  provider: Provider;
  sunoModel: SunoModel;
}

export interface GenerateMusicParams {
  draft: SongDraft;
  sunoModel: SunoModel;
  provider: Provider;
  instrumental: boolean;
  persona?: { id: string; model: PersonaModel; name: string };
  albumTitle?: string;
  albumIndex?: number;
}

export interface PlanAlbumParams {
  brief: string;
  songCount: number;
  provider: Provider;
  useLibrary: boolean;
  excludedIds: string[];
}

export interface WriteAlbumParams {
  provider: Provider;
  sunoModel: SunoModel;
  useLibrary: boolean;
  excludedIds: string[];
}

export interface StudioActions {
  saveSettings(settings: Settings): Promise<void>;
  fetchBalances(): Promise<Balances>;
  getCredits(sunoKey: string): Promise<number>;

  writeSong(params: WriteSongParams): Promise<{ draft: SongDraft; usedSources: string | null }>;
  startGeneration(params: GenerateMusicParams): Promise<string>;
  retryGeneration(trackId: string): Promise<void>;
  regenerateExpired(trackId: string): Promise<void>;
  convertToWav(trackId: string, audioId: string): Promise<string>;
  createPersona(trackId: string, audioId: string, name: string, description: string): Promise<void>;
  removeTrack(trackId: string): Promise<void>;

  setCoverSource(trackIds: string[], source: "suno" | "ai"): Promise<void>;
  generateCover(trackId: string): Promise<void>;
  /** Zleca brakujące okładki albumu (osobna per utwór); zwraca ich liczbę. */
  generateAlbumCovers(album: string): Promise<number>;
  resetCovers(trackIds: string[]): Promise<number>;

  planAlbum(params: PlanAlbumParams): Promise<AlbumConcept>;
  writeAlbumLyrics(params: WriteAlbumParams): Promise<void>;
  setAlbum(album: Album | null): Promise<void>;
  patchAlbumSong(index: number, patch: Partial<AlbumSong>): Promise<void>;

  addLibraryDocs(docs: LibraryDoc[]): Promise<void>;
  setDocKind(docId: string, kind: DocKind): Promise<void>;
  removeLibraryDoc(docId: string): Promise<void>;
}

export interface StudioBackend {
  /** undefined = jeszcze wczytywanie */
  data: StudioData | undefined;
  actions: StudioActions;
}
