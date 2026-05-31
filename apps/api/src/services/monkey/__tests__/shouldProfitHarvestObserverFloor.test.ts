/**
 * shouldProfitHarvestObserverFloor.test.ts — Commit 9 (Fix C) pinning.
 *
 * The observer-derived loss-floor parameter on `shouldProfitHarvest`
 * suppresses harvest exits when the proposed ROI is below the kernel's
 * own observed loss-magnitude floor. Tests pin:
 *   - default behaviour (floor=0) unchanged → all legacy callers safe
 *   - floor > 0 → harvest suppressed when current ROI < floor
 *   - floor never blocks losses (only the green-side harvest path)
 *   - floor never blocks the trailing-stop path on a peak above floor
 */

import { describe, expect, it } from 'vitest';

import {
  computeRegimeHeldProfitFloorPnl,
  shouldProfitHarvest,
  shouldRegimeHeldProfitExit,
} from '../executive.js';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const basinState = (overrides: Record<string, number> = {}) => ({
  basin: new Float64Array(64).fill(1 / 64) as unknown as Float64Array,
  phi: 0.6,
  kappa: 64,
  basinVelocity: 0.01,
  identityBasin: new Float64Array(64).fill(1 / 64) as unknown as Float64Array,
  driftFromIdentity: 0.1,
  neurochemistry: {
    serotonin: 0.5,
    dopamine: 0.5,
    norepinephrine: 0.5,
    acetylcholine: 0.5,
    gaba: 0.5,
    endorphins: 0.5,
  },
  emotions: {
    anxiety: 0,
    confidence: 0.5,
    confusion: 0,
    wonder: 0,
    frustration: 0,
    satisfaction: 0,
    clarity: 0.5,
    boredom: 0,
    flow: 0,
  },
  ...overrides,
}) as unknown as Mutable<Parameters<typeof shouldProfitHarvest>[5]>;

describe('shouldProfitHarvest — Commit 9 observer loss-floor (Fix C)', () => {
  it('legacy default (no floor parameter) — back-compat behaviour preserved', () => {
    // A clear winner above activation + giveback should still harvest
    // when no floor parameter is supplied.
    const result = shouldProfitHarvest(
      5,          // unrealizedPnl
      10,         // peak
      1000,       // notional → currentFrac 0.5%, peakFrac 1.0%
      0,          // tapeTrend
      'long',
      basinState(),
    );
    // peakFrac 1% > activation; currentFrac 0.5% < trailingFloor (peak × 0.7 = 0.7%)
    expect(result.value).toBe(true);
    expect(result.reason).toMatch(/trailing_harvest|abs_usd_harvest/);
  });

  describe('REGIME-2 held-exit profit floor', () => {
    it('requires tiny green exits to clear the observer loss floor', () => {
      const floor = computeRegimeHeldProfitFloorPnl(
        500,     // notional
        0,       // no observed fee drag
        0.0027,  // observer floor from outcome ring
      );

      expect(floor).toBeCloseTo(1.35);
      expect(0.41).toBeLessThan(floor);
    });

    it('uses the larger of observed cost and observer loss floor', () => {
      expect(computeRegimeHeldProfitFloorPnl(1000, 0.001, 0.003)).toBeCloseTo(3);
      expect(computeRegimeHeldProfitFloorPnl(1000, 0.004, 0.003)).toBeCloseTo(4);
    });

    it('blocks REGIME-2 held-profit exits below the learned floor', () => {
      const result = shouldRegimeHeldProfitExit({
        cellHarvestTightness: 'tight',
        currentRoi: 0.00083,
        unrealizedPnlUsdt: 0.41,
        positionNotionalUsdt: 500,
        effectiveCostFrac: 0,
        observerLossFloorRoi: 0.0027,
      });

      expect(result.value).toBe(false);
      expect(result.reason).toBe('below_profit_floor');
      expect(result.derivation.minProfitablePnl).toBeCloseTo(1.35);
    });
  });

  it('floor > current ROI → harvest SUPPRESSED with diagnostic reason', () => {
    // Current ROI 0.5% < observer floor 1.0% → suppress
    const result = shouldProfitHarvest(
      5,          // unrealizedPnl
      10,         // peak
      1000,       // notional → currentFrac 0.5%
      0, 'long', basinState(), 0, undefined, undefined, undefined,
      0.01,       // observerLossFloorRoi = 1%
    );
    expect(result.value).toBe(false);
    expect(result.reason).toMatch(/below_observer_loss_floor/);
    expect(result.derivation.gatedByObserverFloor).toBe(1);
  });

  it('floor at or below current ROI → harvest allowed', () => {
    // Current ROI 0.5%; floor 0.3% → above the floor → no suppression,
    // normal harvest logic runs.
    const result = shouldProfitHarvest(
      5, 10, 1000, 0, 'long', basinState(), 0,
      undefined, undefined, undefined,
      0.003,  // 0.3% floor
    );
    expect(result.value).toBe(true);  // back to normal trailing_harvest
  });

  it('losses are NEVER suppressed by the floor (currentFrac > 0 guard)', () => {
    // Position is at a loss; floor logic should not engage. The legacy
    // path will already return value=false because currentFrac < 0
    // gates the trailing-harvest path anyway. Just confirm no spurious
    // reason from the floor gate.
    const result = shouldProfitHarvest(
      -2, 5, 1000, 0, 'long', basinState(), 0,
      undefined, undefined, undefined,
      0.01,  // 1% floor (way above the 0% threshold for losses)
    );
    expect(result.reason).not.toMatch(/below_observer_loss_floor/);
  });

  it('floor of 0 (default) → identical behaviour to legacy callers', () => {
    const withZero = shouldProfitHarvest(
      5, 10, 1000, 0, 'long', basinState(), 0,
      undefined, undefined, undefined,
      0,
    );
    const legacy = shouldProfitHarvest(5, 10, 1000, 0, 'long', basinState(), 0);
    expect(withZero.value).toBe(legacy.value);
  });

  it('the live-audit scenario: at 0.083% ROI with floor 0.27% → suppress', () => {
    // Simulating the 2026-05-28 6h audit numbers: median win ROI on
    // notional was 0.083%; observer loss floor (median loss 0.18% × 1.5)
    // = 0.27%. The kernel proposes harvesting at 0.083% — well below
    // its own loss floor. Should suppress.
    const ohEightThreeRoiOnFiveHundred = 0.000826 * 500;  // ~$0.41
    const result = shouldProfitHarvest(
      ohEightThreeRoiOnFiveHundred,
      ohEightThreeRoiOnFiveHundred * 1.05,  // small peak
      500,                                    // notional
      0, 'long', basinState(), 0,
      undefined, undefined, undefined,
      0.0027,  // 0.27% floor
    );
    expect(result.value).toBe(false);
    expect(result.reason).toMatch(/below_observer_loss_floor/);
  });
});
