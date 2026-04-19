/**
 * Anchor-strategy sanity tests.
 *
 * Anchors are the cold-start cure for the SLE pipeline — they must be
 * well-formed SignalGenome objects that the backtest engine can
 * actually execute. These tests lock the contract so a genome refactor
 * can't silently break anchors.
 */

import { describe, expect, it } from 'vitest';
import { ANCHOR_STRATEGIES, getAnchorsForRegime } from '../anchorStrategies.js';

describe('anchor strategies', () => {
  it('exposes at least 3 seed strategies', () => {
    expect(ANCHOR_STRATEGIES.length).toBeGreaterThanOrEqual(3);
  });

  it('every anchor has a stable anchor_ prefixed id', () => {
    for (const a of ANCHOR_STRATEGIES) {
      expect(a.id).toMatch(/^anchor_/);
    }
  });

  it('every anchor has a valid (non-empty) genome with both long and short conditions', () => {
    for (const a of ANCHOR_STRATEGIES) {
      const hasLong = a.genome.entryConditions.some((c) => c.side === 'long' || c.side === 'both');
      const hasShort = a.genome.entryConditions.some((c) => c.side === 'short' || c.side === 'both');
      expect(hasLong, `${a.id} missing long entry`).toBe(true);
      expect(hasShort, `${a.id} missing short entry`).toBe(true);
    }
  });

  it('every anchor has sane risk parameters', () => {
    for (const a of ANCHOR_STRATEGIES) {
      expect(a.genome.stopLossPercent).toBeGreaterThan(0);
      expect(a.genome.stopLossPercent).toBeLessThan(0.05);
      expect(a.genome.takeProfitPercent).toBeGreaterThan(a.genome.stopLossPercent);
      expect(a.genome.takeProfitPercent).toBeLessThan(0.10);
      expect(a.genome.positionSizeFraction).toBeGreaterThan(0);
      expect(a.genome.positionSizeFraction).toBeLessThanOrEqual(0.10);
    }
  });

  it('every anchor targets a supported symbol and timeframe', () => {
    const supportedSymbols = new Set([
      'BTC_USDT_PERP',
      'ETH_USDT_PERP',
      'SOL_USDT_PERP',
      'XRP_USDT_PERP',
    ]);
    const supportedTfs = new Set(['5m', '15m', '1h', '4h']);
    for (const a of ANCHOR_STRATEGIES) {
      expect(supportedSymbols.has(a.symbol), `${a.id} bad symbol`).toBe(true);
      expect(supportedTfs.has(a.timeframe), `${a.id} bad timeframe`).toBe(true);
    }
  });

  it('covers at least two regimes so anchors work in multiple markets', () => {
    const regimes = new Set(ANCHOR_STRATEGIES.map((a) => a.regimeAffinity));
    expect(regimes.size).toBeGreaterThanOrEqual(2);
  });

  it('getAnchorsForRegime filters by regime affinity', () => {
    const trending = getAnchorsForRegime('trending');
    const ranging = getAnchorsForRegime('ranging');
    expect(trending.length).toBeGreaterThan(0);
    expect(ranging.length).toBeGreaterThan(0);
    // At least one anchor is trending-only so the two sets differ.
    expect(trending.map((a) => a.id).sort()).not.toEqual(ranging.map((a) => a.id).sort());
  });

  it('getAnchorsForRegime("unknown") returns all anchors', () => {
    expect(getAnchorsForRegime('unknown').length).toBe(ANCHOR_STRATEGIES.length);
  });

  it('anchor leverages are reasonable (≤10x) for the per-symbol kernel cap', () => {
    for (const a of ANCHOR_STRATEGIES) {
      expect(a.leverage).toBeGreaterThan(0);
      expect(a.leverage).toBeLessThanOrEqual(10);
    }
  });
});
