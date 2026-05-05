/**
 * notionalCeiling.test.ts — v0.8.7 notional-ceiling fallback.
 *
 * Live tape 2026-05-01 evidence: $77 → $386 escalating notionals on
 * a $97 account (4× balance), 22% win rate, every close via single-tick
 * regime_change. The Kelly cap is non-binding at cold start (< 5
 * closed trades per lane in getKellyRollingStats) and decays to no-op
 * when stats are uninformative. The notional ceiling is a hard cap:
 * notional = margin × leverage <= NOTIONAL_CEILING_RATIO × equity.
 */
import { describe, it, expect } from 'vitest';
import { currentPositionSize, NOTIONAL_CEILING_RATIO } from '../executive.js';
import { BASIN_DIM } from '../basin.js';
import { MonkeyMode } from '../modes.js';

const NEUTRAL_NC = {
  acetylcholine: 0.5, dopamine: 0.6, serotonin: 0.6,
  norepinephrine: 0.5, gaba: 0.4, endorphins: 0.5,
};

function basinState(sovereignty = 0.8, phi = 0.6) {
  const b = new Float64Array(BASIN_DIM).fill(1 / BASIN_DIM);
  return {
    basin: b as unknown as Float64Array,
    identityBasin: b as unknown as Float64Array,
    phi,
    kappa: 64,
    basinVelocity: 0.05,
    regimeWeights: { equilibrium: 0.34, efficient: 0.33, quantum: 0.33 },
    sovereignty,
    neurochemistry: NEUTRAL_NC,
  } as any;
}

describe('NOTIONAL_CEILING_RATIO default', () => {
  it('is 4.0 by default', () => {
    expect(NOTIONAL_CEILING_RATIO).toBe(4.0);
  });
});

describe('currentPositionSize notional ceiling — live-tape scenario', () => {
  it('caps notional at 4× balance on the 2026-05-01 scenario ($97 acct, 20× lev)', () => {
    // Without the ceiling: lane cap 0.5 × 97 = $48.50 margin, 20× leverage
    // → $970 notional, > 10× balance. With ceiling 4× = $388 max.
    const out = currentPositionSize(
      basinState(),
      97,    // available equity
      5,     // min notional
      20,    // leverage
      20,    // bank size
      MonkeyMode.INVESTIGATION,
      'scalp',
    );
    const ceiling = 4.0 * 97;
    const d = out.derivation as any;
    expect(d.notional).toBeLessThanOrEqual(ceiling + 1e-9);
    expect(d.cappedByNotional).toBe(1);
    expect(d.margin * d.leverage).toBeLessThanOrEqual(ceiling + 1e-9);
  });

  it('surfaces ceiling + ratio in derivation', () => {
    const out = currentPositionSize(
      basinState(),
      100,
      5,
      10,
      20,
      MonkeyMode.INVESTIGATION,
      'scalp',
    );
    const d = out.derivation as any;
    expect(d.notionalCeilingRatio).toBe(4.0);
    expect(d.notionalCeiling).toBe(400);
  });

  it('surfaces ceiling in reason string when capped', () => {
    const out = currentPositionSize(
      basinState(),
      97,
      5,
      20,
      20,
      MonkeyMode.INVESTIGATION,
      'scalp',
    );
    expect(out.reason).toContain('notional-capped');
    expect(out.reason).toContain('ceiling');
  });
});

describe('currentPositionSize notional ceiling — non-binding cases', () => {
  it('low leverage keeps cap as no-op', () => {
    // $1000 account × 0.5 lane × 2× leverage = $1000 notional, well
    // below the $4000 ceiling.
    const out = currentPositionSize(
      basinState(0.5, 0.4),
      1000,
      10,
      2,
      20,
      MonkeyMode.INVESTIGATION,
      'scalp',
    );
    const d = out.derivation as any;
    expect(d.cappedByNotional).toBe(0);
    expect(d.notional).toBeLessThanOrEqual(4000);
  });

  it('zero equity returns size 0 without crashing', () => {
    const out = currentPositionSize(
      basinState(0.5, 0.4),
      0,
      10,
      10,
      20,
      MonkeyMode.INVESTIGATION,
      'scalp',
    );
    expect(out.value).toBe(0);
    expect((out.derivation as any).notional).toBe(0);
  });

  it('lane cap binds before ceiling for trend (budget=0.10 of $1000 = $100)', () => {
    // Was: trend.budgetFrac = 0 → margin collapses to 0.
    // 2026-05-05: trend on at 0.10 → margin cap is 10% of equity = $100.
    // Notional ceiling at 4× $1000 = $4000 is far higher, so the lane cap
    // is what binds first.
    const out = currentPositionSize(
      basinState(),
      1000,
      5,
      20,
      20,
      MonkeyMode.INVESTIGATION,
      'trend',
    );
    const d = out.derivation as any;
    expect(d.margin).toBeLessThanOrEqual(100 + 1e-6);
    expect(d.notional).toBeLessThanOrEqual(4000 + 1e-6);
  });
});
