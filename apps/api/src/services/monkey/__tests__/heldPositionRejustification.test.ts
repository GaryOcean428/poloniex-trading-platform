/**
 * heldPositionRejustification.test.ts — TS parity for held-position
 * re-justification (mirrors ml-worker/tests/monkey_kernel/
 * test_held_position_rejustification.py).
 *
 * Three internal exit checks fire when the kernel's own state
 * contradicts what justified entry:
 *
 *   1. REGIME CHECK   — triple-AND of label divergence + sustained
 *                       streak + FR-distance > 1/π (v0.8.7 hysteresis)
 *   2. PHI CHECK      — current Φ < phi_at_open / PHI_GOLDEN_FLOOR_RATIO
 *   3. CONVICTION    — confidence < anxiety + confusion → exit
 *
 * The test exercises `evaluateRejustification` directly. The inline
 * call in loop.ts::processSymbol is wired identically.
 */
import { describe, it, expect } from 'vitest';
import { MonkeyMode } from '../modes.js';
import {
  PHI_GOLDEN_FLOOR_RATIO,
  PI_STRUCT_BOUNDARY_R_SQUARED,
  PI_STRUCT_GRAVITATING_FRACTION,
} from '../topology_constants.js';
import { uniformBasin, type Basin } from '../basin.js';
import {
  evaluateRejustification,
  type RejustificationEmotions,
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
  it('regime change exits with correct reason', () => {
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
  it('confidence < anxiety + confusion exits', () => {
    // 0.4 < 0.3 + 0.2 = 0.5 — conviction fails
    const out = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.INVESTIGATION,
      phiNow: 0.25,
      emotions: WEAK_EMO,
    });
    expect(out.fired).toBe('conviction_failed');
    expect(out.reason).toMatch(/^conviction_failed/);
    expect(out.reason).toContain('0.400');
    expect(out.reason).toContain('0.500');
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

  it('NEUTRAL_EMOTIONS does not fire conviction (0 < 0+0 is false)', () => {
    // TS path uses NEUTRAL_EMOTIONS until the emotion stack is ported.
    // Verify that the conviction check is dormant under that input.
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

    // Lane A: opened in INVESTIGATION at Φ=0.27. Now mode=DRIFT → fires.
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
    // If regime AND phi both broken, regime check (first in order) wins.
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
