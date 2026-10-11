import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { callbackUrl, verifyCallback } from "../convex/lib/callback";
import { makeTrack, setup, signedIn } from "./helpers";

beforeEach(() => {
  vi.stubEnv("SUNO_CALLBACK_SECRET", "test-secret");
  vi.stubEnv("CONVEX_SITE_URL", "https://example.convex.site");
});
afterEach(() => vi.unstubAllEnvs());

describe("signed Suno callback URL", () => {
  it("round-trips and rejects tampering", async () => {
    const url = new URL(await callbackUrl("user1", "track1"));
    expect(url.origin + url.pathname).toBe("https://example.convex.site/suno-callback");
    expect(await verifyCallback(url)).toEqual({ userId: "user1", domainId: "track1" });

    url.searchParams.set("t", "someone-elses-track");
    expect(await verifyCallback(url)).toBeNull();
  });

  it("falls back to the stub (polling only) without a secret", async () => {
    vi.stubEnv("SUNO_CALLBACK_SECRET", "");
    expect(await callbackUrl("u", "t")).toBe("https://example.com/suno-callback");
  });
});

describe("/suno-callback route", () => {
  it("rejects unsigned and forged requests", async () => {
    const t = setup();
    expect((await t.fetch("/suno-callback?u=a&t=b", { method: "POST" })).status).toBe(403);
    expect((await t.fetch("/suno-callback?u=a&t=b&s=00", { method: "POST" })).status).toBe(403);
  });

  it("accepts a signed callback", async () => {
    const t = setup();
    const { userId } = await signedIn(t);
    const url = new URL(await callbackUrl(userId, "track-1"));
    const res = await t.fetch(`/suno-callback${url.search}`, { method: "POST", body: "{}" });
    expect(res.status).toBe(200);
  });
});

describe("tracks.applyTaskUpdateInternal", () => {
  it("transitions to SUCCESS exactly once and ignores stale tasks", async () => {
    const t = setup();
    const { userId, as } = await signedIn(t);
    const track = makeTrack({ status: "PENDING", taskId: "task-2" });
    await t.run((ctx) => ctx.db.insert("tracks", { userId, domainId: track.id, data: track }));
    const update = {
      status: "SUCCESS",
      variants: [{ audioId: "a", audioUrl: "https://cdn/a.mp3" }],
    };

    // odpowiedź dla starego taska (sprzed ponowienia) nie nadpisuje utworu
    expect(
      await t.mutation(internal.tracks.applyTaskUpdateInternal, {
        userId,
        domainId: track.id,
        taskId: "task-1",
        update,
      })
    ).toBe("PENDING");

    const args = { userId, domainId: track.id, taskId: "task-2", update };
    expect(await t.mutation(internal.tracks.applyTaskUpdateInternal, args)).toBe("SUCCESS");
    // drugi raz (callback + polling naraz) — bez zmian i bez drugiej archiwizacji
    expect(await t.mutation(internal.tracks.applyTaskUpdateInternal, args)).toBe("SUCCESS");

    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.filter((f) => f.name.includes("archiveTrack"))).toHaveLength(1);
    const [after] = await as.query(api.tracks.list, {});
    expect(after.status).toBe("SUCCESS");
  });
});
