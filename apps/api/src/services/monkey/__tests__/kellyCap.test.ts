import { describe, it, expect } from 'vitest';
import { currentLeverage, currentPositionSize, kellyLeverageCap } from '../executive.js';
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

  it('break-even defers to geometric (returns max_lev, no-op)', () => {
    // Pre-fix returned 1 and crushed leverage. Post-fix: uninformative
    // Kelly statistics defer to the geometric formula.
    expect(kellyLeverageCap(0.5, 1, -1, 40)).toBe(40);
  });

  it('negative expectancy defers to geometric (returns max_lev, no-op)', () => {
    expect(kellyLeverageCap(0.30, 1, -1, 40)).toBe(40);
  });

  it('no losses -> max (uninformative)', () => {
    expect(kellyLeverageCap(1.0, 2, 0, 40)).toBe(40);
  });

  it('no wins defers to geometric (returns max_lev, no-op)', () => {
    expect(kellyLeverageCap(0, 2, -1, 40)).toBe(40);
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

  it('monotonic in winrate when informative', () => {
    // Within the informative regime (positive edge), higher winrate
    // -> higher cap. b=2 implies break-even at p=1/3, so values
    // below ~0.34 are uninformative and defer to max_lev (no-op).
    let prev: number | null = null;
    for (const p of [0.4, 0.6, 0.8, 1.0]) {
      const cur = kellyLeverageCap(p, 2, -1, 40);
      if (prev !== null) {
        expect(cur).toBeGreaterThanOrEqual(prev);
      }
      prev = cur;
    }
  });

  it('floor prevents tiny edge from crushing leverage', () => {
    // Tiny positive Kelly fraction shouldn't crush leverage to 1.
    // b = 0.6/0.5 = 1.2; f* = (0.51*1.2 - 0.49)/1.2 ≈ 0.098.
    // raw_cap = round(0.098 * 40) = 4. Floored to 8.
    const cap = kellyLeverageCap(0.51, 0.6, -0.5, 40);
    expect(cap).toBeGreaterThanOrEqual(8);
    expect(cap).toBeLessThanOrEqual(40);
  });

  it('floor bounded by maxLev', () => {
    // If maxLev is below the floor, the cap must not exceed maxLev.
    const cap = kellyLeverageCap(0.51, 0.6, -0.5, 5);
    expect(cap).toBeLessThanOrEqual(5);
    expect(cap).toBeGreaterThanOrEqual(1);
  });
});

describe('currentLeverage Kelly cap integration', () => {
  it('no rollingStats -> kelly_cap = max_lev (no-op)', () => {
    const out = currentLeverage(basinState(), 40, MonkeyMode.INVESTIGATION, 0);
    expect((out.derivation as any).kellyCap).toBe(40);
  });

  it('break-even rollingStats -> kelly defers (no-op)', () => {
    // Post-fix: break-even Kelly stats are UNINFORMATIVE — the
    // cap returns max_lev so the geometric formula stands. This
    // is the fix for the live "leverage stuck at 1" bug.
    const noKelly = currentLeverage(basinState(), 40, MonkeyMode.INVESTIGATION, 0);
    const kellyNeutral = currentLeverage(
      basinState(), 40, MonkeyMode.INVESTIGATION, 0,
      { winRate: 0.5, avgWin: 1, avgLoss: -1 },
    );
    expect(kellyNeutral.value).toBe(noKelly.value);
    expect((kellyNeutral.derivation as any).kellyCap).toBe(40);
  });

  it('strong-edge rollingStats -> kelly_cap = max_lev', () => {
    const out = currentLeverage(
      basinState(), 40, MonkeyMode.INVESTIGATION, 0,
      { winRate: 0.99, avgWin: 10, avgLoss: -0.1 },
    );
    expect((out.derivation as any).kellyCap).toBe(40);
  });

  it('meaningful edge -> kelly cap binds between floor and max', () => {
    // f* = (0.7*2 - 0.3)/2 = 0.55. cap = round(0.55*45) = 25.
    const out = currentLeverage(
      basinState(), 45, MonkeyMode.INVESTIGATION, 0,
      { winRate: 0.7, avgWin: 2, avgLoss: -1 },
    );
    const cap = (out.derivation as any).kellyCap;
    expect(cap).toBeGreaterThanOrEqual(8);
    expect(cap).toBeLessThanOrEqual(45);
  });

  it('reason string includes kelly_cap', () => {
    const out = currentLeverage(
      basinState(), 40, MonkeyMode.INVESTIGATION, 0,
      { winRate: 0.7, avgWin: 2, avgLoss: -1 },
    );
    expect(out.reason).toMatch(/kelly_cap=\d+/);
  });
});

describe('currentLeverage live-trading regression (2026-04-30)', () => {
  /*
   * Root cause: kellyLeverageCap returned 1 when edge was weak/
   * negative (break-even, no wins, negative expectancy). The final
   * clamp min(geometric, kelly, max) then forced lev=1 regardless of
   * the geometric formula. This cascaded into currentPositionSize:
   * margin × 1 < min_notional → size=0 → no entries placed for hours.
   *
   * Live diag (PR #612 commit a5c0fe1): availableEquity=37.46, sov=1,
   * mode=INVESTIGATION → leverage=1 (expected ~16).
   */
  function liveBugBasinState(sovereignty: number) {
    const b = new Float64Array(BASIN_DIM).fill(1 / BASIN_DIM);
    return {
      basin: b as unknown as Float64Array,
      identityBasin: b as unknown as Float64Array,
      phi: 0.215,
      kappa: 64,
      basinVelocity: 0,
      regimeWeights: { equilibrium: 0.41, efficient: 0.16, quantum: 0.43 },
      sovereignty,
      neurochemistry: {
        acetylcholine: 0.5, dopamine: 0.5, serotonin: 1.0,
        norepinephrine: 0, gaba: 0.57, endorphins: 0.5,
      },
    } as any;
  }

  it('cold-start (rollingStats=null) -> leverage >= 10 (geometric)', () => {
    // bankSize=2 simulated: caller returns null when closed_trades < 5.
    // Geometric formula must produce a tradable leverage.
    const out = currentLeverage(
      liveBugBasinState(1.0), 45, MonkeyMode.INVESTIGATION, 0, null,
    );
    expect(out.value).toBeGreaterThanOrEqual(10);
    expect((out.derivation as any).kellyCap).toBe(45);
  });

  it('5+ trades break-even -> leverage >= 10 (kelly defers)', () => {
    // bankSize=10 simulated: rolling stats present but uninformative.
    // Pre-fix: cap=1 → lev=1. Post-fix: kelly defers to geometric.
    const out = currentLeverage(
      liveBugBasinState(1.0), 45, MonkeyMode.INVESTIGATION, 0,
      { winRate: 0.5, avgWin: 1, avgLoss: -1 },
    );
    expect(out.value).toBeGreaterThanOrEqual(10);
  });

  it('5+ trades negative-edge -> leverage >= 10 (kelly defers)', () => {
    // Pre-fix: cap=1 → lev=1. Post-fix: kelly defers (uninformative
    // for capping UP). Geometric formula's regime/κ/surprise discount
    // handles real market risk; kelly should not double-clamp.
    const out = currentLeverage(
      liveBugBasinState(1.0), 45, MonkeyMode.INVESTIGATION, 0,
      { winRate: 0.30, avgWin: 1, avgLoss: -1 },
    );
    expect(out.value).toBeGreaterThanOrEqual(10);
  });

  it('5+ trades meaningful edge -> kelly cap binds, leverage tradable', () => {
    // Real positive edge — Kelly cap acts as a CAP (binding when
    // geometric would exceed it). Final lev still tradable.
    const out = currentLeverage(
      liveBugBasinState(1.0), 45, MonkeyMode.INVESTIGATION, 0,
      { winRate: 0.7, avgWin: 2, avgLoss: -1 },
    );
    const cap = (out.derivation as any).kellyCap;
    expect(cap).toBeGreaterThanOrEqual(8);
    expect(cap).toBeLessThanOrEqual(45);
    expect(out.value).toBeGreaterThanOrEqual(8);
  });

  it('size > min_notional with corrected leverage (live diag scenario)', () => {
    // Replays the exact live diag inputs from PR #612 commit a5c0fe1
    // with the corrected leverage value. Lift-to-min should now
    // succeed: requiredFrac = (76 * 1.05) / (16 * 37.46) = 0.133,
    // well within the 0.5 safety clamp.
    const size = currentPositionSize(
      liveBugBasinState(1.0),
      37.46,           // availableEquity
      76.06,           // minNotional (BTC)
      16,              // leverage (corrected from 1)
      2,               // bankSize
      MonkeyMode.INVESTIGATION,
      'swing',
    );
    expect(size.value).toBeGreaterThan(0);
    const margin = (size.derivation as any).margin as number;
    expect(margin * 16).toBeGreaterThanOrEqual(76.06);
  });
});
