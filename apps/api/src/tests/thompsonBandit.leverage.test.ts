/**
 * Thompson bandit leverage-bucket tests.
 *
 * Verifies the bucket boundaries used for the third dimension of the
 * bandit posterior key. Boundary behaviour is load-bearing — a drift
 * by 1 at the boundary re-buckets existing trades into the wrong
 * posterior and poisons both sides of the split.
 */
import { describe, expect, it } from 'vitest';

import {
  ALL_LEVERAGE_BUCKETS,
  bucketOfLeverage,
} from '../services/thompsonBandit.js';

describe('bucketOfLeverage', () => {
  it('buckets leverage <= 3x as low', () => {
    expect(bucketOfLeverage(1)).toBe('low');
    expect(bucketOfLeverage(2)).toBe('low');
    expect(bucketOfLeverage(3)).toBe('low');
  });

  it('buckets 4x..10x as mid', () => {
    expect(bucketOfLeverage(4)).toBe('mid');
    expect(bucketOfLeverage(5)).toBe('mid');
    expect(bucketOfLeverage(10)).toBe('mid');
  });

  it('buckets >=11x as high', () => {
    expect(bucketOfLeverage(11)).toBe('high');
    expect(bucketOfLeverage(20)).toBe('high');
    expect(bucketOfLeverage(100)).toBe('high');
  });

  it('handles fractional leverage at the boundaries', () => {
    // Fractional leverages inside the low band.
    expect(bucketOfLeverage(2.5)).toBe('low');
    expect(bucketOfLeverage(3.0)).toBe('low');
    // Just over the low/mid boundary.
    expect(bucketOfLeverage(3.0001)).toBe('mid');
    // Just over the mid/high boundary.
    expect(bucketOfLeverage(10.0001)).toBe('high');
  });

  it('classifies 0 and negative leverage as low (degenerate but consistent)', () => {
    // Not realistic inputs — the risk kernel would never emit an order
    // with 0 or negative leverage — but the helper must never throw and
    // should return a stable bucket so the bandit key never degenerates.
    expect(bucketOfLeverage(0)).toBe('low');
    expect(bucketOfLeverage(-1)).toBe('low');
  });

  it('exports the full bucket set in order', () => {
    expect(ALL_LEVERAGE_BUCKETS).toEqual(['low', 'mid', 'high']);
  });
});
