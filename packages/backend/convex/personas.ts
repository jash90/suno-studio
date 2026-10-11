import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { Persona } from "@suno/core";

export const list = query({
  args: {},
  handler: async (ctx): Promise<Persona[]> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const rows = await ctx.db
      .query("personas")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return rows
      .map((r) => r.data as Persona)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },
});

/** Wywoływane z action suno.createPersona po utworzeniu persony w Suno. */
export const addInternal = internalMutation({
  args: { userId: v.id("users"), persona: v.any() },
  handler: async (ctx, { userId, persona }) => {
    await ctx.db.insert("personas", { userId, data: persona });
  },
});
