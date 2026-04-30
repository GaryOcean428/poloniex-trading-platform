import { describe, it, expect } from 'vitest';
import { currentLeverage, kellyLeverageCap } from '../executive.js';
import { BASIN_DIM } from '../basin.js';
import { MonkeyMode } from '../modes.js';

const NEUTRAL_NC = {
  acetylcholine: 0.5, dopamine: 0.5, serotonin: 0.5,
  norepinephrine: 0, gaba: 0.5, endorphins: 0.5,
};

function basinState(sovereignty = 0.7, phi = 0.5) {
  const b = new Float64Array(BASIN_DIM).fill(1 / BASIN_DIM);
  return {
    basin: b as unknown as Float64Array,
    identityBasin: b as unknown as Float64Array,
    phi,
    kappa: 64,
    basinVelocity: 0,
    regimeWeights: { equilibrium: 1, efficient: 0, quantum: 0 },
    sovereignty,
    neurochemistry: NEUTRAL_NC,
  } as any;
}

describe('kellyLeverageCap (proposal #3)', () => {
  it('high winrate / good payoff -> sizeable cap', () => {
    expect(kellyLeverageCap(0.7, 2, -1, 40)).toBeCloseTo(22, 0);
  });

  it('break-even returns 1', () => {
    expect(kellyLeverageCap(0.5, 1, -1, 40)).toBe(1);
  });

  it('negative expectancy returns 1', () => {
    expect(kellyLeverageCap(0.30, 1, -1, 40)).toBe(1);
  });

  it('no losses -> max', () => {
    expect(kellyLeverageCap(1.0, 2, 0, 40)).toBe(40);
  });

  it('no wins -> 1', () => {
    expect(kellyLeverageCap(0, 2, -1, 40)).toBe(1);
  });

  it('handles avgLoss negative or positive identically', () => {
    expect(kellyLeverageCap(0.7, 2, -1, 40))
      .toBe(kellyLeverageCap(0.7, 2, 1, 40));
  });

  it('user session 71/0.24/0.05 maps reasonably', () => {
    expect(kellyLeverageCap(0.71, 0.24, -0.05, 40)).toBeCloseTo(26, 0);
  });

  it('clamps at max for extreme edge', () => {
    expect(kellyLeverageCap(0.99, 10, -0.1, 40)).toBe(40);
  });

  it('returns at least 1', () => {
    expect(kellyLeverageCap(0.51, 0.01, -1, 40)).toBeGreaterThanOrEqual(1);
  });

  it('monotonic in winrate', () => {
    let prev = kellyLeverageCap(0, 2, -1, 40);
    for (const p of [0.2, 0.4, 0.6, 0.8, 1.0]) {
      const cur = kellyLeverageCap(p, 2, -1, 40);
      expect(cur).toBeGreaterThanOrEqual(prev);
      prev = cur;
    }
  });
});

describe('currentLeverage Kelly cap integration', () => {
  it('no rollingStats -> kelly_cap = max_lev (no-op)', () => {
    const out = currentLeverage(basinState(), 40, MonkeyMode.INVESTIGATION, 0);
    expect((out.derivation as any).kellyCap).toBe(40);
  });

  it('break-even rollingStats -> lowers leverage', () => {
    const noKelly = currentLeverage(basinState(), 40, MonkeyMode.INVESTIGATION, 0);
    const kellyClamped = currentLeverage(
      basinState(), 40, MonkeyMode.INVESTIGATION, 0,
      { winRate: 0.5, avgWin: 1, avgLoss: -1 },
    );
    expect(kellyClamped.value).toBeLessThanOrEqual(noKelly.value);
    expect(kellyClamped.value).toBeGreaterThanOrEqual(1);
  });

  it('strong-edge rollingStats -> kelly_cap = max_lev', () => {
    const out = currentLeverage(
      basinState(), 40, MonkeyMode.INVESTIGATION, 0,
      { winRate: 0.99, avgWin: 10, avgLoss: -0.1 },
    );
    expect((out.derivation as any).kellyCap).toBe(40);
  });

  it('reason string includes kelly_cap', () => {
    const out = currentLeverage(
      basinState(), 40, MonkeyMode.INVESTIGATION, 0,
      { winRate: 0.7, avgWin: 2, avgLoss: -1 },
    );
    expect(out.reason).toMatch(/kelly_cap=\d+/);
  });
});
