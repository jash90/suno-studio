import { useCallback, useEffect, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@suno/backend/api";
import { Balances } from "@suno/core";

/** Salda (kredyty Suno, wydatki AI) — po załadowaniu danych i cyklicznie co 10 min. */
export function useBalances(ready: boolean) {
  const fetchBalances = useAction(api.balances.fetch_);
  const [balances, setBalances] = useState<Balances>({});
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setBalances(await fetchBalances({}));
    } finally {
      setRefreshing(false);
    }
  }, [fetchBalances]);

  useEffect(() => {
    if (!ready) return;
    void refresh();
    const id = setInterval(() => void refresh(), 10 * 60_000);
    return () => clearInterval(id);
  }, [ready, refresh]);

  return { balances, refreshing, refresh };
}
