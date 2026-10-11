import { afterEach, describe, expect, it, vi } from "vitest";
import { canRegenerate, DEFAULT_SETTINGS, Track } from "@suno/core";
import { LocalIO, LocalStudio } from "./LocalStudio";

// Silnik desktopu na atrapach: pamięciowy dysk/store + udawane API Suno/Anthropic/OpenAI.

const FAST = { pollMs: 5, pollDeadlineMs: 2_000, archiveRetryMs: 5, wavPollMs: 1 };
const DAY = 24 * 60 * 60 * 1000;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface FakeOptions {
  /** kolejne odpowiedzi record-info (ostatnia się powtarza) */
  statuses?: string[];
  expiredCdn?: boolean;
}

function setup(stores: Record<string, Record<string, unknown>> = {}, opts: FakeOptions = {}) {
  const files = new Map<string, Blob>();
  const storeData = new Map<string, Map<string, unknown>>(
    Object.entries(stores).map(([file, entries]) => [file, new Map(Object.entries(entries))])
  );
  const requests: { url: string; body?: string }[] = [];
  let taskCounter = 0;
  let statusIndex = 0;
  const statuses = opts.statuses ?? ["PENDING", "SUCCESS"];

  const http = vi.fn(async (url: string, init?: RequestInit) => {
    requests.push({ url, body: init?.body as string | undefined });
    if (url.endsWith("/generate") && init?.method === "POST") {
      return json({ code: 200, msg: "ok", data: { taskId: `task-${++taskCounter}` } });
    }
    if (url.includes("/generate/record-info")) {
      const status = statuses[Math.min(statusIndex++, statuses.length - 1)];
      const taskId = new URL(url).searchParams.get("taskId");
      return json({
        code: 200,
        msg: "ok",
        data: {
          status,
          response: {
            sunoData:
              status === "PENDING"
                ? []
                : [
                    {
                      id: "a1",
                      audioUrl: `https://cdn/${taskId}-a1.mp3`,
                      imageUrl: "https://cdn/c.jpg",
                      duration: 120,
                    },
                    { id: "a2", audioUrl: `https://cdn/${taskId}-a2.mp3`, duration: 130 },
                  ],
          },
        },
      });
    }
    if (url.startsWith("https://cdn/")) {
      return opts.expiredCdn ? new Response("gone", { status: 404 }) : new Response(`bytes:${url}`);
    }
    if (url.includes("api.anthropic.com/v1/messages")) {
      return json({
        stop_reason: "end_turn",
        content: [
          {
            type: "text",
            text: JSON.stringify({ title: "Las", style: "folk", lyrics: "[Verse] la" }),
          },
        ],
      });
    }
    if (url.includes("api.openai.com/v1/images")) {
      return json({ data: [{ b64_json: btoa("png") }] });
    }
    return new Response("not found", { status: 404 });
  });

  const io: LocalIO = {
    http,
    readStore: async (file, key) => storeData.get(file)?.get(key) as never,
    writeStore: async (file, key, value) => {
      if (!storeData.has(file)) storeData.set(file, new Map());
      storeData.get(file)!.set(key, structuredClone(value));
    },
    writeDataFile: async (rel, data) => {
      const path = `/data/${rel}`;
      files.set(path, data);
      return path;
    },
    removeFile: async (path) => void files.delete(path),
    fileUrl: (path) => `asset://localhost/${encodeURIComponent(path)}`,
  };
  const engine = new LocalStudio(io, FAST);
  const stored = (file: string, key: string) => storeData.get(file)?.get(key);
  return { engine, io, files, requests, stored };
}

const settings = { ...DEFAULT_SETTINGS, sunoKey: "suno", anthropicKey: "ant", openaiKey: "oai" };

function legacyTrack(patch: Partial<Track> & Record<string, unknown> = {}): Track {
  return {
    id: "old-1",
    taskId: "task-old",
    title: "Pieśń",
    style: "folk",
    lyrics: "la",
    sunoModel: "V5",
    provider: "anthropic",
    instrumental: false,
    status: "SUCCESS",
    createdAt: new Date(Date.now() - 60 * DAY).toISOString(),
    ...patch,
  } as Track;
}

let engines: LocalStudio[] = [];
afterEach(() => {
  engines.forEach((e) => e.dispose());
  engines = [];
});
function track<T extends { engine: LocalStudio }>(ctx: T) {
  engines.push(ctx.engine);
  return ctx;
}
const snapshot = (engine: LocalStudio) => engine.getSnapshot()!;

describe("LocalStudio — dane starej aplikacji desktopowej", () => {
  it("loads the old files as-is and maps the AI cover path to a playable URL", async () => {
    const { engine, stored } = track(
      setup({
        "settings.json": { settings: { ...settings, defaultSaveDir: "/Users/me/Downloads" } },
        "history.json": {
          tracks: [legacyTrack({ aiImagePath: "/data/covers/old.png", coverSource: "ai" })],
        },
        "library.json": {
          docs: [{ id: "d1", name: "poradnik suno.md", path: "x", chunks: ["a"], addedAt: "x" }],
        },
      })
    );
    await engine.load();
    const [t] = snapshot(engine).tracks;
    expect(t.aiImageStorageId).toBe("/data/covers/old.png");
    expect(t.aiImageUrl).toBe("asset://localhost/%2Fdata%2Fcovers%2Fold.png");
    expect(snapshot(engine).library[0].kind).toBe("guide");

    // zapis ustawień nie gubi pól spoza modelu (defaultSaveDir starego desktopu)
    await engine.actions.saveSettings({ ...snapshot(engine).settings, sunoModel: "V5_5" });
    await engine.flush();
    expect(stored("settings.json", "settings")).toMatchObject({
      sunoModel: "V5_5",
      defaultSaveDir: "/Users/me/Downloads",
    });
  });

  it("flags expired Suno audio on startup so the track can be regenerated", async () => {
    const { engine } = track(
      setup(
        {
          "settings.json": { settings },
          "history.json": {
            tracks: [
              legacyTrack({ variants: [{ audioId: "a1", audioUrl: "https://cdn/old.mp3" }] }),
            ],
          },
        },
        { expiredCdn: true }
      )
    );
    await engine.load();
    await vi.waitFor(() =>
      expect(snapshot(engine).tracks[0].variants?.[0].audioExpired).toBe(true)
    );
    const expired = snapshot(engine).tracks[0];
    expect(canRegenerate(expired)).toBe(true);

    await engine.actions.regenerateExpired(expired.id);
    const regenerated = snapshot(engine).tracks[0];
    expect(regenerated.status).toBe("PENDING");
    expect(regenerated.previousTaskIds).toEqual(["task-old"]);
    expect(regenerated.taskId).toBe("task-1");
    expect(regenerated.createdAt).toBe(expired.createdAt); // nie przeskakuje na górę
  });
});

describe("LocalStudio — generacja", () => {
  it("writes lyrics with library context through the injected HTTP client", async () => {
    const { engine, requests } = track(
      setup({
        "settings.json": { settings },
        "library.json": {
          docs: [
            {
              id: "d1",
              name: "las.md",
              path: "x",
              chunks: ["Ciemny las i dęby"],
              kind: "content",
              addedAt: "x",
            },
          ],
        },
      })
    );
    await engine.load();
    const result = await engine.actions.writeSong({
      brief: "las nocą",
      useLibrary: true,
      excludedIds: [],
      provider: "anthropic",
      sunoModel: "V5",
    });
    expect(result.draft.title).toBe("Las");
    expect(result.usedSources).toBe("źródła: las.md (1)");
    const llmCall = requests.find((r) => r.url.includes("anthropic"));
    expect(llmCall?.body).toContain("Ciemny las i dęby");
  });

  it("generates music, polls Suno and archives both variants to disk", async () => {
    const { engine, files, stored } = track(setup({ "settings.json": { settings } }));
    await engine.load();
    const id = await engine.actions.startGeneration({
      draft: { title: "Las", style: "folk", lyrics: "la" },
      sunoModel: "V5",
      provider: "anthropic",
      instrumental: false,
    });
    expect(snapshot(engine).tracks[0]).toMatchObject({ id, status: "PENDING", taskId: "task-1" });

    await vi.waitFor(() =>
      expect(snapshot(engine).tracks[0].variants?.every((v) => v.audioStorageId)).toBe(true)
    );
    const done = snapshot(engine).tracks[0];
    expect(done.status).toBe("SUCCESS");
    expect(done.variants?.[0]).toMatchObject({
      audioStorageId: `/data/audio/${id}-a1.mp3`,
      audioUrl: `asset://localhost/${encodeURIComponent(`/data/audio/${id}-a1.mp3`)}`,
      sourceAudioUrl: "https://cdn/task-1-a1.mp3",
    });
    expect(files.has(`/data/audio/${id}-a2.mp3`)).toBe(true);

    // na dysku ścieżki, adresy asset liczone przy wczytaniu
    await engine.flush();
    const persisted = (stored("history.json", "tracks") as Track[])[0];
    expect(persisted.variants?.[0].audioStorageId).toBe(`/data/audio/${id}-a1.mp3`);
    expect(persisted.variants?.[0].audioUrl).toBeUndefined();
  });

  it("finishes a generation that was in progress when the app was closed", async () => {
    const { engine } = track(
      setup(
        {
          "settings.json": { settings },
          "history.json": {
            tracks: [
              legacyTrack({
                status: "TEXT_SUCCESS",
                createdAt: new Date().toISOString(),
                generatedAt: new Date(Date.now() - 60_000).toISOString(),
              }),
            ],
          },
        },
        { statuses: ["SUCCESS"] }
      )
    );
    await engine.load();
    await vi.waitFor(() => expect(snapshot(engine).tracks[0].status).toBe("SUCCESS"));
  });
});

describe("LocalStudio — okładki i usuwanie", () => {
  it("queues album covers, and a reset mid-generation discards the image", async () => {
    const tracks = [
      legacyTrack({ id: "t1", album: "X", createdAt: new Date().toISOString() }),
      legacyTrack({ id: "t2", album: "X", createdAt: new Date().toISOString() }),
    ];
    const { engine, files } = track(
      setup({ "settings.json": { settings }, "history.json": { tracks } })
    );
    await engine.load();
    expect(await engine.actions.generateAlbumCovers("X")).toBe(2);
    expect(snapshot(engine).tracks.every((t) => t.coverStatus === "pending")).toBe(true);
    await engine.actions.resetCovers(["t2"]); // t2 zdjęty z kolejki zanim przyszła jego kolej

    await vi.waitFor(() =>
      expect(snapshot(engine).tracks.find((t) => t.id === "t1")?.aiImageUrl).toBeTruthy()
    );
    const t2 = snapshot(engine).tracks.find((t) => t.id === "t2")!;
    expect(t2.aiImageUrl).toBeUndefined();
    expect([...files.keys()].filter((p) => p.includes("covers/t2"))).toEqual([]);

    await engine.actions.resetCovers(["t1"]);
    expect([...files.keys()].filter((p) => p.startsWith("/data/covers/"))).toEqual([]);
  });

  it("removing a track deletes its archived files", async () => {
    const { engine, files } = track(setup({ "settings.json": { settings } }));
    await engine.load();
    const id = await engine.actions.startGeneration({
      draft: { title: "A", style: "s", lyrics: "l" },
      sunoModel: "V5",
      provider: "anthropic",
      instrumental: false,
    });
    await vi.waitFor(() => expect(files.size).toBe(2));
    await engine.actions.removeTrack(id);
    expect(files.size).toBe(0);
    expect(snapshot(engine).tracks).toEqual([]);
  });
});

describe("LocalStudio — album", () => {
  it("writes album lyrics song by song and keeps per-song errors", async () => {
    const { engine } = track(setup({ "settings.json": { settings } }));
    await engine.load();
    await engine.actions.setAlbum({
      id: "al",
      title: "X",
      brief: "b",
      styleDirection: "folk",
      createdAt: "x",
      songs: [
        { plan: { title: "1", brief: "b1", styleHints: "s" }, status: "planned" },
        { plan: { title: "2", brief: "b2", styleHints: "s" }, status: "sent" },
      ],
    });
    await engine.actions.writeAlbumLyrics({
      provider: "anthropic",
      sunoModel: "V5",
      useLibrary: false,
      excludedIds: [],
    });
    const songs = snapshot(engine).album!.songs;
    expect(songs[0]).toMatchObject({ status: "written", draft: { title: "Las" } });
    expect(songs[1].status).toBe("sent"); // wysłane nie są pisane ponownie

    await engine.actions.saveSettings({ ...settings, anthropicKey: "" });
    await engine.actions.patchAlbumSong(0, { status: "planned" });
    await engine.actions.writeAlbumLyrics({
      provider: "anthropic",
      sunoModel: "V5",
      useLibrary: false,
      excludedIds: [],
    });
    expect(snapshot(engine).album!.songs[0]).toMatchObject({
      status: "error",
      error: expect.stringContaining("Brak klucza API"),
    });
  });

  it("exports data without API keys", async () => {
    const { engine } = track(setup({ "settings.json": { settings } }));
    await engine.load();
    const exported = JSON.stringify(engine.exportData());
    expect(exported).toContain("suno-studio-export@1");
    expect(exported).not.toContain('"suno"');
    expect(exported).not.toContain("oai");
  });
});
