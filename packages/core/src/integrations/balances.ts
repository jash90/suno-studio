import { Balances, Settings } from "../types";
import { getSunoCredits, type FetchFn } from "./suno";

// Salda na górnym pasku: kredyty Suno + wydatki AI w bieżącym miesiącu (klucze admin).

function monthStartUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Suma wydatków USD w bieżącym miesiącu z Anthropic Admin API (cost_report). */
async function getAnthropicMonthCost(fetch: FetchFn, adminKey: string): Promise<number> {
  let total = 0;
  let page: string | null = null;
  // ponytail: max 12 stron — miesiąc dzienny mieści się z zapasem
  for (let i = 0; i < 12; i++) {
    const url = new URL("https://api.anthropic.com/v1/organizations/cost_report");
    url.searchParams.set("starting_at", monthStartUtc().toISOString());
    if (page) url.searchParams.set("page", page);
    const res = await fetch(url.toString(), {
      headers: { "x-api-key": adminKey, "anthropic-version": "2023-06-01" },
    });
    if (!res.ok) throw new Error(`Anthropic Admin ${res.status}`);
    const body = await res.json();
    for (const bucket of body.data ?? []) {
      for (const result of bucket.results ?? []) total += parseFloat(result.amount ?? "0") || 0;
    }
    if (!body.has_more || !body.next_page) break;
    page = body.next_page;
  }
  return total;
}

/** Suma wydatków USD w bieżącym miesiącu z OpenAI Admin API (organization/costs). */
async function getOpenAIMonthCost(fetch: FetchFn, adminKey: string): Promise<number> {
  let total = 0;
  let page: string | null = null;
  for (let i = 0; i < 12; i++) {
    const url = new URL("https://api.openai.com/v1/organization/costs");
    url.searchParams.set("start_time", String(Math.floor(monthStartUtc().getTime() / 1000)));
    url.searchParams.set("limit", "31");
    if (page) url.searchParams.set("page", page);
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${adminKey}` } });
    if (!res.ok) throw new Error(`OpenAI Admin ${res.status}`);
    const body = await res.json();
    for (const bucket of body.data ?? []) {
      for (const result of bucket.results ?? []) total += Number(result.amount?.value ?? 0) || 0;
    }
    if (!body.has_more || !body.next_page) break;
    page = body.next_page;
  }
  return total;
}

/** Dostępne salda; brak klucza → pole nieobecne, błąd → null. */
export async function fetchBalances(fetch: FetchFn, settings: Settings): Promise<Balances> {
  const [suno, anthropic, openai] = await Promise.all([
    settings.sunoKey
      ? getSunoCredits(fetch, settings.sunoKey).catch(() => null)
      : Promise.resolve(undefined),
    settings.anthropicAdminKey
      ? getAnthropicMonthCost(fetch, settings.anthropicAdminKey).catch(() => null)
      : Promise.resolve(undefined),
    settings.openaiAdminKey
      ? getOpenAIMonthCost(fetch, settings.openaiAdminKey).catch(() => null)
      : Promise.resolve(undefined),
  ]);
  return { suno, anthropic, openai };
}
