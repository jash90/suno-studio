// Pomocniki testów convex-test. Celowo poza convex/ — wszystko w tamtym katalogu
// Convex bundluje i wdraża jako funkcje.
import { convexTest } from "convex-test";
import type { Track } from "@suno/core";
import schema from "../convex/schema";

export const modules = import.meta.glob("../convex/**/*.ts");

export function setup() {
  return convexTest(schema, modules);
}

export type TestConvex = ReturnType<typeof setup>;

/** Tworzy użytkownika i zwraca klienta działającego w jego imieniu
 *  (Convex Auth czyta userId z `subject` w formacie "userId|sessionId"). */
export async function signedIn(t: TestConvex, email = "a@example.com") {
  const userId = await t.run((ctx) => ctx.db.insert("users", { email }));
  const sessionId = await t.run((ctx) =>
    ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 3_600_000 })
  );
  return { userId, as: t.withIdentity({ subject: `${userId}|${sessionId}` }) };
}

export function makeTrack(patch: Partial<Track> = {}): Track {
  return {
    id: crypto.randomUUID(),
    taskId: "task-1",
    title: "Pieśń",
    style: "folk",
    lyrics: "[Verse] la la",
    sunoModel: "V5",
    provider: "anthropic",
    instrumental: false,
    status: "SUCCESS",
    createdAt: "2026-10-01T10:00:00.000Z",
    ...patch,
  };
}
