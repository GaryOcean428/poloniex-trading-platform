/**
 * heldPositionRejustification.test.ts — TS parity for held-position
 * re-justification (mirrors ml-worker/tests/monkey_kernel/
 * test_held_position_rejustification.py + test_regime_hysteresis.py).
 *
 * Four internal exit checks fire when the kernel's own state
 * contradicts what justified entry:
 *
 *   1. REGIME CHECK   — triple-AND of label divergence + sustained
 *                       streak + FR-distance > 1/π (v0.8.7 hysteresis)
 *   2. PHI CHECK      — current Φ < phi_at_open / PHI_GOLDEN_FLOOR_RATIO
 *   3. CONVICTION    — confidence < anxiety + confusion → exit
 *   4. STALE_BLEED    — duration ≥ 30min AND ROI ≤ -1% → exit
 *
 * The test exercises `evaluateRejustification` directly. The inline
 * call in loop.ts::processSymbol is wired identically.
 *
 * Regime hysteresis tests use a `regimeChangeStreak` of 3 + far-apart
 * basins so the triple-AND gate clears; tests for the hysteresis
 * itself live further down.
 */
import { describe, it, expect } from 'vitest';
import { BASIN_DIM, uniformBasin, type Basin } from '../basin.js';
import { MonkeyMode } from '../modes.js';
import {
  PHI_GOLDEN_FLOOR_RATIO,
  PI_STRUCT_BOUNDARY_R_SQUARED,
  PI_STRUCT_GRAVITATING_FRACTION,
} from '../topology_constants.js';
import {
  evaluateRejustification,
  type RejustificationEmotions,
  STALE_BLEED_MIN_DURATION_S,
  STALE_BLEED_ROI_THRESHOLD,
} from '../held_position_rejustification.js';

const NEUTRAL_EMO: RejustificationEmotions = {
  confidence: 0,
  anxiety: 0,
  confusion: 0,
};

const STRONG_EMO: RejustificationEmotions = {
  confidence: 0.7,
  anxiety: 0.1,
  confusion: 0.1,
};

const WEAK_EMO: RejustificationEmotions = {
  confidence: 0.4,
  anxiety: 0.3,
  confusion: 0.2,
};

// v0.8.7 hysteresis fixtures. uniformBasin gives a flat distribution;
// _farBasin concentrates mass on a single component so FR-distance to
// uniform is ≈ arccos(√(1/64)) ≈ 1.45, well above 1/π ≈ 0.318.
const UNIFORM = uniformBasin(64);
function farBasin(dim: number = 64): Basin {
  const arr = new Float64Array(dim).fill(1e-6);
  arr[0] = 1.0;
  let sum = 0;
  for (const v of arr) sum += v;
  for (let i = 0; i < dim; i++) arr[i] /= sum;
  return arr;
}
const FAR_BASIN = farBasin();
// "satisfied gate" inputs — streak >= required AND FR > 1/π. Existing
// tests that assert "regime fires" use these defaults.
const SATISFIED_HYSTERESIS = {
  regimeChangeStreak: 5,
  regimeStabilityTicksRequired: 3,
  basinNow: UNIFORM,
  basinAtOpen: FAR_BASIN,
};

// ─── Positive — each check fires ────────────────────────────────────

describe('held-position rejustification — regime check fires', () => {
  it('regime change exits when streak ≥ N AND basin moved > 1/π', () => {
    const out = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.DRIFT,
      phiNow: 0.25,
      emotions: STRONG_EMO,
      regimeConfidence: 0.9,  // past the 1/φ debounce floor
      ...SATISFIED_HYSTERESIS,
    });
    expect(out.checked).toBe(true);
    expect(out.fired).toBe('regime_change');
    expect(out.reason).toMatch(/^regime_change/);
    expect(out.reason).toContain('investigation');
    expect(out.reason).toContain('drift');
    expect(out.reason).toContain('0.900');
    // v0.8.7 — reason includes streak count and FR distance.
    expect(out.reason).toContain('stable for');
    expect(out.reason).toContain('FR_dist');
    expect(out.frDistance).not.toBeNull();
    expect(out.frDistance!).toBeGreaterThan(out.frThreshold);
    expect(out.regimeChangeStreak).toBeGreaterThanOrEqual(out.regimeStabilityTicksRequired);
  });
});

// ─── QIG-pure debounce gate on the regime check ────────────────────

describe('held-position rejustification — regime confidence gate', () => {
  it('low classifier confidence suppresses regime_change exit', () => {
    // Regime label flipped, but classifier confidence is below 1/φ.
    // Pre-debounce this would have fired; post-debounce it must not.
    const out = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.DRIFT,
      phiNow: 0.25,
      emotions: STRONG_EMO,
      regimeConfidence: 0.4,  // below 1/φ ≈ 0.618
      ...SATISFIED_HYSTERESIS,
    });
    expect(out.checked).toBe(true);
    expect(out.fired).toBeNull();
    expect(out.reason).not.toMatch(/^regime_change/);
  });

  it('high classifier confidence allows regime_change exit', () => {
    const out = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.DRIFT,
      phiNow: 0.25,
      emotions: STRONG_EMO,
      regimeConfidence: 0.8,  // comfortably past 1/φ
      ...SATISFIED_HYSTERESIS,
    });
    expect(out.fired).toBe('regime_change');
    expect(out.reason).toContain('0.800');
    expect(out.reason).toContain('1/φ');
  });

  it('confidence exactly at 1/φ does not fire (strict >)', () => {
    const out = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.DRIFT,
      phiNow: 0.25,
      emotions: STRONG_EMO,
      regimeConfidence: PI_STRUCT_BOUNDARY_R_SQUARED,
      ...SATISFIED_HYSTERESIS,
    });
    expect(out.fired).toBeNull();
  });

  it('confidence just above 1/φ fires', () => {
    const out = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.DRIFT,
      phiNow: 0.25,
      emotions: STRONG_EMO,
      regimeConfidence: PI_STRUCT_BOUNDARY_R_SQUARED + 1e-6,
      ...SATISFIED_HYSTERESIS,
    });
    expect(out.fired).toBe('regime_change');
  });

  it('PI_STRUCT_BOUNDARY_R_SQUARED equals 1/φ ≈ 0.618', () => {
    const expected = 1 / ((1 + Math.sqrt(5)) / 2);
    expect(PI_STRUCT_BOUNDARY_R_SQUARED).toBeCloseTo(expected, 12);
    expect(PI_STRUCT_BOUNDARY_R_SQUARED).toBeCloseTo(0.6180339887, 9);
  });

  it('omitted regimeConfidence defaults to 1.0 (confidence gate open)', () => {
    // Backward compat for the confidence gate (PR #629); v0.8.7
    // hysteresis still required.
    const out = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.DRIFT,
      phiNow: 0.25,
      emotions: STRONG_EMO,
      ...SATISFIED_HYSTERESIS,
    });
    expect(out.fired).toBe('regime_change');
    expect(out.reason).toContain('1.000');
  });
});

describe('held-position rejustification — phi check fires', () => {
  it('phi collapse below golden floor exits', () => {
    // phi_at_open = 0.27 → floor = 0.27 / φ ≈ 0.16687
    // phi_now = 0.15 (well below floor)
    const out = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.INVESTIGATION,
      phiNow: 0.15,
      emotions: STRONG_EMO,
    });
    expect(out.fired).toBe('phi_collapse');
    expect(out.reason).toMatch(/^phi_collapse/);
    expect(out.phiFloor).toBeCloseTo(0.27 / PHI_GOLDEN_FLOOR_RATIO, 9);
  });

  it('PHI_GOLDEN_FLOOR_RATIO equals golden ratio', () => {
    const expected = (1 + Math.sqrt(5)) / 2;
    expect(PHI_GOLDEN_FLOOR_RATIO).toBeCloseTo(expected, 12);
    // 1/φ ≈ 0.618 — the actual coherence-floor multiplier.
    expect(1 / PHI_GOLDEN_FLOOR_RATIO).toBeCloseTo(0.6180339887, 9);
  });
});

describe('held-position rejustification — conviction check fires', () => {
  it('confidence < anxiety + confusion exits AFTER streak >= required', () => {
    // 0.4 < 0.3 + 0.2 = 0.5 — conviction fails on this tick. With
    // CALIB-1 (#778) the exit only fires when the streak meets the
    // required minimum (default 2).
    const out = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.INVESTIGATION,
      phiNow: 0.25,
      emotions: WEAK_EMO,
      convictionFailedStreak: 2,  // post-debounce: 2nd consecutive tick
    });
    expect(out.fired).toBe('conviction_failed');
    expect(out.reason).toMatch(/^conviction_failed/);
    expect(out.reason).toContain('0.400');
    expect(out.reason).toContain('0.500');
    expect(out.reason).toContain('for 2 consecutive ticks');
  });
});

describe('CALIB-1 — conviction-failed debounce (single-tick noise rejection)', () => {
  it('does NOT fire on the first tick of conviction failure (streak=1)', () => {
    // Single-tick conviction noise — should be rejected by the debounce
    // gate. Same anti-noise rationale as the regime_change streak filter
    // (PR #629). 2026-05-17 CSV analysis showed this driving 60% of
    // chop-zone losses.
    const out = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.INVESTIGATION,
      phiNow: 0.25,
      emotions: WEAK_EMO,
      convictionFailedStreak: 1,  // first tick — noise candidate
    });
    expect(out.fired).toBeNull();
  });

  it('fires on the 2nd consecutive tick when default required = 2', () => {
    const out = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.INVESTIGATION,
      phiNow: 0.25,
      emotions: WEAK_EMO,
      convictionFailedStreak: 2,
    });
    expect(out.fired).toBe('conviction_failed');
  });

  it('respects operator-set required ticks (3-tick override)', () => {
    const at2 = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.INVESTIGATION,
      phiNow: 0.25,
      emotions: WEAK_EMO,
      convictionFailedStreak: 2,
      convictionFailedTicksRequired: 3,
    });
    expect(at2.fired).toBeNull();
    const at3 = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.INVESTIGATION,
      phiNow: 0.25,
      emotions: WEAK_EMO,
      convictionFailedStreak: 3,
      convictionFailedTicksRequired: 3,
    });
    expect(at3.fired).toBe('conviction_failed');
  });

  it('streak 0 (condition currently false) never fires', () => {
    const out = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.INVESTIGATION,
      phiNow: 0.25,
      emotions: WEAK_EMO,
      convictionFailedStreak: 0,
    });
    expect(out.fired).toBeNull();
  });

  it('absent streak (undefined input) defaults to 0 — fail-open for legacy callers', () => {
    // Callers that haven't migrated to CALIB-1 yet keep old behaviour
    // (no debounce, but also no fire since default streak=0). This is
    // intentionally fail-OPEN so the caller has to opt in.
    const out = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.INVESTIGATION,
      phiNow: 0.25,
      emotions: WEAK_EMO,
      // convictionFailedStreak not passed
    });
    expect(out.fired).toBeNull();
  });
});

describe('CALIB-3 — directional disagreement exit (early, regardless of ROI)', () => {
  it('does NOT fire when sides agree (streak=0)', () => {
    const out = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.INVESTIGATION,
      phiNow: 0.25,
      emotions: STRONG_EMO,
      directionalDisagreementStreak: 0,
    });
    expect(out.fired).toBeNull();
  });

  it('does NOT fire on the first tick of disagreement (streak=1, default required=4)', () => {
    const out = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.INVESTIGATION,
      phiNow: 0.25,
      emotions: STRONG_EMO,
      directionalDisagreementStreak: 1,
    });
    expect(out.fired).toBeNull();
  });

  it('fires on the 4th consecutive tick with default required', () => {
    const out = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.INVESTIGATION,
      phiNow: 0.25,
      emotions: STRONG_EMO,  // emotions NOT in conviction-failed range
      directionalDisagreementStreak: 4,
    });
    expect(out.fired).toBe('directional_disagreement');
    expect(out.reason).toMatch(/directional_disagreement/);
    expect(out.reason).toContain('4 consecutive ticks');
  });

  it('fires even when position is in PROFIT — per operator directive "exit early, re-enter if false positive"', () => {
    const out = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.INVESTIGATION,
      phiNow: 0.25,
      emotions: STRONG_EMO,
      directionalDisagreementStreak: 4,
      currentRoi: 0.015,  // +1.5% in profit
    });
    expect(out.fired).toBe('directional_disagreement');
    expect(out.reason).toContain('1.50%');
    expect(out.reason).toMatch(/re-enter on false positive/);
  });

  it('lane-scaled requirement — swing needs 12 ticks (3× scalp), trend needs 40 (10×)', () => {
    // Scalp would fire at 4 ticks; swing at 12; trend at 40.
    // Verify by passing different required values directly.
    const swing_at_8 = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.INVESTIGATION,
      phiNow: 0.25,
      emotions: STRONG_EMO,
      directionalDisagreementStreak: 8,
      directionalDisagreementTicksRequired: 12,
    });
    expect(swing_at_8.fired).toBeNull();
    const swing_at_12 = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.INVESTIGATION,
      phiNow: 0.25,
      emotions: STRONG_EMO,
      directionalDisagreementStreak: 12,
      directionalDisagreementTicksRequired: 12,
    });
    expect(swing_at_12.fired).toBe('directional_disagreement');
  });

  it('absent input defaults to 0 (no fire) — fail-OPEN for legacy callers', () => {
    const out = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.INVESTIGATION,
      phiNow: 0.25,
      emotions: STRONG_EMO,
    });
    expect(out.fired).toBeNull();
  });
});

// ─── Negative — checks do NOT fire ─────────────────────────────────

describe('held-position rejustification — regime unchanged', () => {
  it('same regime — no regime exit', () => {
    const out = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.INVESTIGATION,
      phiNow: 0.25,
      emotions: STRONG_EMO,
    });
    expect(out.fired).toBeNull();
    expect(out.checked).toBe(true);
  });
});

describe('held-position rejustification — phi stable above floor', () => {
  it('phi above floor — no phi exit', () => {
    // floor = 0.27 / φ ≈ 0.167. phi_now = 0.20 stays above.
    const out = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.INVESTIGATION,
      phiNow: 0.20,
      emotions: STRONG_EMO,
    });
    expect(out.fired).toBeNull();
  });
});

describe('held-position rejustification — conviction holds', () => {
  it('confidence ≥ anxiety + confusion — no conviction exit', () => {
    const out = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.INVESTIGATION,
      phiNow: 0.25,
      emotions: STRONG_EMO,  // 0.7 > 0.1 + 0.1 = 0.2
    });
    expect(out.fired).toBeNull();
  });

  it('all-zero emotions do not fire (boundary: 0 < 0 is false)', () => {
    // The Layer 2B port (2026-05-01) wires real computeEmotions
    // output into production; this test now documents the boundary
    // semantics rather than the prior "dormant gate" behaviour.
    const out = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.INVESTIGATION,
      phiNow: 0.25,
      emotions: NEUTRAL_EMO,
    });
    expect(out.fired).toBeNull();
  });
});

// ─── No-anchor path ────────────────────────────────────────────────

describe('held-position rejustification — no anchor recorded', () => {
  it('skips checks when regimeAtOpen is undefined', () => {
    const out = evaluateRejustification({
      regimeAtOpen: undefined,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.DRIFT,
      phiNow: 0.05,  // would have fired phi_collapse if anchor existed
      emotions: WEAK_EMO,
      ...SATISFIED_HYSTERESIS,
    });
    expect(out.checked).toBe(false);
    expect(out.fired).toBeNull();
    expect(out.phiFloor).toBeNull();
  });

  it('skips checks when phiAtOpen is undefined', () => {
    const out = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: undefined,
      regimeNow: MonkeyMode.DRIFT,
      phiNow: 0.05,
      emotions: WEAK_EMO,
      ...SATISFIED_HYSTERESIS,
    });
    expect(out.checked).toBe(false);
    expect(out.fired).toBeNull();
  });
});

// ─── Per-lane isolation ───────────────────────────────────────────

describe('held-position rejustification — per-lane isolation', () => {
  it('different lanes evaluate independently against their own anchors', () => {
    // The helper takes anchors per-call, so the per-lane isolation
    // contract is: callers (loop.ts) read the anchors for the current
    // lane only. Mirror that here by calling twice with different
    // anchors and verifying each call uses its own values.

    // Lane A: opened in INVESTIGATION at Φ=0.27. Now mode=DRIFT → fires
    // when hysteresis (streak ≥ 3 + basin moved > 1/π) clears.
    const laneA = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.DRIFT,
      phiNow: 0.25,
      emotions: STRONG_EMO,
      ...SATISFIED_HYSTERESIS,
    });
    expect(laneA.fired).toBe('regime_change');
    expect(laneA.reason).toContain('investigation');

    // Lane B: opened in INTEGRATION at Φ=0.40. Now mode=INTEGRATION → no fire.
    const laneB = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INTEGRATION,
      phiAtOpen: 0.40,
      regimeNow: MonkeyMode.INTEGRATION,
      phiNow: 0.30,  // above floor 0.40/φ ≈ 0.247
      emotions: STRONG_EMO,
      ...SATISFIED_HYSTERESIS,
    });
    expect(laneB.fired).toBeNull();
    expect(laneB.checked).toBe(true);
    expect(laneB.phiFloor).toBeCloseTo(0.40 / PHI_GOLDEN_FLOOR_RATIO, 9);
  });
});

// ─── Order — first to fire wins ────────────────────────────────────

describe('held-position rejustification — check ordering', () => {
  it('regime fires before phi when both would fire', () => {
    // If regime AND phi both broken, regime check (first in order)
    // wins — provided hysteresis gates clear.
    const out = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.DRIFT,
      phiNow: 0.05,  // also below floor
      emotions: WEAK_EMO,  // also below conviction
      ...SATISFIED_HYSTERESIS,
    });
    expect(out.fired).toBe('regime_change');
  });

  it('phi fires before conviction when regime is unchanged', () => {
    const out = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.INVESTIGATION,
      phiNow: 0.05,
      emotions: WEAK_EMO,
    });
    expect(out.fired).toBe('phi_collapse');
  });
});

// ─── v0.8.7 regime-hysteresis tests ────────────────────────────────

describe('held-position rejustification — regime hysteresis streak gate', () => {
  it('streak below required does not fire', () => {
    const out = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.DRIFT,
      phiNow: 0.25,
      emotions: STRONG_EMO,
      regimeConfidence: 0.9,
      regimeChangeStreak: 1,            // below the default 3-tick floor
      regimeStabilityTicksRequired: 3,
      basinNow: UNIFORM,
      basinAtOpen: FAR_BASIN,
    });
    expect(out.fired).toBeNull();
    expect(out.regimeChangeStreak).toBe(1);
  });

  it('streak at required fires', () => {
    const out = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.DRIFT,
      phiNow: 0.25,
      emotions: STRONG_EMO,
      regimeConfidence: 0.9,
      regimeChangeStreak: 3,            // exactly at threshold (>= 3)
      regimeStabilityTicksRequired: 3,
      basinNow: UNIFORM,
      basinAtOpen: FAR_BASIN,
    });
    expect(out.fired).toBe('regime_change');
    expect(out.regimeChangeStreak).toBe(3);
  });

  it('streak default is 0 — gate suppresses without explicit streak', () => {
    // Backward-compat: callers that haven't been updated to pass the
    // streak see streak=0 < required=3 → no fire. Old "always-fire on
    // label divergence" behaviour is now safely off.
    const out = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.DRIFT,
      phiNow: 0.25,
      emotions: STRONG_EMO,
      regimeConfidence: 0.9,
      basinNow: UNIFORM,
      basinAtOpen: FAR_BASIN,
    });
    expect(out.fired).toBeNull();
    expect(out.regimeChangeStreak).toBe(0);
    expect(out.regimeStabilityTicksRequired).toBe(3);
  });

  it('does not fire when regime returned to anchor', () => {
    const out = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.INVESTIGATION,  // matches anchor
      phiNow: 0.25,
      emotions: STRONG_EMO,
      ...SATISFIED_HYSTERESIS,
    });
    expect(out.fired).toBeNull();
  });
});

describe('held-position rejustification — regime hysteresis FR-distance gate', () => {
  it('FR distance below 1/π does not fire', () => {
    // basinAtOpen == basinNow → FR=0, far below threshold.
    const sameBasin = uniformBasin(64);
    const out = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.DRIFT,
      phiNow: 0.25,
      emotions: STRONG_EMO,
      regimeConfidence: 0.9,
      regimeChangeStreak: 5,
      regimeStabilityTicksRequired: 3,
      basinNow: sameBasin,
      basinAtOpen: sameBasin,
    });
    expect(out.fired).toBeNull();
    expect(out.frDistance).toBeCloseTo(0, 9);
    expect(out.frThreshold).toBeGreaterThan(0.31);
  });

  it('FR distance above 1/π fires when other gates satisfied', () => {
    const out = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.DRIFT,
      phiNow: 0.25,
      emotions: STRONG_EMO,
      regimeConfidence: 0.9,
      regimeChangeStreak: 5,
      regimeStabilityTicksRequired: 3,
      basinNow: UNIFORM,
      basinAtOpen: FAR_BASIN,
    });
    expect(out.fired).toBe('regime_change');
    expect(out.frDistance).not.toBeNull();
    expect(out.frDistance!).toBeGreaterThan(out.frThreshold);
  });

  it('FR threshold equals 1/π (PI_STRUCT_GRAVITATING_FRACTION)', () => {
    expect(PI_STRUCT_GRAVITATING_FRACTION).toBeCloseTo(1 / Math.PI, 12);
    // The result also surfaces it.
    const out = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.INVESTIGATION,  // no fire
      phiNow: 0.25,
      emotions: STRONG_EMO,
    });
    expect(out.frThreshold).toBeCloseTo(1 / Math.PI, 12);
  });

  it('missing basin anchors blocks regime exit (strict-fail)', () => {
    // Position opened before this PR shipped → no basinAtOpen. The
    // regime exit cannot fire purely on label flicker.
    const out = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.DRIFT,
      phiNow: 0.25,  // above phi floor — phi gate doesn't fire
      emotions: STRONG_EMO,
      regimeConfidence: 0.9,
      regimeChangeStreak: 5,
      regimeStabilityTicksRequired: 3,
      // basinNow + basinAtOpen omitted
    });
    expect(out.fired).toBeNull();
    expect(out.frDistance).toBeNull();
  });
});

// ─── Stale-bleed gate (added 2026-05-01) ─────────────────────────

describe('held-position rejustification — stale_bleed', () => {
  const baseInput = {
    regimeAtOpen: MonkeyMode.INVESTIGATION,
    phiAtOpen: 0.27,
    regimeNow: MonkeyMode.INVESTIGATION,
    phiNow: 0.25,
    emotions: STRONG_EMO,
  };

  it('fires when held > 30min AND ROI ≤ -1%', () => {
    const out = evaluateRejustification({
      ...baseInput,
      heldDurationS: STALE_BLEED_MIN_DURATION_S + 60,
      currentRoi: STALE_BLEED_ROI_THRESHOLD - 0.005,
    });
    expect(out.fired).toBe('stale_bleed');
    expect(out.reason).toMatch(/^stale_bleed/);
  });

  it('does not fire under duration threshold', () => {
    const out = evaluateRejustification({
      ...baseInput,
      heldDurationS: STALE_BLEED_MIN_DURATION_S - 60,
      currentRoi: -0.05,
    });
    expect(out.fired).toBeNull();
  });

  it('does not fire when ROI above threshold', () => {
    const out = evaluateRejustification({
      ...baseInput,
      heldDurationS: STALE_BLEED_MIN_DURATION_S + 600,
      currentRoi: -0.005,  // -0.5% > -1%
    });
    expect(out.fired).toBeNull();
  });

  it('does not fire when inputs missing (legacy callsites)', () => {
    const out = evaluateRejustification(baseInput);
    expect(out.fired).toBeNull();
  });

  it('positive ROI never triggers stale_bleed', () => {
    const out = evaluateRejustification({
      ...baseInput,
      heldDurationS: STALE_BLEED_MIN_DURATION_S + 600,
      currentRoi: 0.05,
    });
    expect(out.fired).toBeNull();
  });
});

// ─── Layer 2B port verification (added 2026-05-01) ────────────────

describe('held-position rejustification — conviction post-Layer-2B-port', () => {
  it('catches stale-bleed pattern via low confidence + small anxiety (post-CALIB-1 streak gate)', () => {
    // The path that was structurally dead pre-2026-05-01. With real
    // computeEmotions output, conviction now catches positions where
    // the kernel's own self-read no longer supports the trade.
    // Post-CALIB-1 (#778) requires the convictionFailedStreak >=
    // default 2 ticks to fire — passing the post-debounce state here.
    const out = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.INVESTIGATION,
      phiNow: 0.25,
      emotions: { confidence: 0.05, anxiety: 0.15, confusion: 0.10 },
      convictionFailedStreak: 2,
    });
    expect(out.fired).toBe('conviction_failed');
  });
});

// ─── Hold-time floor (2026-05-28 CC1 operator-selected fix) ────────

describe('hold-time floor suppresses internal-coherence exits', () => {
  const FLOOR = 600; // seconds — mirrors LANE_DECISION_PERIOD_MS.trend / 1000

  it('regime_change is suppressed when held < floor', () => {
    const basinA: Basin = uniformBasin(BASIN_DIM);
    const basinB: Basin = Array.from({ length: BASIN_DIM }, (_, i) =>
      i === 0 ? 1.0 : 0.0,
    );
    const out = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.DRIFT,
      phiNow: 0.20,
      emotions: NEUTRAL_EMO,
      regimeConfidence: 0.99,
      regimeChangeStreak: 10,
      regimeStabilityTicksRequired: 3,
      basinAtOpen: basinA,
      basinNow: basinB,
      heldDurationS: 30,        // held 30s, floor 600s
      holdTimeFloorS: FLOOR,
    });
    expect(out.fired).not.toBe('regime_change');
  });

  it('regime_change fires once held >= floor (same scenario, different time)', () => {
    const basinA: Basin = uniformBasin(BASIN_DIM);
    const basinB: Basin = Array.from({ length: BASIN_DIM }, (_, i) =>
      i === 0 ? 1.0 : 0.0,
    );
    const out = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.DRIFT,
      phiNow: 0.20,
      emotions: NEUTRAL_EMO,
      regimeConfidence: 0.99,
      regimeChangeStreak: 10,
      regimeStabilityTicksRequired: 3,
      basinAtOpen: basinA,
      basinNow: basinB,
      heldDurationS: 700,       // held 700s > 600s floor
      holdTimeFloorS: FLOOR,
    });
    expect(out.fired).toBe('regime_change');
  });

  it('phi_collapse is suppressed when held < floor', () => {
    const out = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.INVESTIGATION,
      phiNow: 0.10,             // well below floor 0.27 / φ ≈ 0.167
      emotions: NEUTRAL_EMO,
      heldDurationS: 30,
      holdTimeFloorS: FLOOR,
    });
    expect(out.fired).not.toBe('phi_collapse');
  });

  it('phi_collapse fires once held >= floor', () => {
    const out = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.INVESTIGATION,
      phiNow: 0.10,
      emotions: NEUTRAL_EMO,
      heldDurationS: 700,
      holdTimeFloorS: FLOOR,
    });
    expect(out.fired).toBe('phi_collapse');
  });

  it('conviction_failed is suppressed when held < floor', () => {
    const out = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.INVESTIGATION,
      phiNow: 0.25,
      emotions: { confidence: 0.05, anxiety: 0.15, confusion: 0.10 },
      convictionFailedStreak: 5,
      convictionFailedTicksRequired: 2,
      heldDurationS: 30,
      holdTimeFloorS: FLOOR,
    });
    expect(out.fired).not.toBe('conviction_failed');
  });

  it('conviction_failed fires once held >= floor', () => {
    const out = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.INVESTIGATION,
      phiNow: 0.25,
      emotions: { confidence: 0.05, anxiety: 0.15, confusion: 0.10 },
      convictionFailedStreak: 5,
      convictionFailedTicksRequired: 2,
      heldDurationS: 700,
      holdTimeFloorS: FLOOR,
    });
    expect(out.fired).toBe('conviction_failed');
  });

  it('stale_bleed is NOT gated by the floor (safety exit must fire regardless of time)', () => {
    const out = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.INVESTIGATION,
      phiNow: 0.25,
      emotions: NEUTRAL_EMO,
      heldDurationS: STALE_BLEED_MIN_DURATION_S + 1,  // 30min+ held
      currentRoi: STALE_BLEED_ROI_THRESHOLD - 0.005,  // worse than -1%
      holdTimeFloorS: FLOOR,
    });
    // stale_bleed's own duration gate (30min) is strictly larger than
    // any lane floor, so it will always have aged into the floor first.
    expect(out.fired).toBe('stale_bleed');
  });

  it('floor=0 (undefined) preserves legacy behavior — coherence exits fire promptly', () => {
    const out = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.INVESTIGATION,
      phiNow: 0.10,
      emotions: NEUTRAL_EMO,
      heldDurationS: 5,
      // holdTimeFloorS undefined → no floor → phi_collapse fires
    });
    expect(out.fired).toBe('phi_collapse');
  });
});
