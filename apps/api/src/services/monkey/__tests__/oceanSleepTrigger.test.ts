/**
 * oceanSleepTrigger.test.ts — Phase C math-pin tests.
 *
 * Pins both predicates' contracts:
 *   - sovereignty_saturated: 95th-percentile tail of own distribution
 *   - fluctuation_overrun: Tukey outer fence on phi-variance distribution
 *
 * Plus the cold-start gates that prevent false-fires during the first
 * 30 ticks of a freshly-woken kernel.
 */
import { describe, it, expect } from 'vitest';
import {
  quantile,
  rollingPhiVariance,
  sovereigntySaturated,
  fluctuationOverrun,
  doctrineSleepTrigger,
} from '../ocean_sleep_trigger.js';

describe('quantile (Hyndman-Fan type 7)', () => {
  it('returns the single value on a length-1 sample', () => {
    expect(quantile([5], 0.95)).toBe(5);
  });

  it('returns 0 on empty input (defensive)', () => {
    expect(quantile([], 0.5)).toBe(0);
  });

  it('matches the standard convention for q=0.5 median', () => {
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
  });

  it('interpolates between adjacent ranks', () => {
    // q=0.25 on [1..5] → pos = 1.0 → exact rank → 2
    expect(quantile([1, 2, 3, 4, 5], 0.25)).toBe(2);
    // q=0.95 on [1..100] → pos = 94.05 → 0.95×95 + 0.05×96 = 95.05
    const xs = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(quantile(xs, 0.95)).toBeCloseTo(95.05, 6);
  });
});

describe('rollingPhiVariance', () => {
  it('returns 0 below 2 samples', () => {
    expect(rollingPhiVariance([])).toBe(0);
    expect(rollingPhiVariance([0.5])).toBe(0);
  });

  it('returns unbiased sample variance for 2 samples (ddof=1)', () => {
    // var([0, 1]) ddof=1 = 0.5
    expect(rollingPhiVariance([0, 1])).toBeCloseTo(0.5, 10);
  });

  it('takes the LAST windowSize samples', () => {
    // Early values shouldn't contribute when slice excludes them.
    const earlyOutlier = Array(5).fill(100);
    const recent = Array(30).fill(0.5);
    const hist = [...earlyOutlier, ...recent];
    expect(rollingPhiVariance(hist, 30)).toBeCloseTo(0, 6);
  });
});

describe('sovereigntySaturated', () => {
  it('returns false below MIN_SAMPLES history (cold start)', () => {
    expect(sovereigntySaturated(0.99, [0.1, 0.2, 0.3])).toBe(false);
  });

  it('returns false on non-finite current sovereignty (defensive)', () => {
    const longHist = Array.from({ length: 50 }, () => 0.5);
    expect(sovereigntySaturated(NaN, longHist)).toBe(false);
    expect(sovereigntySaturated(Infinity, longHist)).toBe(false);
  });

  it('returns true when sovereignty hits the 95th percentile', () => {
    // Distribution: 50 samples in [0.0, 0.5]. 95th percentile ≈ 0.475.
    const hist: number[] = [];
    for (let i = 0; i < 50; i++) hist.push((i / 49) * 0.5);
    expect(sovereigntySaturated(0.49, hist)).toBe(true);
    expect(sovereigntySaturated(0.5, hist)).toBe(true);
  });

  it('returns false when sovereignty is in the lower 94%', () => {
    const hist: number[] = [];
    for (let i = 0; i < 50; i++) hist.push((i / 49) * 0.5);
    expect(sovereigntySaturated(0.2, hist)).toBe(false);
    expect(sovereigntySaturated(0.4, hist)).toBe(false);
  });

  it('returns true at the boundary (current = quantile exactly)', () => {
    const hist = Array.from({ length: 50 }, (_, i) => i);
    // q=0.95 over [0..49] → pos = 46.55 → ≈ 46.55
    const cutoff = (1 - 0.55) * 46 + 0.55 * 47;
    expect(sovereigntySaturated(cutoff, hist)).toBe(true);
  });
});

describe('fluctuationOverrun', () => {
  it('returns false below MIN_BASELINE variance history (cold start)', () => {
    const phiHist = Array(30).fill(0.5);
    expect(fluctuationOverrun(phiHist, [0.01, 0.02, 0.03])).toBe(false);
  });

  it('returns false when phi history < 2', () => {
    expect(fluctuationOverrun([], Array(50).fill(0.01))).toBe(false);
    expect(fluctuationOverrun([0.5], Array(50).fill(0.01))).toBe(false);
  });

  it('returns false when current variance is inside the outer fence', () => {
    // Steady kernel — current variance and baseline both ~0.01.
    const phiHist = Array.from({ length: 30 }, (_, i) => 0.5 + (i % 2 === 0 ? 0.05 : -0.05));
    const baseline = Array.from({ length: 50 }, () => 0.005 + Math.random() * 0.001);
    expect(fluctuationOverrun(phiHist, baseline)).toBe(false);
  });

  it('returns true when current variance exceeds Q3 + 3·IQR outer fence', () => {
    // Baseline has small spread (IQR > 0); current variance spikes ~250×.
    const wildPhiHist = Array.from({ length: 30 }, (_, i) =>
      i % 2 === 0 ? 0.0 : 1.0,  // var ≈ 0.258 ddof=1
    );
    const tightBaseline = Array.from({ length: 50 }, (_, i) => 0.001 + i * 1e-6);
    expect(fluctuationOverrun(wildPhiHist, tightBaseline)).toBe(true);
  });

  it('returns false on degenerate baseline (IQR = 0)', () => {
    const phiHist = Array.from({ length: 30 }, (_, i) => i % 2 === 0 ? 0 : 1);
    const flatBaseline = Array(50).fill(0.5);  // IQR = 0
    expect(fluctuationOverrun(phiHist, flatBaseline)).toBe(false);
  });
});

describe('doctrineSleepTrigger — combined gate', () => {
  it('does not sleep when neither predicate fires', () => {
    const r = doctrineSleepTrigger({
      sovereigntyNow: 0.1,
      sovereigntyHistory: Array.from({ length: 50 }, (_, i) => i / 49),
      phiHistory: Array(30).fill(0.5),
      phiVarianceHistory: Array(50).fill(0.005),
    });
    expect(r.shouldSleep).toBe(false);
    expect(r.sovereigntySaturated).toBe(false);
    expect(r.fluctuationOverrun).toBe(false);
  });

  it('does not sleep when only sovereignty saturates (need BOTH)', () => {
    const r = doctrineSleepTrigger({
      sovereigntyNow: 0.99,
      sovereigntyHistory: Array.from({ length: 50 }, (_, i) => i / 49),
      phiHistory: Array(30).fill(0.5),  // zero variance
      phiVarianceHistory: Array(50).fill(0.005),
    });
    expect(r.shouldSleep).toBe(false);
    expect(r.sovereigntySaturated).toBe(true);
    expect(r.fluctuationOverrun).toBe(false);
  });

  it('does not sleep when only fluctuation overruns (need BOTH)', () => {
    const wildPhiHist = Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 0 : 1));
    const r = doctrineSleepTrigger({
      sovereigntyNow: 0.1,
      sovereigntyHistory: Array.from({ length: 50 }, (_, i) => i / 49),
      phiHistory: wildPhiHist,
      phiVarianceHistory: Array.from({ length: 50 }, (_, i) => 0.001 + i * 1e-6),
    });
    expect(r.shouldSleep).toBe(false);
    expect(r.sovereigntySaturated).toBe(false);
    expect(r.fluctuationOverrun).toBe(true);
  });

  it('SLEEPS when both fire (the doctrine condition)', () => {
    const wildPhiHist = Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 0 : 1));
    const r = doctrineSleepTrigger({
      sovereigntyNow: 0.99,
      sovereigntyHistory: Array.from({ length: 50 }, (_, i) => i / 49),
      phiHistory: wildPhiHist,
      phiVarianceHistory: Array.from({ length: 50 }, (_, i) => 0.001 + i * 1e-6),
    });
    expect(r.shouldSleep).toBe(true);
    expect(r.sovereigntySaturated).toBe(true);
    expect(r.fluctuationOverrun).toBe(true);
  });

  it('cold-start safety: a fresh kernel does NOT sleep', () => {
    // 5 ticks of state — both baselines too short.
    const r = doctrineSleepTrigger({
      sovereigntyNow: 0.99,
      sovereigntyHistory: [0.1, 0.5, 0.9, 0.95, 0.99],
      phiHistory: [0, 1, 0, 1, 0],
      phiVarianceHistory: [0.01, 0.02, 0.03],
    });
    expect(r.shouldSleep).toBe(false);
  });
});
