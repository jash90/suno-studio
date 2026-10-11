import { describe, expect, it } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { makeTrack, setup, signedIn } from "./helpers";

describe("account.overview", () => {
  it("sums archived storage and counts paid operations from the last 30 days", async () => {
    const t = setup();
    const { userId, as } = await signedIn(t);
    const audio = await t.run((ctx) => ctx.storage.store(new Blob(["x".repeat(1000)])));
    const cover = await t.run((ctx) => ctx.storage.store(new Blob(["y".repeat(200)])));
    const track = makeTrack({
      aiImageStorageId: cover,
      variants: [{ audioId: "a", audioStorageId: audio }],
    });
    await t.run((ctx) => ctx.db.insert("tracks", { userId, domainId: track.id, data: track }));
    await t.mutation(internal.limits.consumeInternal, { userId, kind: "music" });
    await t.mutation(internal.limits.consumeInternal, { userId, kind: "cover", count: 3 });

    expect(await as.query(api.account.overview, {})).toEqual({
      storageBytes: 1200,
      storedFiles: 2,
      tracks: 1,
      usage30d: { lyrics: 0, music: 1, cover: 3, wav: 0 },
    });
  });
});

describe("rate limits", () => {
  it("stops a burst of Suno generations with a readable message", async () => {
    const t = setup();
    const { userId } = await signedIn(t);
    const consume = () => t.mutation(internal.limits.consumeInternal, { userId, kind: "music" });
    for (let i = 0; i < 15; i++) await consume(); // pojemność kubełka
    await expect(consume()).rejects.toThrow(/Przekroczono limit generacji muzyki/);
  });
});

describe("account.exportData", () => {
  it("exports account data without API keys", async () => {
    const t = setup();
    const { userId, as } = await signedIn(t);
    await as.mutation(api.settings.save, {
      settings: { sunoKey: "secret", openaiKey: "secret", sunoModel: "V5_5" },
    });
    const track = makeTrack();
    await t.run((ctx) => ctx.db.insert("tracks", { userId, domainId: track.id, data: track }));

    const data = await as.query(api.account.exportData, {});
    expect(data.format).toBe("suno-studio-export@1");
    expect(data.tracks).toEqual([track]);
    expect(data.settings).toMatchObject({ sunoModel: "V5_5" });
    expect(JSON.stringify(data)).not.toContain("secret");
  });
});

describe("account.deleteAccount", () => {
  it("requires confirmation and then removes all data, files and the user", async () => {
    const t = setup();
    const { userId, as } = await signedIn(t);
    const other = await signedIn(t, "other@example.com");
    const file = await t.run((ctx) => ctx.storage.store(new Blob(["a"])));
    const mine = makeTrack({ variants: [{ audioId: "a", audioStorageId: file }] });
    const theirs = makeTrack();
    await t.run(async (ctx) => {
      await ctx.db.insert("tracks", { userId, domainId: mine.id, data: mine });
      await ctx.db.insert("tracks", { userId: other.userId, domainId: theirs.id, data: theirs });
    });
    await as.mutation(api.settings.save, { settings: { sunoKey: "k" } });

    await expect(as.mutation(api.account.deleteAccount, { confirm: "tak" })).rejects.toThrow(
      /USUŃ/
    );
    await as.mutation(api.account.deleteAccount, { confirm: "USUŃ" });

    await t.run(async (ctx) => {
      expect(await ctx.db.get(userId)).toBeNull();
      expect(await ctx.storage.getUrl(file)).toBeNull();
      expect(await ctx.db.query("settings").collect()).toEqual([]);
      expect(
        await ctx.db
          .query("authSessions")
          .withIndex("userId", (q) => q.eq("userId", userId))
          .collect()
      ).toEqual([]);
    });
    // dane innego użytkownika nietknięte
    expect(await other.as.query(api.tracks.list, {})).toEqual([theirs]);
  });
});
