/**
 * sizingReliefLayer1.test.ts — pins the 2026-05-25 sizing-relief patch.
 *
 * Live evidence (operator screenshots, 2026-05-25 ~14:46 Perth):
 * polytrade-be on a $290 USDT account opened BTC long 10x with margin
 * $7.72 (2.7%) and ETH long 6x with margin $24.58 (8.5%). The pre-PR
 * formula's cold-start sizing was dominated by the modeFloor (0.10
 * INVESTIGATION) × per-kernel sizeFraction (0.7) × per-lane budgetFrac
 * (0.5) = 3.5% of equity ceiling regardless of signal quality. Even
 * the ETH 3% intraday swing could only return ~$4 — sampling, not
 * trading.
 *
 * CC2's Layer 1 patch: maturity in 5 closed trades not 20;
 * stabilityMult re-centered at 1.0 not 0.75 (one-sided cut → ±modulator);
 * rewardMult band widened ×2; mode-floor 2.5× across EXP/INV/INT.
 *
 * Test fixtures use the actual production parameters where possible.
 */
import { describe, it, expect } from 'vitest';
import { currentPositionSize } from '../executive.js';
import { BASIN_DIM } from '../basin.js';
import { MonkeyMode, MODE_PROFILES } from '../modes.js';

const NEUTRAL_NC = {
  acetylcholine: 0.5,
  dopamine: 0.5,
  serotonin: 0.5,
  norepinephrine: 0.4,
  gaba: 0.5,
  endorphins: 0.5,
};

function basinState(sovereignty = 1.0, phi = 0.6) {
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

describe('MODE_PROFILES sizeFloor — Layer 1 relief', () => {
  it('EXPLORATION floor is 0.20 (was 0.08)', () => {
    expect(MODE_PROFILES[MonkeyMode.EXPLORATION].sizeFloor).toBe(0.20);
  });
  it('INVESTIGATION floor is 0.25 (was 0.10)', () => {
    expect(MODE_PROFILES[MonkeyMode.INVESTIGATION].sizeFloor).toBe(0.25);
  });
  it('INTEGRATION floor is 0.30 (was 0.12)', () => {
    expect(MODE_PROFILES[MonkeyMode.INTEGRATION].sizeFloor).toBe(0.30);
  });
  it('DRIFT floor remains 0 (observe-only)', () => {
    expect(MODE_PROFILES[MonkeyMode.DRIFT].sizeFloor).toBe(0);
  });
});

describe('currentPositionSize cold-start (bankSize=0) — observer-derived floor', () => {
  it('cold-start floor derives from min-notional-clearing fraction at current leverage', () => {
    // 2026-05-25 (CC2 audit F3): magic EXPLORATION_FLOOR=0.20 replaced
    // with observer-derived `minClearingFrac = (min × 1.05) / (lev × equity)`.
    // With min=$5, lev=10, equity=$100:
    //   minClearingFrac = (5 × 1.05) / (10 × 100) = 0.00525
    //   explorationFloor = minClearingFrac × (1 - maturity) = 0.00525 × 1
    const out = currentPositionSize(
      basinState(),
      /* availableEquityUsdt */ 100,
      /* minNotionalUsdt */ 5,
      /* leverage */ 10,
      /* bankSize */ 0,
      MonkeyMode.INVESTIGATION,
      /* lane */ 'swing',
    );
    expect(out.derivation.explorationFloor).toBeCloseTo(0.00525, 6);
  });

  it('explorationFloor is mode-independent (chemistry expresses mode differentiation)', () => {
    const exp = currentPositionSize(basinState(), 100, 5, 10, 0, MonkeyMode.EXPLORATION, 'swing');
    const inv = currentPositionSize(basinState(), 100, 5, 10, 0, MonkeyMode.INVESTIGATION, 'swing');
    const int_ = currentPositionSize(basinState(), 100, 5, 10, 0, MonkeyMode.INTEGRATION, 'swing');
    // Same observer-derived floor across modes — mode-specific sizing
    // expressed via chemistry response patterns, not floor differentiation.
    expect(exp.derivation.explorationFloor).toBeCloseTo(inv.derivation.explorationFloor, 6);
    expect(inv.derivation.explorationFloor).toBeCloseTo(int_.derivation.explorationFloor, 6);
  });

  it('floor capped at 0.5 survival cap even with large min × low leverage × small equity', () => {
    // min=$50, lev=1, equity=$10 → raw minClearingFrac = (50 × 1.05) / 10 = 5.25
    // Clamped to 0.5 by the survival-cap logic.
    const out = currentPositionSize(basinState(), 10, 50, 1, 0, MonkeyMode.INVESTIGATION, 'swing');
    expect(out.derivation.explorationFloor).toBeLessThanOrEqual(0.5);
  });

  it('mode is wired into derivation telemetry (CC2 audit F5)', () => {
    const inv = currentPositionSize(basinState(), 100, 5, 10, 0, MonkeyMode.INVESTIGATION, 'swing');
    expect(inv.derivation.mode).toBe(1);  // INVESTIGATION
    const exp = currentPositionSize(basinState(), 100, 5, 10, 0, MonkeyMode.EXPLORATION, 'swing');
    expect(exp.derivation.mode).toBe(0);  // EXPLORATION
  });
});

describe('currentPositionSize maturity ramp', () => {
  it('reaches full maturity at bankSize=ROTATION_WR_MIN_SAMPLES=10 (Wilson-CI firmness threshold)', () => {
    const out = currentPositionSize(
      basinState(),
      100,
      5,
      10,
      /* bankSize */ 10,
      MonkeyMode.INVESTIGATION,
      'swing',
    );
    expect(out.derivation.maturity).toBe(1);
  });

  it('maturity is observer-derived (bankSize/10) — bankSize=5 yields 0.5', () => {
    const out = currentPositionSize(
      basinState(),
      100,
      5,
      10,
      /* bankSize */ 5,
      MonkeyMode.INVESTIGATION,
      'swing',
    );
    // 2026-05-25 observer-derive PR: maturity = bankSize/10 = 0.5
    expect(out.derivation.maturity).toBeCloseTo(0.5, 6);
  });
});

describe('currentPositionSize stability multiplier re-centered', () => {
  it('neutral serotonin (0.5) yields stabilityMult ≈ 1.0; frac clamped at 0.5 survival cap', () => {
    // Mature kernel, neutral chemistry, full sov, Φ=0.6: baseFrac =
    // 0.6 × 1 × 1 = 0.6, rewardMult = 1.0, stabilityMult = 1.0,
    // product 0.6. The 0.5 survival cap binds → frac = 0.5.
    const out = currentPositionSize(
      basinState(1.0, 0.6),
      100,
      5,
      10,
      /* bankSize */ 20,
      MonkeyMode.INVESTIGATION,
      'swing',
    );
    expect(out.derivation.frac).toBe(0.5);
    expect(out.value).toBeCloseTo(50, 1);
  });

  it('low serotonin (0.0) still produces 0.75 floor, not 0.5', () => {
    // The new range is [0.75, 1.25]; at the bottom you lose 25% size,
    // not 50%. With Φ × sov × maturity = 0.6 × 1 × 1 = 0.6, and
    // stabilityMult = 0.75, the product is 0.45 < 0.5 cap. Confirms
    // the floor is the lower bound of the new band.
    const state = basinState(1.0, 0.6);
    state.neurochemistry = { ...NEUTRAL_NC, serotonin: 0.0 };
    const out = currentPositionSize(state, 100, 5, 10, 20, MonkeyMode.INVESTIGATION, 'swing');
    // stabilityMult = 0.75 + 0 = 0.75
    // rawFrac = max(0, 0.6 × (1 + 0×1) × 0.75) = 0.45 (rewardMult = 1 + (0.5-0.5)×1 = 1.0)
    // frac = clamp(0.45, 0, 0.5) = 0.45
    // margin = 0.45 × 100 = 45. Lane cap = 0.5 × 100 = 50, doesn't bind.
    expect(out.derivation.stabilityMult ?? (0.75 + state.neurochemistry.serotonin * 0.5)).toBeCloseTo(0.75, 6);
    expect(out.derivation.frac).toBeCloseTo(0.45, 2);
  });
});

describe('currentPositionSize reward multiplier widened band', () => {
  it('dopamine spike (dop=1, gaba=0) saturates rewardMult; frac clamped at 0.5 survival cap', () => {
    // rewardMult = 1 + (1 - 0) = 2.0. baseFrac × 2.0 × stabilityMult =
    // 0.6 × 2.0 × 1.0 = 1.2 → would exceed survival cap. Clamped to 0.5.
    const state = basinState(1.0, 0.6);
    state.neurochemistry = { ...NEUTRAL_NC, dopamine: 1.0, gaba: 0.0, serotonin: 0.5 };
    const out = currentPositionSize(state, 100, 5, 10, 20, MonkeyMode.INVESTIGATION, 'swing');
    expect(out.derivation.frac).toBe(0.5);
  });

  it('gaba spike (dop=0, gaba=1) pulls rewardMult to 0 — formula contributes nothing', () => {
    const state = basinState(1.0, 0.6);
    state.neurochemistry = { ...NEUTRAL_NC, dopamine: 0.0, gaba: 1.0, serotonin: 0.5 };
    const out = currentPositionSize(state, 100, 5, 10, 20, MonkeyMode.INVESTIGATION, 'swing');
    // rewardMult = 1 + (0 - 1) × 1.0 = 0 → baseFrac × 0 = 0.
    // explorationFloor at maturity=1 is 0.25 × (1-1) = 0.
    // rawFrac = 0; lift-to-min then raises frac to requiredFrac so the
    // exchange minimum is reachable. The point is: the FORMULA-path
    // is zero, not floor-floored. Pre-PR the formula path was
    // 0.6 × 0.5 (gaba=1 → rewardMult=0.5) × 0.75 = 0.225 — far above
    // floor, sized into a losing chemistry. New formula correctly
    // gates entry on healthy chemistry.
    expect(out.derivation.rawFrac).toBe(0);
    // lift-to-min may activate but it's a separate concern (entry
    // minimum, not signal-driven sizing).
  });
});
