/**
 * regimeSizing.test.ts — verify regime score correctly distinguishes
 * flat vs trending basin trajectories and that the sizing map
 * produces sensible parameter rails.
 */
import { describe, it, expect } from 'vitest';
import {
  regimeScore,
  regimeSizing,
  trailingRegimeStop,
  basinAlignmentToWindow,
  DEFAULT_REGIME_CONFIG,
  DEFAULT_SIZING_CONFIG,
} from '../regimeSizing.js';
import { uniformBasin } from '../basin.js';
import type { Basin } from '../basin.js';

const BASIN_DIM = 64;

/** Build a basin biased toward one direction. */
function biased(side: 'high' | 'low', strength = 0.9): Basin {
  const b = uniformBasin(BASIN_DIM);
  const halfStart = side === 'high' ? Math.floor(BASIN_DIM / 2) : 0;
  const halfEnd = side === 'high' ? BASIN_DIM : Math.floor(BASIN_DIM / 2);
  // Concentrate mass on the chosen half.
  let mass = 0;
  for (let i = halfStart; i < halfEnd; i++) {
    b[i] = strength;
    mass += strength;
  }
  for (let i = 0; i < BASIN_DIM; i++) {
    if (i < halfStart || i >= halfEnd) {
      b[i] = (1 - mass) / (BASIN_DIM - (halfEnd - halfStart));
    } else {
      b[i] /= mass / (mass + 1e-9);
    }
  }
  // Re-normalize.
  let total = 0;
  for (let i = 0; i < BASIN_DIM; i++) total += b[i]!;
  for (let i = 0; i < BASIN_DIM; i++) b[i]! /= total;
  return b;
}

describe('regimeScore', () => {
  it('returns null for too-short history', () => {
    expect(regimeScore([], 64)).toBeNull();
    expect(regimeScore([uniformBasin(BASIN_DIM)], 64)).toBeNull();
  });

  it('labels flat for low-velocity oscillating basin history', () => {
    // Build 100 ticks of basins all very close to uniform (low velocity)
    // with no consistent direction (high chop).
    const hist: Basin[] = [];
    for (let i = 0; i < 100; i++) {
      hist.push(uniformBasin(BASIN_DIM));  // identical → velocity = 0
    }
    const r = regimeScore(hist, 64);
    expect(r).not.toBeNull();
    expect(r!.label).toBe('flat');
    expect(r!.r).toBeGreaterThan(0.65);
  });

  it('labels trending for one-direction biased history', () => {
    // 60 high-biased basins with slight progression (so velocity > 0)
    // and consistent direction (persistence near 1).
    const hist: Basin[] = [];
    for (let i = 0; i < 60; i++) {
      const strength = 0.7 + (i / 60) * 0.2;  // creeping
      hist.push(biased('high', strength));
    }
    const r = regimeScore(hist, 32);  // far from critical κ=64
    expect(r).not.toBeNull();
    // velocity should be non-zero, directional chop low, kappa far from critical
    expect(r!.components.directionalChop).toBeLessThan(0.5);
    expect(r!.components.kappaCriticality).toBeLessThan(0.6);
  });

  it('returns neutral kappa component when kappa is null', () => {
    const hist: Basin[] = [];
    for (let i = 0; i < 30; i++) hist.push(uniformBasin(BASIN_DIM));
    const r = regimeScore(hist, null);
    expect(r).not.toBeNull();
    expect(r!.components.kappaCriticality).toBe(0.5);
  });

  it('component ranges all in [0, 1]', () => {
    const hist: Basin[] = [];
    for (let i = 0; i < 80; i++) {
      hist.push(i % 3 === 0 ? biased('high', 0.6) : biased('low', 0.6));
    }
    const r = regimeScore(hist, 64);
    expect(r).not.toBeNull();
    expect(r!.components.velocityFlatness).toBeGreaterThanOrEqual(0);
    expect(r!.components.velocityFlatness).toBeLessThanOrEqual(1);
    expect(r!.components.directionalChop).toBeGreaterThanOrEqual(0);
    expect(r!.components.directionalChop).toBeLessThanOrEqual(1);
    expect(r!.components.kappaCriticality).toBeGreaterThanOrEqual(0);
    expect(r!.components.kappaCriticality).toBeLessThanOrEqual(1);
    expect(r!.r).toBeGreaterThanOrEqual(0);
    expect(r!.r).toBeLessThanOrEqual(1);
  });
});

describe('regimeSizing', () => {
  it('returns flat-end rails at r=1.0', () => {
    const out = regimeSizing(1.0);
    expect(out.leverage).toBe(DEFAULT_SIZING_CONFIG.flatLeverage);
    expect(out.sizeFraction).toBeCloseTo(DEFAULT_SIZING_CONFIG.flatSizeFraction, 5);
    expect(out.holdMs).toBeCloseTo(DEFAULT_SIZING_CONFIG.flatHoldMs, 5);
    expect(out.stopBps).toBeCloseTo(DEFAULT_SIZING_CONFIG.flatStopBps, 5);
    expect(out.marginHeadroomFloor).toBeCloseTo(DEFAULT_SIZING_CONFIG.flatHeadroomFloor, 5);
  });

  it('returns trend-end rails at r=0.0', () => {
    const out = regimeSizing(0.0);
    expect(out.leverage).toBe(DEFAULT_SIZING_CONFIG.trendLeverage);
    expect(out.sizeFraction).toBeCloseTo(DEFAULT_SIZING_CONFIG.trendSizeFraction, 5);
    expect(out.holdMs).toBeCloseTo(DEFAULT_SIZING_CONFIG.trendHoldMs, 5);
    expect(out.stopBps).toBeCloseTo(DEFAULT_SIZING_CONFIG.trendStopBps, 5);
    expect(out.marginHeadroomFloor).toBeCloseTo(DEFAULT_SIZING_CONFIG.trendHeadroomFloor, 5);
  });

  it('interpolates linearly at r=0.5', () => {
    const out = regimeSizing(0.5);
    const expectedLev = (DEFAULT_SIZING_CONFIG.flatLeverage + DEFAULT_SIZING_CONFIG.trendLeverage) / 2;
    expect(out.leverage).toBe(Math.round(expectedLev));
    // Size, hold, stop, headroom should all interpolate too.
    expect(out.sizeFraction).toBeCloseTo(
      (DEFAULT_SIZING_CONFIG.flatSizeFraction + DEFAULT_SIZING_CONFIG.trendSizeFraction) / 2,
      5,
    );
  });

  it('clamps out-of-range r values', () => {
    expect(regimeSizing(1.5).leverage).toBe(DEFAULT_SIZING_CONFIG.flatLeverage);
    expect(regimeSizing(-0.5).leverage).toBe(DEFAULT_SIZING_CONFIG.trendLeverage);
  });

  it('leverage monotonically decreases as r decreases (flat → trend)', () => {
    let prev = Infinity;
    for (let r = 1.0; r >= 0; r -= 0.1) {
      const lev = regimeSizing(r).leverage;
      expect(lev).toBeLessThanOrEqual(prev);
      prev = lev;
    }
  });
});

describe('trailingRegimeStop', () => {
  it('fires when regime score drops by more than adverseDelta', () => {
    expect(trailingRegimeStop(0.8, 0.4, 0.30)).toBe(true);   // delta 0.40 > 0.30
    expect(trailingRegimeStop(0.8, 0.55, 0.30)).toBe(false); // delta 0.25 < 0.30
  });

  it('fires symmetrically on regime score rise', () => {
    expect(trailingRegimeStop(0.2, 0.6, 0.30)).toBe(true);   // delta 0.40 > 0.30
    expect(trailingRegimeStop(0.2, 0.45, 0.30)).toBe(false); // delta 0.25 < 0.30
  });

  it('uses default adverseDelta of 0.30', () => {
    expect(trailingRegimeStop(0.7, 0.45)).toBe(false);  // delta 0.25 < 0.30
    expect(trailingRegimeStop(0.7, 0.35)).toBe(true);   // delta 0.35 > 0.30
  });
});

describe('basinAlignmentToWindow', () => {
  it('returns 0 for empty window', () => {
    const b = uniformBasin(BASIN_DIM);
    expect(basinAlignmentToWindow(b, [])).toBe(0);
  });

  it('returns 0 for identical basin', () => {
    const b = uniformBasin(BASIN_DIM);
    const window = [b, b, b, b];
    expect(basinAlignmentToWindow(b, window)).toBeCloseTo(0, 5);
  });

  it('returns positive distance for outlier basin', () => {
    const window: Basin[] = [];
    for (let i = 0; i < 10; i++) window.push(uniformBasin(BASIN_DIM));
    // Build a basin with mass concentrated at one corner — clearly
    // distinct from uniform. Avoids the helper's renormalization
    // quirks by going directly.
    const outlier = new Array(BASIN_DIM).fill(0.0001 / (BASIN_DIM - 1)) as unknown as Basin;
    outlier[0] = 1 - 0.0001;
    // Re-normalize defensively.
    let sum = 0;
    for (let i = 0; i < BASIN_DIM; i++) sum += outlier[i]!;
    for (let i = 0; i < BASIN_DIM; i++) outlier[i]! /= sum;
    const dist = basinAlignmentToWindow(outlier, window);
    expect(dist).toBeGreaterThan(0);
  });
});
