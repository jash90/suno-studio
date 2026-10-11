import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { makeTrack, setup, signedIn } from "./helpers";

describe("client mutation validation", () => {
  it("tracks.patch only lets the client switch the active cover", async () => {
    const t = setup();
    const { userId, as } = await signedIn(t);
    const track = makeTrack();
    await t.run((ctx) => ctx.db.insert("tracks", { userId, domainId: track.id, data: track }));

    await as.mutation(api.tracks.patch, { domainId: track.id, patch: { coverSource: "ai" } });
    await expect(
      as.mutation(api.tracks.patch, {
        domainId: track.id,
        patch: { status: "SUCCESS", audioUrl: "https://evil" } as never,
      })
    ).rejects.toThrow(/validator/i);
    const [after] = await as.query(api.tracks.list, {});
    expect(after.coverSource).toBe("ai");
    expect(after.audioUrl).toBeUndefined();
  });

  it("settings.save stores only known settings fields", async () => {
    const t = setup();
    const { as } = await signedIn(t);
    await as.mutation(api.settings.save, {
      settings: { sunoKey: "k", provider: "openai", isAdmin: true },
    });
    const saved = await as.query(api.settings.get, {});
    expect(saved).toMatchObject({ sunoKey: "k", provider: "openai" });
    expect(saved).not.toHaveProperty("isAdmin");
  });

  it("album.set rejects something that is not an album", async () => {
    const t = setup();
    const { as } = await signedIn(t);
    await expect(as.mutation(api.album.set, { album: { title: "x" } })).rejects.toThrow(
      /Nieprawidłowy plan albumu/
    );
  });
});
