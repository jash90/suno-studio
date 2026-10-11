import { describe, expect, it } from "vitest";
import type { Track } from "@suno/core";
import { api, internal } from "../convex/_generated/api";
import { makeTrack, setup, signedIn, TestConvex } from "./helpers";

async function insertTrack(t: TestConvex, userId: string, track: Track) {
  await t.run((ctx) =>
    ctx.db.insert("tracks", { userId: userId as never, domainId: track.id, data: track })
  );
}

async function storeFile(t: TestConvex): Promise<string> {
  return t.run((ctx) => ctx.storage.store(new Blob(["png"], { type: "image/png" })));
}

async function fileExists(t: TestConvex, storageId: string): Promise<boolean> {
  return t.run(async (ctx) => (await ctx.storage.getUrl(storageId as never)) !== null);
}

describe("cover.reset", () => {
  it("clears AI cover fields and deletes the file", async () => {
    const t = setup();
    const { userId, as } = await signedIn(t);
    const storageId = await storeFile(t);
    const track = makeTrack({
      aiImageUrl: "https://x/ai",
      aiImageStorageId: storageId,
      coverSource: "ai",
    });
    await insertTrack(t, userId, track);

    expect(await as.mutation(api.cover.reset, { domainIds: [track.id] })).toBe(1);

    const [after] = await as.query(api.tracks.list, {});
    expect(after.aiImageUrl).toBeUndefined();
    expect(after.aiImageStorageId).toBeUndefined();
    expect(after.coverSource).toBeUndefined();
    expect(await fileExists(t, storageId)).toBe(false);
  });

  it("keeps a legacy shared album cover file while another track still uses it", async () => {
    const t = setup();
    const { userId, as } = await signedIn(t);
    const shared = await storeFile(t);
    const a = makeTrack({ album: "X", aiImageUrl: "u", aiImageStorageId: shared });
    const b = makeTrack({ album: "X", aiImageUrl: "u", aiImageStorageId: shared });
    await insertTrack(t, userId, a);
    await insertTrack(t, userId, b);

    await as.mutation(api.cover.reset, { domainIds: [a.id] });
    expect(await fileExists(t, shared)).toBe(true);

    await as.mutation(api.cover.reset, { domainIds: [b.id] });
    expect(await fileExists(t, shared)).toBe(false);
  });

  it("refuses when there is nothing to reset", async () => {
    const t = setup();
    const { userId, as } = await signedIn(t);
    const track = makeTrack();
    await insertTrack(t, userId, track);
    await expect(as.mutation(api.cover.reset, { domainIds: [track.id] })).rejects.toThrow(
      /Brak okładek AI/
    );
  });

  it("cannot touch another user's tracks", async () => {
    const t = setup();
    const owner = await signedIn(t, "owner@example.com");
    const intruder = await signedIn(t, "intruder@example.com");
    const storageId = await storeFile(t);
    const track = makeTrack({ aiImageUrl: "u", aiImageStorageId: storageId });
    await insertTrack(t, owner.userId, track);

    await expect(
      intruder.as.mutation(api.cover.reset, { domainIds: [track.id] })
    ).rejects.toThrow();
    expect(await fileExists(t, storageId)).toBe(true);
    expect(await intruder.as.query(api.tracks.list, {})).toEqual([]);
  });
});

describe("cover.generateAlbumCovers", () => {
  it("queues only finished album tracks without an AI cover", async () => {
    const t = setup();
    const { userId, as } = await signedIn(t);
    const queued = makeTrack({ album: "X" });
    const hasCover = makeTrack({ album: "X", aiImageUrl: "u" });
    const failed = makeTrack({ album: "X", status: "FAILED" });
    const otherAlbum = makeTrack({ album: "Y" });
    for (const tr of [queued, hasCover, failed, otherAlbum]) await insertTrack(t, userId, tr);

    expect(await as.mutation(api.cover.generateAlbumCovers, { album: "X" })).toBe(1);
    const byId = new Map((await as.query(api.tracks.list, {})).map((tr) => [tr.id, tr]));
    expect(byId.get(queued.id)?.coverStatus).toBe("pending");
    expect(byId.get(hasCover.id)?.coverStatus).toBeUndefined();
    expect(byId.get(otherAlbum.id)?.coverStatus).toBeUndefined();

    // drugi raz nie dubluje kolejki
    await expect(as.mutation(api.cover.generateAlbumCovers, { album: "X" })).rejects.toThrow(
      /mają już okładkę/
    );
  });

  it("a reset before the job starts cancels the queued generation", async () => {
    const t = setup();
    const { userId, as } = await signedIn(t);
    const track = makeTrack({ album: "X", coverStatus: "pending" });
    await insertTrack(t, userId, track);

    await as.mutation(api.cover.reset, { domainIds: [track.id] });
    // job z kolejki widzi brak "pending" i kończy bez wołania OpenAI (brak ustawień nie rzuca)
    await t.action(internal.cover.generateQueuedCover, { userId: userId, domainId: track.id });
    const [after] = await as.query(api.tracks.list, {});
    expect(after.coverStatus).toBeUndefined();
    expect(after.coverError).toBeUndefined();
  });
});

describe("tracks.remove", () => {
  it("deletes archived audio and an unshared AI cover", async () => {
    const t = setup();
    const { userId, as } = await signedIn(t);
    const audio = await storeFile(t);
    const cover = await storeFile(t);
    const track = makeTrack({
      aiImageUrl: "u",
      aiImageStorageId: cover,
      variants: [{ audioId: "a", audioStorageId: audio }],
    });
    await insertTrack(t, userId, track);

    await as.mutation(api.tracks.remove, { domainId: track.id });
    expect(await as.query(api.tracks.list, {})).toEqual([]);
    expect(await fileExists(t, audio)).toBe(false);
    expect(await fileExists(t, cover)).toBe(false);
  });
});

describe("cover queue edge cases (review fixes)", () => {
  it("a reset while the image is being generated discards the finished file", async () => {
    const t = setup();
    const { userId, as } = await signedIn(t);
    const track = makeTrack({ album: "X" }); // brak coverStatus = reset już zdjął kolejkę
    await insertTrack(t, userId, track);
    const late = await storeFile(t);

    await t.mutation(internal.cover.setTrackCoverInternal, {
      userId,
      domainId: track.id,
      aiImageUrl: "https://x/late",
      aiImageStorageId: late,
      onlyIfPending: true,
    });
    const [after] = await as.query(api.tracks.list, {});
    expect(after.aiImageUrl).toBeUndefined();
    expect(await fileExists(t, late)).toBe(false);
  });

  it("album covers that failed can be queued again", async () => {
    const t = setup();
    const { userId, as } = await signedIn(t);
    const failed = makeTrack({ album: "X", coverStatus: "error", coverError: "Brak klucza" });
    await insertTrack(t, userId, failed);
    expect(await as.mutation(api.cover.generateAlbumCovers, { album: "X" })).toBe(1);
    const [after] = await as.query(api.tracks.list, {});
    expect(after.coverStatus).toBe("pending");
  });
});
