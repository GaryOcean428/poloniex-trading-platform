/**
 * Tests for market_intel.ts — the Phase E wider market-data ingestion.
 * Covers the pure deriveMarketSignals function and the cache's
 * snapshot/reset surface.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  deriveMarketSignals,
  marketIntelCache,
} from '../services/monkey/market_intel.js';

describe('deriveMarketSignals — premium basis', () => {
  it('positive basis when mark trades above index (longs crowded)', () => {
    const s = deriveMarketSignals({
      openInterest: 1000, prevOpenInterest: 1000,
      indexPrice: 100, markPrice: 101,
    });
    expect(s.premiumBasisPct).toBeCloseTo(1.0, 6); // (101-100)/100×100
  });

  it('negative basis when mark trades below index (shorts crowded)', () => {
    const s = deriveMarketSignals({
      openInterest: 1000, prevOpenInterest: 1000,
      indexPrice: 200, markPrice: 199,
    });
    expect(s.premiumBasisPct).toBeCloseTo(-0.5, 6);
  });

  it('zero basis when index price is 0 (malformed) — no divide-by-zero', () => {
    const s = deriveMarketSignals({
      openInterest: 1000, prevOpenInterest: 1000,
      indexPrice: 0, markPrice: 100,
    });
    expect(s.premiumBasisPct).toBe(0);
  });
});

describe('deriveMarketSignals — open interest direction', () => {
  it('rising OI → oiDirection +1 (new money committing)', () => {
    const s = deriveMarketSignals({
      openInterest: 1200, prevOpenInterest: 1000,
      indexPrice: 100, markPrice: 100,
    });
    expect(s.oiDelta).toBe(200);
    expect(s.oiDirection).toBe(1);
  });

  it('falling OI → oiDirection −1 (positions unwinding)', () => {
    const s = deriveMarketSignals({
      openInterest: 800, prevOpenInterest: 1000,
      indexPrice: 100, markPrice: 100,
    });
    expect(s.oiDelta).toBe(-200);
    expect(s.oiDirection).toBe(-1);
  });

  it('flat OI → oiDirection 0', () => {
    const s = deriveMarketSignals({
      openInterest: 1000, prevOpenInterest: 1000,
      indexPrice: 100, markPrice: 100,
    });
    expect(s.oiDelta).toBe(0);
    expect(s.oiDirection).toBe(0);
  });

  it('first observation (prev null) → oiDelta 0, oiDirection 0', () => {
    const s = deriveMarketSignals({
      openInterest: 1000, prevOpenInterest: null,
      indexPrice: 100, markPrice: 100,
    });
    expect(s.oiDelta).toBe(0);
    expect(s.oiDirection).toBe(0);
  });
});

describe('marketIntelCache', () => {
  beforeEach(() => {
    marketIntelCache.resetForTests();
  });

  it('get returns null before any refresh', () => {
    expect(marketIntelCache.get('BTC_USDT_PERP')).toBeNull();
  });

  it('snapshot is empty before any refresh', () => {
    expect(marketIntelCache.snapshot()).toEqual([]);
  });
});
