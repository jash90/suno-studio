import { getAuthUserId } from "@convex-dev/auth/server";
import { Balances, fetchBalances, Settings } from "@suno/core";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";

/** Pobiera dostępne salda; brak klucza → pole nieobecne, błąd → null. */
export const fetch_ = action({
  args: {},
  handler: async (ctx): Promise<Balances> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return {};
    const settings = (await ctx.runQuery(internal.settings.getInternal, {
      userId,
    })) as Settings | null;
    return settings ? fetchBalances(fetch, settings) : {};
  },
});
