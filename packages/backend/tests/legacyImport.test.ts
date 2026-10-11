import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { makeTrack, setup, signedIn } from "./helpers";

const legacySettings = {
  openaiKey: "sk-desktop",
  anthropicKey: "sk-ant-desktop",
  sunoKey: "suno-desktop",
  provider: "anthropic",
  sunoModel: "V5_5",
  defaultSaveDir: "/Users/x/Downloads", // tylko desktop — nie trafia na konto
};

describe("legacyImport.importBatch", () => {
  it("imports desktop data, maps AI covers and is idempotent", async () => {
    const t = setup();
    const { as } = await signedIn(t);
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["png"])));
    const withCover = {
      ...makeTrack({ album: "Ogień i Popiół", albumIndex: 0, coverSource: "ai" }),
      aiImagePath: "/Users/x/Library/Application Support/app/covers/a.png",
    };
    const coverMissing = { ...makeTrack({ coverSource: "ai" }), aiImagePath: "/gone.png" };
    const interrupted = makeTrack({ status: "TEXT_SUCCESS" });
    const doc = { id: "doc-1", name: "poradnik suno.md", path: "x", chunks: ["a"], addedAt: "2026-07-01" };
    const persona = { id: "p-1", name: "Głos", description: "d", sourceTrackTitle: "t", createdAt: "2026-07-01" };
    const album = { id: "al-1", title: "Ogień i Popiół", brief: "", styleDirection: "", songs: [], createdAt: "x" };

    const payload = {
      settings: legacySettings,
      tracks: [withCover, coverMissing, interrupted],
      library: [doc],
      personas: [persona],
      album,
      covers: [{ path: withCover.aiImagePath, storageId }],
    };
    expect(await as.mutation(api.legacyImport.importBatch, payload)).toEqual({
      tracks: 3,
      library: 1,
      personas: 1,
      album: true,
      settings: true,
    });

    const tracks = new Map((await as.query(api.tracks.list, {})).map((tr) => [tr.id, tr]));
    const imported = tracks.get(withCover.id)!;
    expect(imported.aiImageStorageId).toBe(storageId);
    expect(imported.aiImageUrl).toMatch(/^https?:\/\//);
    expect(imported.coverSource).toBe("ai");
    expect("aiImagePath" in imported).toBe(false);
    expect(tracks.get(coverMissing.id)!.coverSource).toBeUndefined();
    expect(tracks.get(interrupted.id)!.status).toBe("FAILED");

    const [importedDoc] = await as.query(api.library.list, {});
    expect(importedDoc.kind).toBe("guide"); // brak kind w starym wpisie → zgadnięty z nazwy

    const settings = await as.query(api.settings.get, {});
    expect(settings).toMatchObject({ openaiKey: "sk-desktop", sunoModel: "V5_5" });
    expect(settings).not.toHaveProperty("defaultSaveDir");

    // drugi import niczego nie dubluje
    expect(await as.mutation(api.legacyImport.importBatch, payload)).toEqual({
      tracks: 0,
      library: 0,
      personas: 0,
      album: false,
      settings: false,
    });
    expect(await as.query(api.tracks.list, {})).toHaveLength(3);
  });

  it("only fills empty settings on an account that already has some", async () => {
    const t = setup();
    const { as } = await signedIn(t);
    await as.mutation(api.settings.save, {
      settings: { openaiKey: "sk-web", anthropicKey: "", sunoKey: "", sunoModel: "V5" },
    });
    await as.mutation(api.legacyImport.importBatch, { settings: legacySettings });
    expect(await as.query(api.settings.get, {})).toMatchObject({
      openaiKey: "sk-web", // istniejący klucz zostaje
      anthropicKey: "sk-ant-desktop", // puste pole uzupełnione
      sunoModel: "V5", // ustawione na koncie — bez zmian
    });
  });

  it("does not replace an album the user is working on", async () => {
    const t = setup();
    const { as } = await signedIn(t);
    await as.mutation(api.album.set, { album: { title: "Web album", songs: [] } });
    const res = await as.mutation(api.legacyImport.importBatch, {
      album: { title: "Desktop album", songs: [] },
    });
    expect(res.album).toBe(false);
    expect((await as.query(api.album.get, {}))?.title).toBe("Web album");
  });

  it("requires sign-in", async () => {
    const t = setup();
    await expect(t.mutation(api.legacyImport.importBatch, {})).rejects.toThrow(/Niezalogowany/);
  });
});
