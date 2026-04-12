import { logger } from './logger.js';

export interface ValidatedMarketData {
  symbol: string;    // Always BTC_USDT_PERP format
  price: number;     // > 0, finite
  open: number;
  high: number;
  low: number;
  volume: number;
  timestamp: number;
}

/**
 * Normalize a symbol string to Poloniex Futures _PERP format.
 * Handles BTC-USDT, BTC_USDT, BTCUSDTPERP, and BTC_USDT_PERP inputs.
 */
export function normalizeSymbolToPerp(symbol: string): string {
  if (!symbol) return symbol;
  // Replace hyphens with underscores
  let s = symbol.replace(/-/g, '_').toUpperCase();
  // Already ends with _PERP
  if (s.endsWith('_PERP')) return s;
  // Contains PERP without underscore separator (e.g. BTCUSDTPERP)
  if (s.includes('PERP')) {
    // Insert underscore before PERP if missing
    return s.replace(/PERP$/, '_PERP').replace(/(__PERP)$/, '_PERP');
  }
  return `${s}_PERP`;
}

/**
 * Validate and normalize raw market data from any source (WebSocket, REST ticker, klines).
 *
 * Returns a `ValidatedMarketData` object on success, or `null` if any critical
 * validation check fails, logging a warning with the source name.
 */
export function validateMarketData(raw: Record<string, unknown>, source: string): ValidatedMarketData | null {
  if (!raw || typeof raw !== 'object') {
    logger.warn(`[MarketDataValidator] Invalid input from ${source}: not an object`);
    return null;
  }

  // 1. Normalize symbol
  const rawSymbol = (raw.symbol as string) || '';
  if (!rawSymbol) {
    logger.warn(`[MarketDataValidator] Missing symbol from ${source}`);
    return null;
  }
  const symbol = normalizeSymbolToPerp(rawSymbol);

  // 2. Extract price with fallback chain
  const toNum = (v: unknown): number => {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') return parseFloat(v);
    return NaN;
  };

  const price = toNum(raw.price ?? raw.close ?? raw.markPx ?? raw.markPrice ?? raw.lastPx ?? NaN);

  // 3. Validate price
  if (!isFinite(price) || isNaN(price) || price <= 0) {
    logger.warn(`[MarketDataValidator] Invalid price ${price} for ${symbol} from ${source}`);
    return null;
  }

  // 4. Extract OHLV fields with sensible fallbacks to price
  const open   = isFinite(toNum(raw.open))   && toNum(raw.open)   > 0 ? toNum(raw.open)   : price;
  const high   = isFinite(toNum(raw.high))   && toNum(raw.high)   > 0 ? toNum(raw.high)   : price;
  const low    = isFinite(toNum(raw.low))    && toNum(raw.low)    > 0 ? toNum(raw.low)    : price;
  const volume = isFinite(toNum(raw.volume ?? raw.qty24h ?? raw.vol)) && toNum(raw.volume ?? raw.qty24h ?? raw.vol) >= 0
    ? toNum(raw.volume ?? raw.qty24h ?? raw.vol)
    : 0;

  // 5. Validate OHLC consistency: high >= low, high >= open, high >= close(price)
  if (high < low) {
    logger.warn(`[MarketDataValidator] high (${high}) < low (${low}) for ${symbol} from ${source}`);
    return null;
  }
  if (high < open) {
    logger.warn(`[MarketDataValidator] high (${high}) < open (${open}) for ${symbol} from ${source}`);
    return null;
  }
  if (high < price) {
    logger.warn(`[MarketDataValidator] high (${high}) < close/price (${price}) for ${symbol} from ${source}`);
    return null;
  }

  const timestamp = typeof raw.timestamp === 'number' ? raw.timestamp : Date.now();

  return { symbol, price, open, high, low, volume, timestamp };
}
