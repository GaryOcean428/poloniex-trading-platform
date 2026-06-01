/**
 * market_microstructure.ts — SENSE-2 (#768)
 * Order book imbalance + funding rate as basin sensations.
 * All scale coefficients are observer-derived from the distribution of observations.
 * Cache TTL: order book 5s, funding rate 5min.
 */

export interface MicrostructureReading {
  bookImbalance: number;    // (bidDepth - askDepth) / (bidDepth + askDepth) ∈ [-1, 1]
  fundingRate8h: number;    // current 8h funding rate (signed)
  fundingRateTrend: number; // direction of funding rate over last observation window
  atMs: number;
  isStale: boolean;
}

// P25: 5s is sufficient for perception cadence
export const BOOK_CACHE_TTL_MS = 5_000;
// P25: 5min funding rate cache
export const FUNDING_CACHE_TTL_MS = 300_000;

// Per-symbol rolling funding rate history for trend computation
const fundingHistory = new Map<string, number[]>();

export function observeMicrostructure(
  symbol: string,
  orderBookBidDepth: number | null,
  orderBookAskDepth: number | null,
  fundingRate8h: number,
  atMs = Date.now(),
): MicrostructureReading {
  // Book imbalance: zero if depth data missing
  let bookImbalance = 0;
  if (orderBookBidDepth != null && orderBookAskDepth != null) {
    const total = orderBookBidDepth + orderBookAskDepth;
    if (total > 0) bookImbalance = (orderBookBidDepth - orderBookAskDepth) / total;
  }

  // Funding rate trend from rolling history
  const hist = fundingHistory.get(symbol) ?? [];
  hist.push(fundingRate8h);
  if (hist.length > 8) hist.shift(); // keep 8 observations
  fundingHistory.set(symbol, hist);

  const fundingRateTrend = hist.length >= 2
    ? (hist[hist.length - 1]! - hist[0]!) / hist.length
    : 0;

  return { bookImbalance, fundingRate8h, fundingRateTrend, atMs, isStale: false };
}
