/**
 * perceptionCanonicalDims.test.ts — PERCEPTION-1 dims 0/1/2 canonical
 * one-hot encoding tests.
 *
 * Verifies the canonical (one-hot) encoding selected when the
 * PERCEPTION_V2_LIVE flag is set AND the caller supplies a
 * canonicalRegime. Ordering matches the canonical Python convention:
 *   0 = CREATOR, 1 = PRESERVER, 2 = DISSOLVER.
 *
 * Legacy fallback path verified separately — when flag is off or
 * canonicalRegime is null/undefined, the legacy ATR/trend×ml/residual
 * encoding stands.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('perception canonical dims (PERCEPTION-1)', () => {
  it('canonicalRegime ignored when PERCEPTION_V2_LIVE is unset → legacy path', () => {
    delete process.env.PERCEPTION_V2_LIVE;
    const basin = perceive({
      ohlcv: syntheticOhlcv(100),
      equityFraction: 1, marginFraction: 0, openPositions: 0, sessionAgeTicks: 0,
      canonicalRegime: 'creator',
    });
    // Legacy v[0] = norm01(vol_frac, 0.01) is NOT one-hot at ~0.998.
    expect(basin[0]).toBeLessThan(0.9);
  });

  it('canonicalRegime=creator → dim 0 ≈ 1 - 2ε, dims 1,2 ≈ ε (when flag on)', () => {
    process.env.PERCEPTION_V2_LIVE = 'true';
    const basin = perceive({
      ohlcv: syntheticOhlcv(100),
      equityFraction: 1, marginFraction: 0, openPositions: 0, sessionAgeTicks: 0,
      canonicalRegime: 'creator',
    });
    // Note: toSimplex() normalises across all 64 dims so we can only
    // verify the ORDERING and the relative weights between dims 0/1/2.
    expect(basin[0]).toBeGreaterThan(basin[1]!);
    expect(basin[0]).toBeGreaterThan(basin[2]!);
    expect(basin[1]).toBeCloseTo(basin[2]!, 4);  // both ≈ ε
  });

  it('canonicalRegime=preserver → dim 1 ≫ dims 0, 2 (when flag on)', () => {
    process.env.PERCEPTION_V2_LIVE = 'true';
    const basin = perceive({
      ohlcv: syntheticOhlcv(100),
      equityFraction: 1, marginFraction: 0, openPositions: 0, sessionAgeTicks: 0,
      canonicalRegime: 'preserver',
    });
    expect(basin[1]).toBeGreaterThan(basin[0]!);
    expect(basin[1]).toBeGreaterThan(basin[2]!);
    expect(basin[0]).toBeCloseTo(basin[2]!, 4);
  });

  it('canonicalRegime=dissolver → dim 2 ≫ dims 0, 1 (when flag on)', () => {
    process.env.PERCEPTION_V2_LIVE = 'true';
    const basin = perceive({
      ohlcv: syntheticOhlcv(100),
      equityFraction: 1, marginFraction: 0, openPositions: 0, sessionAgeTicks: 0,
      canonicalRegime: 'dissolver',
    });
    expect(basin[2]).toBeGreaterThan(basin[0]!);
    expect(basin[2]).toBeGreaterThan(basin[1]!);
    expect(basin[0]).toBeCloseTo(basin[1]!, 4);
  });

  it('canonicalRegime=null with flag on → legacy path (fail-soft)', () => {
    process.env.PERCEPTION_V2_LIVE = 'true';
    const basin = perceive({
      ohlcv: syntheticOhlcv(100),
      equityFraction: 1, marginFraction: 0, openPositions: 0, sessionAgeTicks: 0,
      canonicalRegime: null,
    });
    // Legacy v[1] is 0 (mlEffectiveStrength missing) so dim 1 should
    // be the smallest; dim 0 (quantum) gets ATR mass.
    expect(basin[1]).toBeLessThan(basin[0]!);
  });
});
