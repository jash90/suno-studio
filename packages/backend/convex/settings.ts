import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { internalQuery, mutation, query, QueryCtx } from "./_generated/server";
import { Settings } from "@suno/core";

async function readSettings(
  ctx: QueryCtx,
  userId: Id<"users">
): Promise<Settings | null> {
  const row = await ctx.db
    .query("settings")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  return (row?.data as Settings) ?? null;
}

export const get = query({
  args: {},
  handler: async (ctx): Promise<Settings | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    return readSettings(ctx, userId);
  },
});

export const save = mutation({
  args: { settings: v.any() },
  handler: async (ctx, { settings }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Niezalogowany");
    const row = await ctx.db
      .query("settings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (row) await ctx.db.patch(row._id, { data: settings });
    else await ctx.db.insert("settings", { userId, data: settings });
  },
});

/** Dla actions: odczyt ustawień danego usera (klucze API). */
export const getInternal = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<Settings | null> => {
    return readSettings(ctx, userId);
  },
});
