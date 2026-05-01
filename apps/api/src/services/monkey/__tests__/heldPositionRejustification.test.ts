/**
 * heldPositionRejustification.test.ts — TS parity for held-position
 * re-justification (mirrors ml-worker/tests/monkey_kernel/
 * test_held_position_rejustification.py).
 *
 * Three internal exit checks fire when the kernel's own state
 * contradicts what justified entry:
 *
 *   1. REGIME CHECK   — current mode != mode at open → exit
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
} from '../topology_constants.js';
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
    });
    expect(out.checked).toBe(true);
    expect(out.fired).toBe('regime_change');
    expect(out.reason).toMatch(/^regime_change/);
    expect(out.reason).toContain('investigation');
    expect(out.reason).toContain('drift');
    expect(out.reason).toContain('0.900');
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
    });
    expect(out.fired).toBe('regime_change');
  });

  it('PI_STRUCT_BOUNDARY_R_SQUARED equals 1/φ ≈ 0.618', () => {
    const expected = 1 / ((1 + Math.sqrt(5)) / 2);
    expect(PI_STRUCT_BOUNDARY_R_SQUARED).toBeCloseTo(expected, 12);
    expect(PI_STRUCT_BOUNDARY_R_SQUARED).toBeCloseTo(0.6180339887, 9);
  });

  it('omitted regimeConfidence defaults to 1.0 (gate fully open)', () => {
    // Backward compat: callers that haven't been updated to pass the
    // classifier output should behave as in PR #619 — always fire on
    // label divergence.
    const out = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.DRIFT,
      phiNow: 0.25,
      emotions: STRONG_EMO,
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
