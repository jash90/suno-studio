import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import {
  internalQuery,
  mutation,
  MutationCtx,
  query,
  QueryCtx,
} from "./_generated/server";
import { DocKind, LibraryDoc } from "@suno/core";

async function readLibrary(
  ctx: QueryCtx,
  userId: Id<"users">
): Promise<LibraryDoc[]> {
  const rows = await ctx.db
    .query("library")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  return rows
    .map((r) => r.data as LibraryDoc)
    .sort(
      (a, b) => new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime()
    );
}

async function findRow(
  ctx: MutationCtx,
  userId: Id<"users">,
  domainId: string
) {
  return ctx.db
    .query("library")
    .withIndex("by_user_domain", (q) =>
      q.eq("userId", userId).eq("domainId", domainId)
    )
    .unique();
}

export const list = query({
  args: {},
  handler: async (ctx): Promise<LibraryDoc[]> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    return readLibrary(ctx, userId);
  },
});

/** Dodaje dokument (ekstrakcja tekstu i chunkowanie robi się po stronie klienta). */
export const add = mutation({
  args: { doc: v.any() },
  handler: async (ctx, { doc }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Niezalogowany");
    await ctx.db.insert("library", {
      userId,
      domainId: (doc as LibraryDoc).id,
      data: doc,
    });
  },
});

export const setKind = mutation({
  args: { domainId: v.string(), kind: v.union(v.literal("content"), v.literal("guide")) },
  handler: async (ctx, { domainId, kind }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Niezalogowany");
    const row = await findRow(ctx, userId, domainId);
    if (row) {
      await ctx.db.patch(row._id, { data: { ...row.data, kind: kind as DocKind } });
    }
  },
});

export const remove = mutation({
  args: { domainId: v.string() },
  handler: async (ctx, { domainId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Niezalogowany");
    const row = await findRow(ctx, userId, domainId);
    if (row) await ctx.db.delete(row._id);
  },
});

/** Dla actions (generate/album): pełna biblioteka usera do retrievalu. */
export const listInternal = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<LibraryDoc[]> => {
    return readLibrary(ctx, userId);
  },
});
