/**
 * perceptionCanonicalDims.test.ts — perception dims 0/1/2 canonical
 * one-hot encoding tests.
 *
 * Canonical Python ordering: 0 = CREATOR, 1 = PRESERVER, 2 = DISSOLVER.
 * Caller passes the regime label fetched from ml-worker's
 * /regime/classify_prices; perception encodes it as one-hot with
 * ε=1e-3 padding. When the classifier is unreachable the caller
 * passes null and perception emits a uniform 1/3 prior.
 *
 * No flag. No legacy fallback. Canonical is the only path.
 */

import { describe, expect, it } from 'vitest';

import { perceive, type OHLCVCandle } from '../perception.js';

function syntheticOhlcv(n: number, startPrice = 100): OHLCVCandle[] {
  const out: OHLCVCandle[] = [];
  for (let i = 0; i < n; i++) {
    const p = startPrice + i * 0.5;
    out.push({
      timestamp: 1_700_000_000 + i * 60,
      open: p, high: p + 0.1, low: p - 0.1, close: p, volume: 1000,
    });
  }
  return out;
}

describe('perception canonical dims', () => {
  it('canonicalRegime=creator → dim 0 ≫ dims 1, 2', () => {
    const basin = perceive({
      ohlcv: syntheticOhlcv(100),
      equityFraction: 1, marginFraction: 0, openPositions: 0, sessionAgeTicks: 0,
      canonicalRegime: 'creator',
    });
    expect(basin[0]).toBeGreaterThan(basin[1]!);
    expect(basin[0]).toBeGreaterThan(basin[2]!);
    expect(basin[1]).toBeCloseTo(basin[2]!, 4);  // both ≈ ε
  });

  it('canonicalRegime=preserver → dim 1 ≫ dims 0, 2', () => {
    const basin = perceive({
      ohlcv: syntheticOhlcv(100),
      equityFraction: 1, marginFraction: 0, openPositions: 0, sessionAgeTicks: 0,
      canonicalRegime: 'preserver',
    });
    expect(basin[1]).toBeGreaterThan(basin[0]!);
    expect(basin[1]).toBeGreaterThan(basin[2]!);
    expect(basin[0]).toBeCloseTo(basin[2]!, 4);
  });

  it('canonicalRegime=dissolver → dim 2 ≫ dims 0, 1', () => {
    const basin = perceive({
      ohlcv: syntheticOhlcv(100),
      equityFraction: 1, marginFraction: 0, openPositions: 0, sessionAgeTicks: 0,
      canonicalRegime: 'dissolver',
    });
    expect(basin[2]).toBeGreaterThan(basin[0]!);
    expect(basin[2]).toBeGreaterThan(basin[1]!);
    expect(basin[0]).toBeCloseTo(basin[1]!, 4);
  });

  it('canonicalRegime=null → uniform 1/3 prior on dims 0/1/2 (classifier unreachable)', () => {
    const basin = perceive({
      ohlcv: syntheticOhlcv(100),
      equityFraction: 1, marginFraction: 0, openPositions: 0, sessionAgeTicks: 0,
      canonicalRegime: null,
    });
    expect(basin[0]).toBeCloseTo(basin[1]!, 4);
    expect(basin[1]).toBeCloseTo(basin[2]!, 4);
  });

  it('canonicalRegime omitted → uniform 1/3 prior (same fail-soft as null)', () => {
    const basin = perceive({
      ohlcv: syntheticOhlcv(100),
      equityFraction: 1, marginFraction: 0, openPositions: 0, sessionAgeTicks: 0,
    });
    expect(basin[0]).toBeCloseTo(basin[1]!, 4);
    expect(basin[1]).toBeCloseTo(basin[2]!, 4);
  });
});
