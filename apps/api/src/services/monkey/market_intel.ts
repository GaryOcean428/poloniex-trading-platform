/**
 * market_intel.ts — wider market-data ingestion (Phase E).
 *
 * The kernel's perception basin is built almost entirely from the
 * symbol's own OHLCV. Poloniex v3 exposes several market-data endpoints
 * the kernel never touched — Open Interest, Index Price, Mark Price,
 * Funding Rate — that carry information OHLCV cannot: positioning
 * (is new money entering or is the move an unwind?) and crowding (are
 * longs paying a premium over spot?). Feeding these in is what lets the
 * kernel "learn and continuously adapt" beyond pure price action.
 *
 * This module fetches those endpoints, derives a small set of signals,
 * and caches them per symbol. The endpoints are public — no credentials.
 *
 * Phase E scope is ADDITIVE + shadow-only — the cache is populated and
 * surfaced as telemetry; no decision path consumes it yet. Folding the
 * signals into the perception basin's dimensions is the behavioural
 * payoff and a deliberate follow-on (it changes regime classification,
 * so it earns its own observation window).
 *
 * Derived signals:
 *   premiumBasisPct — (mark − index)/index × 100. Positive = mark above
 *     spot = perps trading rich = longs crowded / over-leveraged (a
 *     mean-reversion headwind for longs). Negative = shorts crowded.
 *   oiDelta / oiDirection — change in Open Interest vs the prior
 *     observation. Rising OI = new money committing (trend
 *     confirmation); falling OI = positions unwinding (exhaustion).
 *
 * Singleton, mirroring aggregate_peak.ts / ws_position_cache.ts.
 */

import { logger } from '../../utils/logger.js';
import poloniexFuturesService from '../poloniexFuturesService.js';

export interface MarketSignals {
  /** (mark − index)/index × 100. */
  premiumBasisPct: number;
  /** Open-interest change vs the previous observation (contracts). */
  oiDelta: number;
  /** Sign of oiDelta: +1 building, −1 unwinding, 0 flat/first-obs. */
  oiDirection: -1 | 0 | 1;
}

export interface MarketIntelSnapshot extends MarketSignals {
  symbol: string;
  openInterest: number;
  indexPrice: number;
  markPrice: number;
  fundingRate: number;
  observedAt: number;
}

/**
 * Derive the market signals from raw readings. Pure — no I/O, no clock.
 * `prevOpenInterest` is null on the first observation for a symbol, in
 * which case oiDelta is 0 and oiDirection is 0 (no baseline to compare).
 */
export function deriveMarketSignals(args: {
  openInterest: number;
  prevOpenInterest: number | null;
  indexPrice: number;
  markPrice: number;
}): MarketSignals {
  const { openInterest, prevOpenInterest, indexPrice, markPrice } = args;

  const premiumBasisPct = indexPrice > 0
    ? ((markPrice - indexPrice) / indexPrice) * 100
    : 0;

  const oiDelta = prevOpenInterest === null
    ? 0
    : openInterest - prevOpenInterest;
  const oiDirection: -1 | 0 | 1 =
    oiDelta > 0 ? 1 : oiDelta < 0 ? -1 : 0;

  return { premiumBasisPct, oiDelta, oiDirection };
}

/** Coerce a possibly-nested API numeric field to a finite number. */
function pickNum(obj: unknown, ...keys: string[]): number {
  if (obj && typeof obj === 'object') {
    const rec = obj as Record<string, unknown>;
    // Poloniex wraps payloads as { data: {...} } or { data: [{...}] }.
    const data = rec.data ?? rec;
    const target = Array.isArray(data) ? data[0] : data;
    if (target && typeof target === 'object') {
      const t = target as Record<string, unknown>;
      for (const k of keys) {
        const n = Number(t[k]);
        if (Number.isFinite(n) && n !== 0) return n;
      }
    }
  }
  return 0;
}

class MarketIntelCache {
  private snapshots: Map<string, MarketIntelSnapshot> = new Map();
  private refreshing: Set<string> = new Set();

  /**
   * Fetch + derive + cache market intel for a symbol. Public endpoints,
   * no credentials. Fully fail-soft — a failed fetch leaves the prior
   * snapshot intact and logs at debug. A concurrent refresh for the
   * same symbol is skipped (the `refreshing` guard) so a slow fetch
   * can't stack.
   */
  async refresh(symbol: string): Promise<void> {
    if (this.refreshing.has(symbol)) return;
    this.refreshing.add(symbol);
    try {
      const [oiRes, idxRes, markRes, fundRes] = await Promise.all([
        poloniexFuturesService.getOpenInterest(symbol),
        poloniexFuturesService.getIndexPrice(symbol),
        poloniexFuturesService.getMarkPrice(symbol),
        poloniexFuturesService.getFundingRate(symbol),
      ]);

      const openInterest = pickNum(oiRes, 'openInterest', 'oi', 'value');
      const indexPrice = pickNum(idxRes, 'indexPrice', 'iPx', 'price');
      const markPrice = pickNum(markRes, 'markPrice', 'mPx', 'price');
      const fundingRate = pickNum(fundRes, 'fundingRate', 'fundingRate8h', 'rate');

      const prev = this.snapshots.get(symbol);
      const signals = deriveMarketSignals({
        openInterest,
        prevOpenInterest: prev ? prev.openInterest : null,
        indexPrice,
        markPrice,
      });

      this.snapshots.set(symbol, {
        symbol,
        openInterest, indexPrice, markPrice, fundingRate,
        ...signals,
        observedAt: Date.now(),
      });
    } catch (err) {
      logger.debug('[MarketIntel] refresh failed — prior snapshot kept', {
        symbol, err: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.refreshing.delete(symbol);
    }
  }

  /**
   * Refresh only if the cached snapshot is older than `maxAgeMs` (or
   * absent). OI / index move on a minutes timescale — calling this each
   * tick with a 60s window keeps the cache fresh without hammering the
   * public endpoints.
   */
  async refreshIfStale(symbol: string, maxAgeMs: number): Promise<void> {
    const s = this.snapshots.get(symbol);
    if (!s || Date.now() - s.observedAt > maxAgeMs) {
      await this.refresh(symbol);
    }
  }

  /** Latest snapshot for a symbol, or null if never refreshed. */
  get(symbol: string): MarketIntelSnapshot | null {
    return this.snapshots.get(symbol) ?? null;
  }

  /** Telemetry — all cached snapshots. */
  snapshot(): MarketIntelSnapshot[] {
    return Array.from(this.snapshots.values());
  }

  /** Test/reset helper. */
  resetForTests(): void {
    this.snapshots.clear();
    this.refreshing.clear();
  }
}

export const marketIntelCache = new MarketIntelCache();
export type { MarketIntelCache };
