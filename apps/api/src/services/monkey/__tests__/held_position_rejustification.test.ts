/**
 * held_position_rejustification.test.ts — TS parity for the four
 * internal exit checks (regime hysteresis + phi + conviction +
 * stale_bleed).
 *
 * Mirrors ml-worker/tests/monkey_kernel/test_held_position_rejustification.py
 * for the regime/phi/conviction gates plus
 * test_regime_hysteresis.py for the streak + basin-FR hysteresis.
 * The stale-bleed gate is TS-only (Python kernel has live emotions
 * via compute_emotions, so doesn't need this interim guard).
 */
import { describe, it, expect } from 'vitest';
import { BASIN_DIM, type Basin } from '../basin.js';
import { MonkeyMode } from '../modes.js';
import { PI_STRUCT_GRAVITATING_FRACTION } from '../topology_constants.js';
import {
  evaluateRejustification,
  STALE_BLEED_MIN_DURATION_S,
  STALE_BLEED_ROI_THRESHOLD,
} from '../held_position_rejustification.js';

const NEUTRAL = { confidence: 0, anxiety: 0, confusion: 0 };

function peakBasin(idx: number, peak = 0.5): Basin {
  const b = new Float64Array(BASIN_DIM);
  for (let i = 0; i < BASIN_DIM; i += 1) b[i] = (1 - peak) / (BASIN_DIM - 1);
  b[idx] = peak;
  return b as Basin;
}

describe('rejustification: cold-start (no anchors)', () => {
  it('returns checked=false when no regime anchor', () => {
    const r = evaluateRejustification({
      regimeAtOpen: undefined,
      phiAtOpen: undefined,
      regimeNow: MonkeyMode.INVESTIGATION,
      phiNow: 0.3,
      emotions: NEUTRAL,
    });
    expect(r.checked).toBe(false);
    expect(r.fired).toBeNull();
  });
});

describe('regime check — hysteresis', () => {
  it('does not fire when streak below required (single flicker)', () => {
    const r = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.DRIFT,  // diverged
      phiNow: 0.25,
      emotions: NEUTRAL,
      basinAtOpen: peakBasin(0, 0.95),
      basinNow: peakBasin(63, 0.95),  // far
      regimeChangeStreak: 1,           // below default required=3
      regimeStreakRequired: 3,
    });
    expect(r.fired).toBeNull();
  });

  it('does not fire when basin barely moved (under 1/π)', () => {
    const b = peakBasin(0, 0.5);
    const r = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.DRIFT,
      phiNow: 0.25,
      emotions: NEUTRAL,
      basinAtOpen: b,
      basinNow: b,                     // identical → FR ≈ 0
      regimeChangeStreak: 5,           // streak ok
      regimeStreakRequired: 3,
    });
    expect(r.fired).toBeNull();
    expect(r.basinFrMove).toBeLessThan(PI_STRUCT_GRAVITATING_FRACTION);
  });

  it('fires when streak ≥ required AND basin moved > 1/π AND regime diverged', () => {
    const r = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.DRIFT,
      phiNow: 0.25,
      emotions: NEUTRAL,
      basinAtOpen: peakBasin(0, 0.95),
      basinNow: peakBasin(63, 0.95),   // very far
      regimeChangeStreak: 3,
      regimeStreakRequired: 3,
    });
    expect(r.fired).toBe('regime_change');
    expect(r.reason).toContain('regime_change');
    expect(r.reason).toContain('investigation');
    expect(r.reason).toContain('drift');
  });

  it('falls back to streak-only when basin anchor missing (legacy positions)', () => {
    const r = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.DRIFT,
      phiNow: 0.25,
      emotions: NEUTRAL,
      // no basinAtOpen / basinNow
      regimeChangeStreak: 3,
      regimeStreakRequired: 3,
    });
    expect(r.fired).toBe('regime_change');
    expect(r.basinFrMove).toBeNull();
    expect(r.reason).toContain('no basin anchor');
  });

  it('does not fire when regime returned to anchor (streak resets)', () => {
    const r = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.INVESTIGATION,  // matches anchor
      phiNow: 0.25,
      emotions: NEUTRAL,
      basinAtOpen: peakBasin(0, 0.95),
      basinNow: peakBasin(63, 0.95),
      regimeChangeStreak: 5,                 // caller will reset next tick
      regimeStreakRequired: 3,
    });
    expect(r.fired).toBeNull();
  });
});

describe('phi_collapse', () => {
  it('fires when phi drops below golden floor', () => {
    const r = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.INVESTIGATION,
      phiNow: 0.10,                          // floor ≈ 0.27/φ ≈ 0.167
      emotions: NEUTRAL,
    });
    expect(r.fired).toBe('phi_collapse');
  });

  it('does not fire above golden floor', () => {
    const r = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.INVESTIGATION,
      phiNow: 0.20,                          // above floor
      emotions: NEUTRAL,
    });
    expect(r.fired).toBeNull();
  });
});

describe('conviction_failed', () => {
  it('fires when confidence < anxiety + confusion', () => {
    const r = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.INVESTIGATION,
      phiNow: 0.25,
      emotions: { confidence: 0.3, anxiety: 0.4, confusion: 0.1 },
    });
    expect(r.fired).toBe('conviction_failed');
  });

  it('NEUTRAL_EMOTIONS (all zeros) does NOT fire (gate dormant)', () => {
    // This test documents the dormant-gate behaviour. While
    // NEUTRAL_EMOTIONS is the production input, conviction can never
    // fire (0 < 0 = false). The stale_bleed gate is the interim
    // compensation.
    const r = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.INVESTIGATION,
      phiNow: 0.25,
      emotions: NEUTRAL,
    });
    expect(r.fired).toBeNull();
  });
});

describe('stale_bleed', () => {
  const baseInput = {
    regimeAtOpen: MonkeyMode.INVESTIGATION,
    phiAtOpen: 0.27,
    regimeNow: MonkeyMode.INVESTIGATION,
    phiNow: 0.25,
    emotions: NEUTRAL,
  };

  it('fires when held > 30min AND ROI ≤ -1%', () => {
    const r = evaluateRejustification({
      ...baseInput,
      heldDurationS: STALE_BLEED_MIN_DURATION_S + 60,
      currentRoi: STALE_BLEED_ROI_THRESHOLD - 0.005,  // -1.5%
    });
    expect(r.fired).toBe('stale_bleed');
    expect(r.reason).toContain('stale_bleed');
    expect(r.reason).toContain('held');
  });

  it('does not fire under duration threshold', () => {
    const r = evaluateRejustification({
      ...baseInput,
      heldDurationS: STALE_BLEED_MIN_DURATION_S - 60,
      currentRoi: -0.05,  // -5% loss but only held briefly
    });
    expect(r.fired).toBeNull();
  });

  it('does not fire when ROI is above threshold', () => {
    const r = evaluateRejustification({
      ...baseInput,
      heldDurationS: STALE_BLEED_MIN_DURATION_S + 600,  // 40 min
      currentRoi: -0.005,  // -0.5% — above -1% threshold
    });
    expect(r.fired).toBeNull();
  });

  it('does not fire when inputs missing (legacy callsites)', () => {
    const r = evaluateRejustification({
      ...baseInput,
      // no heldDurationS / currentRoi
    });
    expect(r.fired).toBeNull();
  });

  it('positive ROI never triggers stale_bleed', () => {
    const r = evaluateRejustification({
      ...baseInput,
      heldDurationS: STALE_BLEED_MIN_DURATION_S + 600,
      currentRoi: 0.05,  // 5% profit, held 40 min — must not fire
    });
    expect(r.fired).toBeNull();
  });
});

describe('exit ordering', () => {
  it('regime fires before phi when both qualify', () => {
    const r = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.DRIFT,
      phiNow: 0.05,                            // would also trigger phi
      emotions: NEUTRAL,
      basinAtOpen: peakBasin(0, 0.95),
      basinNow: peakBasin(63, 0.95),
      regimeChangeStreak: 3,
    });
    expect(r.fired).toBe('regime_change');
  });

  it('phi fires before stale_bleed when both qualify', () => {
    const r = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.INVESTIGATION,
      phiNow: 0.05,                            // phi collapse
      emotions: NEUTRAL,
      heldDurationS: STALE_BLEED_MIN_DURATION_S + 60,
      currentRoi: -0.05,                       // would also trigger stale
    });
    expect(r.fired).toBe('phi_collapse');
  });
});
