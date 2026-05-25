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
    it('steady state, no reward → ser ≈ 0.85 (was 1.0 pinned)', () => {
      const inp = baseInputs();
      // No modeTransitionTimesMs supplied → falls to bv-z-score fallback
      // (which produces serBase = 1.0 when bv ≤ rolling mean). With
      // ×0.85 compression, ser = 0.85.
      inp.observables = {
        ...inp.observables!,
        basinVelocityHistory: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1],  // current bv == rolling mean
      };
      const nc = computeNeurochemicals(inp);
      expect(nc.serotonin).toBeCloseTo(0.85, 2);
    });

    it('steady state + 0.15 reward delta → ser reaches 1.0 (delta visible)', () => {
      const inp = baseInputs();
      inp.observables = {
        ...inp.observables!,
        basinVelocityHistory: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1],
      };
      inp.rewardSerotoninDelta = 0.15;
      const nc = computeNeurochemicals(inp);
      // 0.85 + 0.15 = 1.0 — reward delta now registers fully
      expect(nc.serotonin).toBeCloseTo(1.0, 2);
    });

    it('thrashing mode (high transition rate) + reward → ser still responds', () => {
      const inp = baseInputs();
      const now = 100_000;
      inp.observables = {
        ...inp.observables!,
        nowMs: now,
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
