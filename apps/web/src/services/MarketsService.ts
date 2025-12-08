import type { MarketCatalog, MarketEntry } from "@/types/markets";
import { getBackendUrl } from "@/utils/environment";

const BASE = getBackendUrl();

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  const contentType = res.headers.get("content-type") || "";
  if (!res.ok) {
    // Try to extract JSON error, else text snippet
    if (contentType.includes("application/json")) {
      const payload: unknown = await res.json().catch(() => ({}));
      throw new Error(
        `GET ${url} failed (${res.status}): ${JSON.stringify(payload)}`
      );
    }
    const text = await res.text().catch(() => "");
    throw new Error(`GET ${url} failed (${res.status}): ${text.slice(0, 200)}`);
  }

  if (!contentType.includes("application/json")) {
    const text = await res.text().catch(() => "");
    throw new Error(`Non-JSON response from ${url}: ${text.slice(0, 200)}`);
  }

  return res.json() as Promise<T>;
}

/**
 * MarketsService
 * Fetches normalized Poloniex Futures V3 markets catalog from backend.
 * Backend routes (see backend/src/routes/markets.ts):
 *  - GET /api/markets/poloniex-futures-v3
 *  - GET /api/markets/poloniex-futures-v3/symbols
 *  - GET /api/markets/poloniex-futures-v3/:symbol
 */
export const MarketsService = {
  async fetchCatalog(): Promise<MarketCatalog> {
    const url = `${BASE}/api/markets/poloniex-futures-v3`;
    return getJson<MarketCatalog>(url);
  },

  async fetchSymbols(): Promise<string[]> {
    const url = `${BASE}/api/markets/poloniex-futures-v3/symbols`;
    return getJson<string[]>(url);
  },

  async getMarket(symbol: string): Promise<MarketEntry> {
    const url = `${BASE}/api/markets/poloniex-futures-v3/${encodeURIComponent(
      symbol
    )}`;
    return getJson<MarketEntry>(url);
  },
};

export default MarketsService;
