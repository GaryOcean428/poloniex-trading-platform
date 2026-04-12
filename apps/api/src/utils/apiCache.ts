import { logger } from './logger.js';

interface CacheEntry {
  data: unknown;
  timestamp: number;
  ttl: number;
}

/**
 * TTL-based in-memory cache for Poloniex API responses.
 * Reduces duplicate outbound calls when multiple frontend components
 * request the same data within a short window.
 */
class ApiCache {
  private cache = new Map<string, CacheEntry>();

  get(key: string): unknown | null {
    const entry = this.cache.get(key);
    if (!entry) {
      logger.debug(`Cache MISS: ${key}`);
      return null;
    }
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      logger.debug(`Cache MISS (expired): ${key}`);
      return null;
    }
    logger.debug(`Cache HIT: ${key}`);
    return entry.data;
  }

  set(key: string, data: unknown, ttlMs: number): void {
    this.cache.set(key, { data, timestamp: Date.now(), ttl: ttlMs });
  }

  /**
   * Invalidate all cache entries whose key starts with the given prefix.
   * Used to flush balance/position caches after order placement.
   */
  invalidatePrefix(prefix: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        logger.debug(`Cache INVALIDATED: ${key}`);
      }
    }
  }
}

export const apiCache = new ApiCache();

/** TTL constants (milliseconds) */
export const CACHE_TTL = {
  BALANCE: 5_000,
  POSITIONS: 5_000,
  TICKERS: 2_000,
  CANDLES: 30_000,
  ORDER_BOOK: 1_000,
  ORDERS: 5_000,
} as const;

/**
 * Derive a TTL for a given Poloniex endpoint path.
 * Returns 0 for endpoints that should not be cached.
 */
export function getTtlForEndpoint(endpoint: string): number {
  if (endpoint.includes('/account/balance')) return CACHE_TTL.BALANCE;
  if (endpoint.includes('/trade/position')) return CACHE_TTL.POSITIONS;
  if (endpoint.includes('/market/tickers')) return CACHE_TTL.TICKERS;
  if (endpoint.includes('/market/candles') || endpoint.includes('/market/get-kline')) return CACHE_TTL.CANDLES;
  if (endpoint.includes('/market/orderBook')) return CACHE_TTL.ORDER_BOOK;
  if (endpoint.includes('/trade/order')) return CACHE_TTL.ORDERS;
  return 0; // do not cache
}
