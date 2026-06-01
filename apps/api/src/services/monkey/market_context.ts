/**
 * market_context.ts — SENSE-2 (#768)
 * BTC beacon (cross-symbol correlation) + time-of-day circular encoding.
 * All derived from observed market returns — no hardcoded scales.
 */

export interface MarketContext {
  btcReturn: number;       // recent BTC log-return (0 if symbol IS BTC or no data)
  btcCorrelation: number;  // rolling correlation of this symbol with BTC [-1, 1]
  hourSin: number;         // sin(2π * hour/24) ∈ [-1, 1]
  hourCos: number;         // cos(2π * hour/24) ∈ [-1, 1]
  dayOfWeekSin: number;    // circular day-of-week encoding
  dayOfWeekCos: number;    // circular day-of-week encoding
}

// Per-symbol return history for correlation computation
const returnHistory = new Map<string, number[]>();
// P25 safety bound: max correlation window size
const MAX_CORR_WINDOW = 100;

export function computeMarketContext(
  symbol: string,
  currentReturn: number,
  btcReturn: number | null,
  atMs = Date.now(),
): MarketContext {
  // Store return history
  const hist = returnHistory.get(symbol) ?? [];
  hist.push(currentReturn);
  if (hist.length > MAX_CORR_WINDOW) hist.shift();
  returnHistory.set(symbol, hist);

  // BTC return: 0 if this IS BTC or no data
  const btcRet = (symbol === 'BTC_USDT_PERP' || btcReturn == null) ? 0 : btcReturn;

  // BTC correlation (observer-derived from paired return history — TODO in Phase 2)
  const btcCorrelation = 0;

  // Time-of-day circular encoding
  const date = new Date(atMs);
  const hourOfDay = date.getUTCHours() + date.getUTCMinutes() / 60;
  const dayOfWeek = date.getUTCDay();

  return {
    btcReturn: btcRet,
    btcCorrelation,
    hourSin: Math.sin(2 * Math.PI * hourOfDay / 24),
    hourCos: Math.cos(2 * Math.PI * hourOfDay / 24),
    dayOfWeekSin: Math.sin(2 * Math.PI * dayOfWeek / 7),
    dayOfWeekCos: Math.cos(2 * Math.PI * dayOfWeek / 7),
  };
}
