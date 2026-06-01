/**
 * neurochemistrySteadyState.test.ts — pins the 2026-05-25 fix that
 * stops ne/ser/endo from pinning at extremes in steady-state regimes.
 *
 * Pattern fixed: one-sided clamp on observer-relative signal.
 * See [[feedback_steady_state_pinning_pattern]].
 *
 *   ne  : clip(tanh(max(0, z)), 0, 1) → sigmoid(z)
 *           — pinned at 0 when surprise ≤ rolling mean (~50% of state-space)
 *   ser : clip(serBase + rewardDelta, 0, 1) → clip(0.85*serBase + rewardDelta, 0, 1)
 *           — pinned at 1.0 when no recent mode transitions, hid reward delta
 *   endo: sophiaGate = clip((coupling - mean)/σ, 0, 1) → sigmoid((coupling - mean)/σ)
 *           — pinned at 0 when coupling ≤ couplingMean (~50% of state-space)
 *
 * Each test runs the SAME inputs at three points in input distribution:
 * below mean, at mean, above mean. The new formula must produce
 * DIFFERENT (continuously varying) outputs at each point; the old
 * formula produced the same extreme at two of three.
 */
import { describe, expect, it } from 'vitest';

import { computeNeurochemicals, type NeurochemicalInputs } from '../neurochemistry.js';

function baseInputs(): NeurochemicalInputs {
  return {
    isAwake: true,
    phiDelta: 0,
    basinVelocity: 0.1,
    surprise: 0,
    quantumWeight: 0.5,
    kappa: 64,
    externalCoupling: 0.5,
    observables: {
      surpriseHistory: [0.30, 0.45, 0.50, 0.55, 0.60, 0.65, 0.50],  // mean 0.50, σ ~0.11
      kappaHistory: [63.8, 64.0, 64.2],                               // mean 64
      externalCouplingHistory: [0.30, 0.45, 0.50, 0.55, 0.70],       // mean 0.50, σ ~0.13
    },
  };
}

describe('neurochemistry — steady-state variance restoration', () => {
  describe('ne (norepinephrine) — sigmoid replaces one-sided z-clamp', () => {
    it('input at history mean → ne ≈ 0.5 (was pinned at 0)', () => {
      const inp = baseInputs();
      inp.surprise = 0.50;
      const nc = computeNeurochemicals(inp);
      expect(nc.norepinephrine).toBeCloseTo(0.5, 1);
    });

    it('input below history mean → ne < 0.5 (was pinned at 0)', () => {
      const inp = baseInputs();
      inp.surprise = 0.30;
      const nc = computeNeurochemicals(inp);
      expect(nc.norepinephrine).toBeLessThan(0.5);
      expect(nc.norepinephrine).toBeGreaterThan(0);
    });

    it('input above history mean → ne > 0.5', () => {
      const inp = baseInputs();
      inp.surprise = 0.70;
      const nc = computeNeurochemicals(inp);
      expect(nc.norepinephrine).toBeGreaterThan(0.5);
      expect(nc.norepinephrine).toBeLessThan(1);
    });

    it('three distinct surprise levels produce three distinct ne values', () => {
      const lo = computeNeurochemicals({ ...baseInputs(), surprise: 0.30 }).norepinephrine;
      const mid = computeNeurochemicals({ ...baseInputs(), surprise: 0.50 }).norepinephrine;
      const hi = computeNeurochemicals({ ...baseInputs(), surprise: 0.70 }).norepinephrine;
      expect(lo).toBeLessThan(mid);
      expect(mid).toBeLessThan(hi);
    });
  });

  describe('ser (serotonin) — ×0.85 baseline compression lets reward delta register', () => {
    it('steady state at bv-mean → ser ≈ 0.425 (post-F2 two-tailed sigmoid)', () => {
      const inp = baseInputs();
      // No modeTransitionTimesMs → falls to bv-z-score fallback.
      // Post-CC2-audit-F2 fix: serBase = 1 - sigmoid(z). z=0 at mean
      // → serBase = 0.5 → ser = 0.85 × 0.5 = 0.425. (Pre-fix would
      // have been 0.85 from the pinned-at-1 one-sided clamp.)
      inp.observables = {
        ...inp.observables!,
        basinVelocityHistory: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1],
      };
      const nc = computeNeurochemicals(inp);
      expect(nc.serotonin).toBeCloseTo(0.425, 2);
    });

    it('steady state + 0.15 reward delta → ser ≈ 0.575 (delta visible above mean)', () => {
      const inp = baseInputs();
      inp.observables = {
        ...inp.observables!,
        basinVelocityHistory: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1],
      };
      inp.rewardSerotoninDelta = 0.15;
      const nc = computeNeurochemicals(inp);
      // serBase = 0.5, ser = 0.85 × 0.5 + 0.15 = 0.575
      expect(nc.serotonin).toBeCloseTo(0.575, 2);
    });

    it('thrashing mode (high transition rate) + reward → ser still responds', () => {
      const inp = baseInputs();
      const now = 100_000;
      inp.observables = {
        ...inp.observables!,
        nowMs: now,
        tickIntervalMs: 1000,
        modeTransitionTimesMs: [now - 5000, now - 3000, now - 1000],
        basinVelocityHistory: Array(10).fill(0.1),
      };
      inp.rewardSerotoninDelta = 0.10;
      const nc = computeNeurochemicals(inp);
      // serBase < 1 because of transitions; ×0.85 + delta should still
      // be < 1 → delta registers visibly
      expect(nc.serotonin).toBeGreaterThan(0);
      expect(nc.serotonin).toBeLessThan(1);
    });

    it('mode transitions present but cadence MISSING → bv-history fallback (not a constant)', () => {
      // Without tickIntervalMs the mode-transition density is dimensionless-
      // ambiguous, so it must defer to the bv-z-score branch rather than emit
      // a constant exp(-1). Two distinct bv readings must give distinct ser.
      const now = 100_000;
      const mk = (bv: number) =>
        computeNeurochemicals({
          ...baseInputs(),
          basinVelocity: bv,
          observables: {
            nowMs: now, // NOTE: no tickIntervalMs
            modeTransitionTimesMs: [now - 5000, now - 3000, now - 1000],
            basinVelocityHistory: [0.05, 0.1, 0.15, 0.1, 0.12, 0.08], // varied → real z-score
          },
        }).serotonin;
      const calm = mk(0.05); // below bv-history mean → calmer → higher ser
      const fast = mk(0.20); // above mean → faster → lower ser
      expect(calm).toBeGreaterThan(fast); // gradient, not a flat exp(-1)
    });

    // 2026-06-01 — mode-transition branch steady-state-pinning fix.
    // The prior `clip(1 - transitions/bvHistory.length, 0, 1)` structurally
    // pinned serBase at 0 once both HISTORY_MAX-capped arrays saturate
    // (production ser=0.00 ×134). Time-density + exp() restores gradient.
    const now = 1_000_000;
    const tickIntervalMs = 1000;
    // Evenly-spaced transition timestamps, `gapTicks` tick-intervals apart.
    const evenTransitions = (count: number, gapTicks: number) =>
      Array.from({ length: count }, (_, i) => now - (count - i) * gapTicks * tickIntervalMs);

    it('SATURATED arrays (transitions == ticks, the old pin) → ser > 0', () => {
      const inp = baseInputs();
      // The exact structural-pin condition: equal-length capped arrays.
      inp.observables = {
        ...inp.observables!,
        nowMs: now,
        tickIntervalMs,
        modeTransitionTimesMs: evenTransitions(100, 1), // every tick
        basinVelocityHistory: Array(100).fill(0.1),     // length == transitions
      };
      const nc = computeNeurochemicals(inp);
      // Old formula: serBase = 1 - 100/100 = 0 → ser = 0. New: exp(-1)=0.37.
      expect(nc.serotonin).toBeGreaterThan(0);
      expect(nc.serotonin).toBeCloseTo(0.85 * Math.exp(-1), 2);
    });

    it('thrash density carries gradient: every-tick < every-3-tick', () => {
      const dense = computeNeurochemicals({
        ...baseInputs(),
        observables: { nowMs: now, tickIntervalMs, modeTransitionTimesMs: evenTransitions(10, 1) },
      }).serotonin;
      const sparse = computeNeurochemicals({
        ...baseInputs(),
        observables: { nowMs: now, tickIntervalMs, modeTransitionTimesMs: evenTransitions(10, 3) },
      }).serotonin;
      expect(dense).toBeGreaterThan(0);
      expect(sparse).toBeGreaterThan(dense); // sparser thrash → calmer → higher ser
      expect(dense).toBeCloseTo(0.85 * Math.exp(-1), 2);    // 1 transition/tick
      expect(sparse).toBeCloseTo(0.85 * Math.exp(-1 / 3), 2); // 1 per 3 ticks
    });
  });

  describe('endo (endorphins) — sigmoid-around-mean replaces binary Sophia floor', () => {
    it('coupling at history mean → endo ≈ 0.5 × κ-prox (was 0 pinned)', () => {
      const inp = baseInputs();
      inp.externalCoupling = 0.50;  // exactly at mean
      const nc = computeNeurochemicals(inp);
      expect(nc.endorphins).toBeGreaterThan(0);
      expect(nc.endorphins).toBeCloseTo(0.5, 1);  // κ=κ*=64 → κ-prox=1
    });

    it('coupling below history mean → endo > 0 (was 0 pinned)', () => {
      const inp = baseInputs();
      inp.externalCoupling = 0.30;  // below mean 0.5
      const nc = computeNeurochemicals(inp);
      expect(nc.endorphins).toBeGreaterThan(0);
      expect(nc.endorphins).toBeLessThan(0.5);
    });

    it('coupling far above history mean → endo asymptotes toward 1', () => {
      const inp = baseInputs();
      inp.externalCoupling = 1.0;  // well above mean
      const nc = computeNeurochemicals(inp);
      expect(nc.endorphins).toBeGreaterThan(0.9);
      expect(nc.endorphins).toBeLessThan(1.0);
    });
  });
});
