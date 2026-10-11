import { Track } from "@suno/core";
import { Id } from "../_generated/dataModel";
import { MutationCtx } from "../_generated/server";

// Wspólne operacje na wierszach `tracks` dla mutacji z różnych modułów.

export async function findTrackRow(ctx: MutationCtx, userId: Id<"users">, domainId: string) {
  return ctx.db
    .query("tracks")
    .withIndex("by_user_domain", (q) => q.eq("userId", userId).eq("domainId", domainId))
    .unique();
}

export async function rowsOfUser(ctx: MutationCtx, userId: Id<"users">) {
  return ctx.db
    .query("tracks")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
}

/** Kasuje plik okładki AI, jeśli żaden inny utwór użytkownika go nie używa
 *  (dawne wspólne okładki albumu miały jeden plik na wszystkie utwory). */
export async function releaseCoverFile(
  ctx: MutationCtx,
  userId: Id<"users">,
  storageId: string,
  exceptDomainIds: string[]
) {
  const rows = await rowsOfUser(ctx, userId);
  const stillUsed = rows.some(
    (r) => !exceptDomainIds.includes(r.domainId) && (r.data as Track).aiImageStorageId === storageId
  );
  if (!stillUsed) await ctx.storage.delete(storageId as Id<"_storage">);
}
