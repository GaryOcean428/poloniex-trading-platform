/**
 * heldPositionRejustification.test.ts — TS parity for held-position
 * re-justification (mirrors ml-worker/tests/monkey_kernel/
 * test_held_position_rejustification.py + test_regime_hysteresis.py).
 *
 * Four internal exit checks fire when the kernel's own state
 * contradicts what justified entry:
 *
 *   1. REGIME CHECK   — mode != mode_at_open AND streak ≥ N
 *                       AND basin moved by FR > 1/π → exit
 *   2. PHI CHECK      — Φ < phi_at_open / PHI_GOLDEN_FLOOR_RATIO
 *   3. CONVICTION     — confidence < anxiety + confusion → exit
 *                       (LIVE on TS post Layer 2B port 2026-05-01)
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
import { BASIN_DIM, type Basin } from '../basin.js';
import { MonkeyMode } from '../modes.js';
import {
  PHI_GOLDEN_FLOOR_RATIO, PI_STRUCT_GRAVITATING_FRACTION,
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

function peakBasin(idx: number, peak = 0.5): Basin {
  const b = new Float64Array(BASIN_DIM);
  for (let i = 0; i < BASIN_DIM; i += 1) b[i] = (1 - peak) / (BASIN_DIM - 1);
  b[idx] = peak;
  return b as Basin;
}

const FAR_BASIN_AT_OPEN = peakBasin(0, 0.95);
const FAR_BASIN_NOW = peakBasin(63, 0.95);
const HYSTERESIS_PASS = {
  regimeChangeStreak: 3,
  regimeStreakRequired: 3,
  basinAtOpen: FAR_BASIN_AT_OPEN,
  basinNow: FAR_BASIN_NOW,
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
      ...HYSTERESIS_PASS,
    });
    expect(out.checked).toBe(true);
    expect(out.fired).toBe('regime_change');
    expect(out.reason).toMatch(/^regime_change/);
    expect(out.reason).toContain('investigation');
    expect(out.reason).toContain('drift');
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

    // Lane A: opened in INVESTIGATION at Φ=0.27. Now mode=DRIFT → fires
    // when hysteresis (streak ≥ 3 + basin moved > 1/π) clears.
    const laneA = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.DRIFT,
      phiNow: 0.25,
      emotions: STRONG_EMO,
      ...HYSTERESIS_PASS,
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
    // If regime AND phi both broken, regime check (first in order)
    // wins — provided hysteresis gates clear.
    const out = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.DRIFT,
      phiNow: 0.05,  // also below floor
      emotions: WEAK_EMO,  // also below conviction
      ...HYSTERESIS_PASS,
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

// ─── Hysteresis (added 2026-05-01 — mirrors Python PR #631) ───────

describe('held-position rejustification — regime hysteresis', () => {
  it('does not fire on streak below required (single flicker)', () => {
    const out = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.DRIFT,
      phiNow: 0.25,
      emotions: STRONG_EMO,
      basinAtOpen: FAR_BASIN_AT_OPEN,
      basinNow: FAR_BASIN_NOW,
      regimeChangeStreak: 1,
      regimeStreakRequired: 3,
    });
    expect(out.fired).toBeNull();
  });

  it('does not fire when basin barely moved (under 1/π)', () => {
    const b = peakBasin(0, 0.5);
    const out = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.DRIFT,
      phiNow: 0.25,
      emotions: STRONG_EMO,
      basinAtOpen: b,
      basinNow: b,                     // identical → FR ≈ 0
      regimeChangeStreak: 5,
      regimeStreakRequired: 3,
    });
    expect(out.fired).toBeNull();
    expect(out.basinFrMove ?? 0).toBeLessThan(PI_STRUCT_GRAVITATING_FRACTION);
  });

  it('falls back to streak-only when basin anchor missing (legacy)', () => {
    const out = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.DRIFT,
      phiNow: 0.25,
      emotions: STRONG_EMO,
      regimeChangeStreak: 3,
      regimeStreakRequired: 3,
      // no basinAtOpen / basinNow
    });
    expect(out.fired).toBe('regime_change');
    expect(out.basinFrMove).toBeNull();
    expect(out.reason).toContain('no basin anchor');
  });

  it('does not fire when regime returned to anchor', () => {
    const out = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.INVESTIGATION,  // matches anchor
      phiNow: 0.25,
      emotions: STRONG_EMO,
      ...HYSTERESIS_PASS,
    });
    expect(out.fired).toBeNull();
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
  it('catches stale-bleed pattern via low confidence + small anxiety', () => {
    // The path that was structurally dead pre-2026-05-01. With real
    // computeEmotions output, conviction now catches positions where
    // the kernel's own self-read no longer supports the trade.
    const out = evaluateRejustification({
      regimeAtOpen: MonkeyMode.INVESTIGATION,
      phiAtOpen: 0.27,
      regimeNow: MonkeyMode.INVESTIGATION,
      phiNow: 0.25,
      emotions: { confidence: 0.05, anxiety: 0.15, confusion: 0.10 },
    });
    expect(out.fired).toBe('conviction_failed');
  });
});
