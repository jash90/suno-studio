import {
  activeDocs,
  AlbumSong,
  albumSongBrief,
  albumSongContext,
  canRegenerate,
  coverPrompt,
  createSunoPersona,
  createTask,
  DocKind,
  fetchArchiveSource,
  fetchBalances,
  freshAttempt,
  generateAlbumConcept,
  generateCoverImage,
  generateSong,
  getSunoCredits,
  getTaskStatus,
  getVariants,
  guessDocKind,
  guidesFor,
  IN_PROGRESS_STATUSES,
  LibraryDoc,
  patchVariant,
  Persona,
  PersonaModel,
  personaOf,
  runWavConversion,
  sanitizeAlbum,
  sanitizeSettings,
  songContext,
  songsToWrite,
  Track,
  TrackVariant,
  withoutAiCover,
  type FetchFn,
} from "@suno/core";
import type { StudioActions, StudioData } from "../types";

// Silnik desktopu: to, co na webie robi backend Convex, tu dzieje się w procesie
// aplikacji, a dane leżą w plikach w katalogu danych aplikacji — te same pliki
// (settings/history/library/personas/album.json), których używała dawna wersja
// desktopowa, więc stare dane są od razu widoczne. Pliki audio i okładki AI trafiają
// do audio/ i covers/ obok — ścieżka pliku siedzi w polach *StorageId (jak id pliku
// w Convex storage na webie), a *Url to adres do odtwarzania z dysku.

export interface LocalIO {
  /** HTTP bez CORS (plugin-http). */
  http: FetchFn;
  readStore<T>(file: string, key: string): Promise<T | undefined>;
  writeStore(file: string, key: string, value: unknown): Promise<void>;
  /** Zapis w katalogu danych aplikacji; zwraca ścieżkę bezwzględną. */
  writeDataFile(relativePath: string, data: Blob): Promise<string>;
  removeFile(path: string): Promise<void>;
  /** Adres pliku z dysku do <audio>/<img> (protokół asset). */
  fileUrl(path: string): string;
}

export interface LocalTimings {
  pollMs: number;
  /** jak długo czekać na Suno od startu generacji */
  pollDeadlineMs: number;
  archiveRetryMs: number;
  wavPollMs: number;
}

const DEFAULT_TIMINGS: LocalTimings = {
  pollMs: 10_000,
  pollDeadlineMs: 10 * 60_000,
  archiveRetryMs: 60_000,
  wavPollMs: 5_000,
};

const FILES = {
  settings: ["settings.json", "settings"],
  tracks: ["history.json", "tracks"],
  library: ["library.json", "docs"],
  personas: ["personas.json", "personas"],
  album: ["album.json", "album"],
} as const;

type Collection = keyof typeof FILES;

/** Stary wpis desktopu: okładka AI jako aiImagePath. */
type StoredTrack = Track & { aiImagePath?: string };

export class LocalStudio {
  private state: StudioData | undefined;
  private listeners = new Set<() => void>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** pola ustawień spoza modelu (np. defaultSaveDir starego desktopu) — nie gubimy ich */
  private extraSettings: Record<string, unknown> = {};
  private writes: Promise<void> = Promise.resolve();
  private disposed = false;

  readonly actions: StudioActions;

  constructor(
    private io: LocalIO,
    private timings: LocalTimings = DEFAULT_TIMINGS
  ) {
    this.actions = this.createActions();
  }

  // --- stan i trwałość ---------------------------------------------------------

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.state;

  private get data(): StudioData {
    if (!this.state) throw new Error("Dane jeszcze się wczytują");
    return this.state;
  }

  async load(): Promise<void> {
    const rawSettings = (await this.read<Record<string, unknown>>("settings")) ?? {};
    const settings = sanitizeSettings(rawSettings);
    this.extraSettings = Object.fromEntries(
      Object.entries(rawSettings).filter(([k]) => !(k in settings))
    );
    const tracks = ((await this.read<StoredTrack[]>("tracks")) ?? []).map((t) =>
      this.hydrateTrack(t)
    );
    const library = ((await this.read<LibraryDoc[]>("library")) ?? []).map((d) => ({
      ...d,
      kind: d.kind ?? guessDocKind(d.name),
    }));
    const personas = (await this.read<Persona[]>("personas")) ?? [];
    const album = sanitizeAlbum(await this.read("album"));
    this.state = { settings, tracks: sortTracks(tracks), library, personas, album };
    this.emit();
    this.resumeBackgroundWork();
  }

  /** Zatrzymuje timery (zamknięcie okna / testy). */
  dispose() {
    this.disposed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  /** Czeka na zapis wszystkich zmian na dysk (testy, eksport). */
  flush(): Promise<void> {
    return this.writes;
  }

  private read<T>(collection: Collection): Promise<T | undefined> {
    const [file, key] = FILES[collection];
    return this.io.readStore<T>(file, key);
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }

  /** Zmienia stan, powiadamia UI i dopisuje zapis kolekcji do kolejki (bez wyścigów). */
  private update(collection: Collection, change: (data: StudioData) => Partial<StudioData>) {
    this.state = { ...this.data, ...change(this.data) };
    this.emit();
    const [file, key] = FILES[collection];
    const value =
      collection === "settings"
        ? { ...this.extraSettings, ...this.data.settings }
        : collection === "tracks"
          ? this.data.tracks.map(dehydrateTrack)
          : this.data[collection];
    this.writes = this.writes
      .then(() => this.io.writeStore(file, key, value))
      .catch((e) => console.error(`Zapis ${file} nie powiódł się`, e));
  }

  private track(id: string): Track | undefined {
    return this.data.tracks.find((t) => t.id === id);
  }

  private setTrack(id: string, change: (track: Track) => Track | null) {
    this.update("tracks", (d) => ({
      tracks: d.tracks.map((t) => (t.id === id ? (change(t) ?? t) : t)),
    }));
  }

  /** Ścieżki z dysku → adresy do odtwarzania; migracja aiImagePath starego desktopu. */
  private hydrateTrack(stored: StoredTrack): Track {
    const { aiImagePath, ...track } = stored;
    const coverPath = track.aiImageStorageId ?? aiImagePath;
    const next: Track = { ...track };
    if (coverPath) {
      next.aiImageStorageId = coverPath;
      next.aiImageUrl = this.io.fileUrl(coverPath);
    }
    if (track.variants) {
      next.variants = track.variants.map((v) => ({
        ...v,
        ...(v.audioStorageId ? { audioUrl: this.io.fileUrl(v.audioStorageId) } : {}),
        ...(v.wavStorageId ? { wavUrl: this.io.fileUrl(v.wavStorageId) } : {}),
      }));
      const first = next.variants.find((v) => v.audioId === track.audioId);
      if (first) {
        next.audioUrl = first.audioUrl;
        next.wavUrl = first.wavUrl;
      }
    }
    // okładka AI wybrana, ale plik zniknął → wracamy do okładki Suno
    if (next.coverSource === "ai" && !next.aiImageUrl) delete next.coverSource;
    return next;
  }

  private requireSuno(): string {
    const key = this.data.settings.sunoKey;
    if (!key) throw new Error("Brak klucza sunoapi.org — uzupełnij w Ustawieniach");
    return key;
  }

  // --- generacja i polling --------------------------------------------------------

  private schedule(key: string, delayMs: number, work: () => Promise<void>) {
    if (this.disposed) return;
    clearTimeout(this.timers.get(key));
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        void work().catch((e) => console.error(key, e));
      }, delayMs)
    );
  }

  private startPolling(trackId: string, delayMs = 0) {
    this.schedule(`poll:${trackId}`, delayMs, () => this.poll(trackId));
  }

  /** Jeden krok pollingu: status z Suno → utwór; SUCCESS → archiwizacja na dysk. */
  private async poll(trackId: string) {
    const track = this.track(trackId);
    if (!track || !IN_PROGRESS_STATUSES.includes(track.status)) return;
    const startedAt = new Date(track.generatedAt ?? track.createdAt).getTime();
    const overdue = Date.now() - startedAt > this.timings.pollDeadlineMs;
    try {
      const update = await getTaskStatus(this.io.http, this.requireSuno(), track.taskId);
      this.setTrack(trackId, (t) =>
        t.taskId === track.taskId && IN_PROGRESS_STATUSES.includes(t.status)
          ? { ...t, ...update }
          : null
      );
      if (update.status === "SUCCESS") return this.scheduleArchive(trackId, 0);
      if (update.status === "FAILED") return;
    } catch {
      // chwilowy błąd sieci — próbujemy dalej (do terminu)
    }
    if (overdue) {
      this.setTrack(trackId, (t) =>
        IN_PROGRESS_STATUSES.includes(t.status)
          ? { ...t, status: "FAILED", error: "Przekroczono czas oczekiwania (10 min)" }
          : null
      );
      return;
    }
    this.startPolling(trackId, this.timings.pollMs);
  }

  /** Po starcie: dokończ generacje (Suno mogło skończyć przy zamkniętej aplikacji)
   *  i zarchiwizuj na dysk pliki, które jeszcze są tylko w CDN Suno. */
  private resumeBackgroundWork() {
    for (const track of this.data.tracks) {
      if (IN_PROGRESS_STATUSES.includes(track.status)) this.startPolling(track.id);
      else if (track.status === "SUCCESS" && needsArchive(track)) this.scheduleArchive(track.id, 0);
      if (track.coverStatus === "pending") {
        this.setTrack(track.id, (t) => ({ ...t, coverStatus: undefined }));
      }
    }
  }

  private scheduleArchive(trackId: string, attempt: number) {
    this.schedule(
      `archive:${trackId}`,
      attempt === 0 ? 0 : this.timings.archiveRetryMs * attempt,
      () => this.archive(trackId, attempt)
    );
  }

  /** Kopiuje MP3 wariantów na dysk (Suno kasuje pliki po 14 dniach). */
  private async archive(trackId: string, attempt: number) {
    const start = this.track(trackId);
    if (!start || start.status !== "SUCCESS") return;
    // stare wpisy z polami płaskimi → wariant A
    if (!start.variants?.length && start.audioId) {
      this.setTrack(trackId, (t) => ({ ...t, variants: getVariants(t) }));
    }
    let retry = false;
    for (const variant of this.track(trackId)?.variants ?? []) {
      if (!variant.audioUrl || variant.audioStorageId || variant.audioExpired) continue;
      const got = await fetchArchiveSource(this.io.http, variant.audioUrl, start);
      if ("blob" in got) {
        const path = await this.io.writeDataFile(
          `audio/${trackId}-${variant.audioId}.mp3`,
          got.blob
        );
        if (!this.track(trackId)) {
          await this.io.removeFile(path); // usunięty w trakcie pobierania
          return;
        }
        this.setTrack(trackId, (t) =>
          patchVariant(t, variant.audioId, {
            audioStorageId: path,
            audioUrl: this.io.fileUrl(path),
            sourceAudioUrl: variant.audioUrl,
          })
        );
      } else if ("gone" in got) {
        this.setTrack(trackId, (t) =>
          patchVariant(
            t,
            variant.audioId,
            { audioExpired: true, sourceAudioUrl: variant.audioUrl },
            ["audioUrl", "streamAudioUrl"]
          )
        );
      } else {
        retry = true;
      }
    }
    if (retry && attempt + 1 < 5) this.scheduleArchive(trackId, attempt + 1);
  }

  private async archiveWav(trackId: string, audioId: string, url: string) {
    const track = this.track(trackId);
    if (!track) return;
    const got = await fetchArchiveSource(this.io.http, url, track);
    if (!("blob" in got)) return; // link Suno zostaje — można pobrać ponownie
    const path = await this.io.writeDataFile(`audio/${trackId}-${audioId}.wav`, got.blob);
    if (!this.track(trackId)) return void (await this.io.removeFile(path));
    this.setTrack(trackId, (t) =>
      patchVariant(t, audioId, {
        wavStorageId: path,
        wavUrl: this.io.fileUrl(path),
        sourceWavUrl: url,
      })
    );
  }

  /** Kasuje plik okładki, jeśli żaden inny utwór go nie używa (stare wspólne okładki albumu). */
  private async releaseCover(path: string, exceptIds: string[]) {
    const used = this.data.tracks.some(
      (t) => !exceptIds.includes(t.id) && t.aiImageStorageId === path
    );
    if (!used) await this.io.removeFile(path).catch(() => {});
  }

  private async coverFor(trackId: string, onlyIfPending: boolean) {
    const track = this.track(trackId);
    if (!track) throw new Error("Nie znaleziono utworu");
    const blob = await generateCoverImage(
      this.io.http,
      this.data.settings.openaiKey,
      coverPrompt(track)
    );
    const path = await this.io.writeDataFile(`covers/${trackId}-${Date.now()}.png`, blob);
    const current = this.track(trackId);
    // utwór usunięty albo reset okładek w trakcie generacji → plik do kosza
    if (!current || (onlyIfPending && current.coverStatus !== "pending")) {
      await this.io.removeFile(path);
      return;
    }
    const previous = current.aiImageStorageId;
    this.setTrack(trackId, (t) => ({
      ...t,
      aiImageStorageId: path,
      aiImageUrl: this.io.fileUrl(path),
      coverSource: "ai",
      coverStatus: undefined,
      coverError: undefined,
    }));
    if (previous && previous !== path) await this.releaseCover(previous, []);
  }

  private async newTask(
    track: Pick<Track, "title" | "style" | "lyrics" | "sunoModel" | "instrumental">,
    persona?: { id: string; model: PersonaModel }
  ) {
    return createTask(
      this.io.http,
      this.requireSuno(),
      { title: track.title, style: track.style, lyrics: track.lyrics },
      track.sunoModel,
      track.instrumental,
      persona
    );
  }

  // --- akcje dla UI ---------------------------------------------------------------

  private createActions(): StudioActions {
    return {
      saveSettings: async (settings) => {
        this.update("settings", () => ({ settings: sanitizeSettings(settings) }));
      },

      fetchBalances: () => fetchBalances(this.io.http, this.data.settings),

      getCredits: (sunoKey) => getSunoCredits(this.io.http, sunoKey || this.requireSuno()),

      writeSong: async ({ brief, useLibrary, excludedIds, provider, sunoModel }) => {
        const docs = activeDocs(this.data.library, useLibrary, excludedIds);
        const { context, guides, usedSources } = songContext(docs, brief);
        const draft = await generateSong(
          this.io.http,
          provider,
          this.data.settings,
          context,
          guides,
          brief,
          sunoModel
        );
        return { draft, usedSources };
      },

      startGeneration: async (p) => {
        const taskId = await this.newTask(
          { ...p.draft, sunoModel: p.sunoModel, instrumental: p.instrumental },
          p.persona ? { id: p.persona.id, model: p.persona.model } : undefined
        );
        const now = new Date().toISOString();
        const track: Track = {
          id: crypto.randomUUID(),
          taskId,
          title: p.draft.title,
          style: p.draft.style,
          lyrics: p.draft.lyrics,
          sunoModel: p.sunoModel,
          provider: p.provider,
          instrumental: p.instrumental,
          personaUsed: p.persona?.name,
          personaId: p.persona?.id,
          personaModel: p.persona?.model,
          album: p.albumTitle,
          albumIndex: p.albumIndex,
          status: "PENDING",
          createdAt: now,
          generatedAt: now,
        };
        this.update("tracks", (d) => ({ tracks: [track, ...d.tracks] }));
        this.startPolling(track.id, this.timings.pollMs);
        return track.id;
      },

      retryGeneration: async (id) => {
        const track = this.track(id);
        if (!track) throw new Error("Nie znaleziono utworu");
        if (track.status !== "FAILED") throw new Error("Ponowić można tylko nieudaną generację");
        const taskId = await this.newTask(track, personaOf(track));
        this.setTrack(id, (t) => freshAttempt(t, taskId));
        this.startPolling(id, this.timings.pollMs);
      },

      regenerateExpired: async (id) => {
        const previous = this.track(id);
        if (!previous) throw new Error("Nie znaleziono utworu");
        if (!canRegenerate(previous)) {
          throw new Error(
            previous.status === "SUCCESS"
              ? "Ten utwór ma jeszcze dostępne audio — nie trzeba go przegenerowywać"
              : "Utwór jest już generowany"
          );
        }
        // zajęcie przed wywołaniem Suno — drugi klik nie zleci drugiego taska
        this.setTrack(id, (t) => ({ ...t, status: "PENDING" }));
        let taskId: string;
        try {
          taskId = await this.newTask(previous, personaOf(previous));
        } catch (e) {
          this.setTrack(id, () => previous);
          throw e;
        }
        this.setTrack(id, () => ({
          ...freshAttempt(previous, taskId),
          previousTaskIds: [...(previous.previousTaskIds ?? []), previous.taskId],
        }));
        this.startPolling(id, this.timings.pollMs);
      },

      convertToWav: async (id, audioId) => {
        const track = this.track(id);
        if (!track) throw new Error("Nie znaleziono utworu");
        const existing = track.variants?.find((v) => v.audioId === audioId)?.wavUrl;
        if (existing) return existing;
        const url = await runWavConversion(
          this.io.http,
          this.requireSuno(),
          track.taskId,
          audioId,
          this.timings.wavPollMs
        );
        this.setTrack(id, (t) => patchVariant(t, audioId, { wavUrl: url }));
        // kopia na dysk w tle — UI zapisuje od razu z linku Suno
        void this.archiveWav(id, audioId, url).catch((e) => console.error("archiwizacja WAV", e));
        return url;
      },

      createPersona: async (id, audioId, name, description) => {
        const track = this.track(id);
        if (!track) throw new Error("Nie znaleziono utworu");
        const personaId = await createSunoPersona(this.io.http, this.requireSuno(), {
          taskId: track.taskId,
          audioId,
          name,
          description,
        });
        const persona: Persona = {
          id: personaId,
          name,
          description,
          sourceTrackTitle: track.title,
          createdAt: new Date().toISOString(),
        };
        this.update("personas", (d) => ({ personas: [persona, ...d.personas] }));
      },

      removeTrack: async (id) => {
        const track = this.track(id);
        if (!track) return;
        clearTimeout(this.timers.get(`poll:${id}`));
        this.update("tracks", (d) => ({ tracks: d.tracks.filter((t) => t.id !== id) }));
        for (const v of track.variants ?? []) {
          for (const path of [v.audioStorageId, v.wavStorageId]) {
            if (path) await this.io.removeFile(path).catch(() => {});
          }
        }
        if (track.aiImageStorageId) await this.releaseCover(track.aiImageStorageId, [id]);
      },

      setCoverSource: async (ids, source) => {
        this.update("tracks", (d) => ({
          tracks: d.tracks.map((t) => (ids.includes(t.id) ? { ...t, coverSource: source } : t)),
        }));
      },

      generateCover: (id) => this.coverFor(id, false),

      generateAlbumCovers: async (album) => {
        const queue = this.data.tracks.filter(
          (t) =>
            t.album === album &&
            t.status === "SUCCESS" &&
            !t.aiImageUrl &&
            t.coverStatus !== "pending"
        );
        if (queue.length === 0) throw new Error("Wszystkie utwory albumu mają już okładkę AI");
        const ids = queue.map((t) => t.id);
        this.update("tracks", (d) => ({
          tracks: d.tracks.map((t) =>
            ids.includes(t.id) ? { ...t, coverStatus: "pending", coverError: undefined } : t
          ),
        }));
        // kolejno w tle — postęp widać po coverStatus przy utworach
        void (async () => {
          for (const id of ids) {
            if (this.track(id)?.coverStatus !== "pending") continue;
            try {
              await this.coverFor(id, true);
            } catch (e) {
              this.setTrack(id, (t) =>
                t.coverStatus === "pending"
                  ? {
                      ...t,
                      coverStatus: "error",
                      coverError: e instanceof Error ? e.message : String(e),
                    }
                  : null
              );
            }
          }
        })();
        return ids.length;
      },

      resetCovers: async (ids) => {
        const targets = this.data.tracks.filter(
          (t) => ids.includes(t.id) && (t.aiImageUrl || t.coverStatus)
        );
        if (targets.length === 0) throw new Error("Brak okładek AI do zresetowania");
        const files = new Set(targets.map((t) => t.aiImageStorageId).filter(Boolean) as string[]);
        const targetIds = targets.map((t) => t.id);
        this.update("tracks", (d) => ({
          tracks: d.tracks.map((t) => (targetIds.includes(t.id) ? withoutAiCover(t) : t)),
        }));
        for (const path of files) await this.releaseCover(path, ids);
        return targets.length;
      },

      planAlbum: async ({ brief, songCount, provider, useLibrary, excludedIds }) => {
        const docs = activeDocs(this.data.library, useLibrary, excludedIds);
        return generateAlbumConcept(
          this.io.http,
          provider,
          this.data.settings,
          brief,
          songCount,
          guidesFor(docs, brief)
        );
      },

      writeAlbumLyrics: async ({ provider, sunoModel, useLibrary, excludedIds }) => {
        const docs = activeDocs(this.data.library, useLibrary, excludedIds);
        const start = this.data.album;
        if (!start) return;
        for (const index of songsToWrite(start)) {
          const album = this.data.album;
          if (!album || album.id !== start.id) return; // album usunięty/zmieniony w trakcie
          const song = album.songs[index];
          if (!song || ["written", "sent", "writing"].includes(song.status)) continue;
          await this.actions.patchAlbumSong(index, { status: "writing" });
          try {
            const { context, guides } = albumSongContext(docs, song);
            const draft = await generateSong(
              this.io.http,
              provider,
              this.data.settings,
              context,
              guides,
              albumSongBrief(song, album),
              sunoModel
            );
            await this.actions.patchAlbumSong(index, { status: "written", draft });
          } catch (e) {
            await this.actions.patchAlbumSong(index, {
              status: "error",
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }
      },

      setAlbum: async (album) => {
        const next = album === null ? null : sanitizeAlbum(album);
        if (album !== null && !next) throw new Error("Nieprawidłowy plan albumu");
        this.update("album", () => ({ album: next }));
      },

      patchAlbumSong: async (index, patch) => {
        if (!this.data.album) return;
        this.update("album", (d) => ({
          album: {
            ...d.album!,
            songs: d.album!.songs.map((s, i) => (i === index ? patchSong(s, patch) : s)),
          },
        }));
      },

      addLibraryDocs: async (docs) => {
        this.update("library", (d) => ({ library: [...d.library, ...docs] }));
      },

      setDocKind: async (id, kind: DocKind) => {
        this.update("library", (d) => ({
          library: d.library.map((doc) => (doc.id === id ? { ...doc, kind } : doc)),
        }));
      },

      removeLibraryDoc: async (id) => {
        this.update("library", (d) => ({ library: d.library.filter((doc) => doc.id !== id) }));
      },
    };
  }

  // --- dane lokalne (Ustawienia → Dane na tym komputerze) -------------------------

  /** Eksport jak na webie: wszystko poza kluczami API. */
  exportData() {
    const { settings, tracks, library, personas, album } = this.data;
    const {
      openaiKey: _o,
      anthropicKey: _a,
      sunoKey: _s,
      anthropicAdminKey: _aa,
      openaiAdminKey: _oa,
      ...safeSettings
    } = settings;
    return {
      format: "suno-studio-export@1",
      exportedAt: new Date().toISOString(),
      settings: safeSettings,
      tracks: tracks.map(dehydrateTrack),
      library,
      personas,
      album,
    };
  }

  /** Ścieżki plików archiwum (audio, WAV, okładki) — do podsumowania zajętości. */
  storedFiles(): string[] {
    const paths = this.data.tracks.flatMap((t) => [
      ...(t.variants ?? []).flatMap((v) => [v.audioStorageId, v.wavStorageId]),
      t.aiImageStorageId,
    ]);
    return [...new Set(paths.filter((p): p is string => !!p))];
  }
}

function patchSong(song: AlbumSong, patch: Partial<AlbumSong>): AlbumSong {
  const merged: AlbumSong = { ...song, ...patch };
  // ponowne pisanie po błędzie czyści poprzedni komunikat
  if (patch.status && patch.status !== "error") delete merged.error;
  return merged;
}

function needsArchive(track: Track): boolean {
  return getVariants(track).some((v) => v.audioUrl && !v.audioStorageId && !v.audioExpired);
}

function sortTracks(tracks: Track[]): Track[] {
  return [...tracks].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

/** Na dysk zapisujemy ścieżki, nie adresy asset — te liczymy przy wczytaniu. */
function dehydrateTrack(track: Track): Track {
  const strip = (v: TrackVariant): TrackVariant => {
    const next = { ...v };
    if (next.audioStorageId) delete next.audioUrl;
    if (next.wavStorageId) delete next.wavUrl;
    return next;
  };
  const next: Track = { ...track, variants: track.variants?.map(strip) };
  if (!track.variants) delete next.variants;
  if (track.aiImageStorageId) delete next.aiImageUrl;
  const first = next.variants?.find((v) => v.audioId === track.audioId);
  if (first?.audioStorageId) delete next.audioUrl;
  if (first?.wavStorageId) delete next.wavUrl;
  return next;
}
