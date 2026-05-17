import { describe, it, expect } from 'vitest';
import { wilsonCI } from '../self_observation.js';

describe('wilsonCI', () => {
  it('returns full [0,1] when trades=0 (no information sentinel)', () => {
    expect(wilsonCI(0, 0)).toEqual({ lower: 0, upper: 1 });
  });

  it('produces a wide CI that includes 0.5 with small samples', () => {
    // 3 trades, 2 wins (winRate=0.67) — classic small-sample case where the
    // old MIN_SAMPLE_FOR_BIAS=3 gate would have fired but the CI is so wide
    // there is no real evidence of asymmetry.
    const ci = wilsonCI(2, 3);
    expect(ci.lower).toBeLessThan(0.5);
    expect(ci.upper).toBeGreaterThan(0.5);
    // Wilson 95% for 2/3: roughly [0.21, 0.94]
    expect(ci.lower).toBeGreaterThan(0.15);
    expect(ci.lower).toBeLessThan(0.30);
    expect(ci.upper).toBeGreaterThan(0.85);
    expect(ci.upper).toBeLessThan(0.98);
  });

  it('CI tightens as sample size grows', () => {
    const small = wilsonCI(20, 30);  // 0.67 with n=30
    const large = wilsonCI(200, 300); // 0.67 with n=300
    const veryLarge = wilsonCI(2000, 3000);
    const smallWidth = small.upper - small.lower;
    const largeWidth = large.upper - large.lower;
    const veryLargeWidth = veryLarge.upper - veryLarge.lower;
    expect(largeWidth).toBeLessThan(smallWidth);
    expect(veryLargeWidth).toBeLessThan(largeWidth);
    // Very-large sample CI should be narrow enough to clearly exclude 0.5
    expect(veryLarge.lower).toBeGreaterThan(0.5);
  });

  it('CI is bounded to [0, 1]', () => {
    const allWins = wilsonCI(50, 50);
    expect(allWins.lower).toBeGreaterThanOrEqual(0);
    expect(allWins.upper).toBeLessThanOrEqual(1);
    expect(allWins.lower).toBeLessThan(1);  // even all-wins doesn't give point estimate

    const allLosses = wilsonCI(0, 50);
    expect(allLosses.lower).toBeGreaterThanOrEqual(0);
    expect(allLosses.upper).toBeLessThanOrEqual(1);
    expect(allLosses.upper).toBeGreaterThan(0);  // even all-losses doesn't give point estimate
  });

  it('is symmetric around 0.5 for symmetric inputs', () => {
    const wins70 = wilsonCI(7, 10);   // 70 % win
    const wins30 = wilsonCI(3, 10);   // 30 % win
    // The widths should match; the centers should be equidistant from 0.5.
    const w70Width = wins70.upper - wins70.lower;
    const w30Width = wins30.upper - wins30.lower;
    expect(Math.abs(w70Width - w30Width)).toBeLessThan(1e-9);
    const center70 = (wins70.lower + wins70.upper) / 2;
    const center30 = (wins30.lower + wins30.upper) / 2;
    expect(Math.abs((center70 - 0.5) + (center30 - 0.5))).toBeLessThan(1e-9);
  });

  it('matches a known reference point: 100/200 = 0.5 ± ~0.07', () => {
    // 100 wins out of 200 — Wilson 95% CI is approximately [0.430, 0.570]
    const ci = wilsonCI(100, 200);
    expect(ci.lower).toBeGreaterThan(0.42);
    expect(ci.lower).toBeLessThan(0.44);
    expect(ci.upper).toBeGreaterThan(0.56);
    expect(ci.upper).toBeLessThan(0.58);
  });

  it('reproduces the SELFOBS-1 audit motivating example', () => {
    // The audit's complaint about MAX_BIAS_SWING=0.30 + MIN_SAMPLE_FOR_BIAS=3:
    // with 3 trades and 1 win, the old code would have emitted a bias of
    // 1 + 2*0.30*(0.5-0.33) = 1.10 (10% harder entry) even though the
    // Wilson CI is wildly uncertain.
    const ci = wilsonCI(1, 3);
    // CI should clearly cover 0.5 → no evidence → bias should stay neutral
    expect(ci.lower).toBeLessThan(0.5);
    expect(ci.upper).toBeGreaterThan(0.5);
  });
});
