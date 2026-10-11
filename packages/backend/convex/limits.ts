import { HOUR, isRateLimitError, RateLimiter } from "@convex-dev/rate-limiter";
import { v } from "convex/values";
import { components } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { internalMutation, MutationCtx } from "./_generated/server";

// Limity operacji kosztujących pieniądze (klucze API użytkownika) — chronią przed
// zapętlonym klientem albo przejętą sesją. Token bucket: krótkie serie są OK,
// ciągła lawina nie. Każde zużycie trafia też do dziennika `usage` (Ustawienia).

export const USAGE_KINDS = ["lyrics", "music", "cover", "wav"] as const;
export type UsageKind = (typeof USAGE_KINDS)[number];
export const usageKind = v.union(...USAGE_KINDS.map((k) => v.literal(k)));

const LABELS: Record<UsageKind, string> = {
  lyrics: "pisania tekstów (LLM)",
  music: "generacji muzyki w Suno",
  cover: "okładek AI",
  wav: "konwersji do WAV",
};

export const rateLimiter = new RateLimiter(components.rateLimiter, {
  lyrics: { kind: "token bucket", rate: 60, period: HOUR, capacity: 20 },
  music: { kind: "token bucket", rate: 40, period: HOUR, capacity: 15 },
  cover: { kind: "token bucket", rate: 40, period: HOUR, capacity: 20 },
  wav: { kind: "token bucket", rate: 60, period: HOUR, capacity: 30 },
});

/** Zużywa limit i zapisuje operację w dzienniku; po przekroczeniu rzuca czytelny błąd. */
export async function consume(ctx: MutationCtx, userId: Id<"users">, kind: UsageKind, count = 1) {
  try {
    await rateLimiter.limit(ctx, kind, { key: userId, count, throws: true });
  } catch (e) {
    if (!isRateLimitError(e)) throw e;
    const minutes = Math.max(1, Math.ceil(e.data.retryAfter / 60_000));
    throw new Error(`Przekroczono limit ${LABELS[kind]} — spróbuj ponownie za ok. ${minutes} min`, {
      cause: e,
    });
  }
  await ctx.db.insert("usage", { userId, kind, count, at: Date.now() });
}

/** Dla akcji (nie mają dostępu do db) — jedna mutacja: limit + wpis w dzienniku. */
export const consumeInternal = internalMutation({
  args: { userId: v.id("users"), kind: usageKind, count: v.optional(v.number()) },
  handler: (ctx, { userId, kind, count }) => consume(ctx, userId, kind, count ?? 1),
});
