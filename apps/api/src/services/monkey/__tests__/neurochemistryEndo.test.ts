/**
 * neurochemistryEndo.test.ts — endorphin Sophia-gate semantics.
 *
 * 2026-05-25 — gate updated to sigmoid-around-mean per the
 * steady-state-pinning fix (see
 * [[feedback_steady_state_pinning_pattern]]). The previous
 * `clip((coupling - mean)/σ, 0, 1)` zeroed endo whenever coupling was
 * at or below the basin's own rolling mean — ~50% of state-space by
 * construction. `externalCoupling = phi × (1 - bv)` is a continuous
 * magnitude (audit 2026-05-25), so the right shape is sigmoid: 0.5 at
 * mean, asymptotes 0 (well below) and 1 (well above).
 */

import { describe, expect, it } from 'vitest';

import { computeNeurochemicals, type NeurochemicalInputs } from '../neurochemistry.js';

const COUPLING_MEAN = 0.20;
const COUPLING_SIGMA = 0.10;
const COUPLING_ABOVE_MEAN = 0.25;
const COUPLING_BELOW_MEAN = 0.15;
const COUPLING_HIGH = COUPLING_MEAN + 3 * COUPLING_SIGMA;  // ≈ saturated
const COUPLING_LOW_RAMP = 0.22;
const COUPLING_HIGH_RAMP = 0.26;

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * κ history with mean 64 (= κ*) and σ_κ = 0.2, and a coupling history
 * with mean 0.20 and σ = 0.10. With κ pinned exactly at κ* the
 * κ-proximity term is exp(0) = 1, so `endo` equals the Sophia gate —
 * which makes the gate onset directly assertable.
 */
function inputs(externalCoupling: number): NeurochemicalInputs {
  return {
    isAwake: true,
    phiDelta: 0,
    basinVelocity: 0.1,
    surprise: 0,
    quantumWeight: 0.5,
    kappa: 64,
    externalCoupling,
    observables: {
      kappaHistory: [63.8, 64.0, 64.2],          // mean 64, σ_κ 0.2
      externalCouplingHistory: [
        COUPLING_MEAN - COUPLING_SIGMA,
        COUPLING_MEAN,
        COUPLING_MEAN + COUPLING_SIGMA,
      ],
    },
  };
}

describe('neurochemistry — endorphin Sophia gate (post-strip)', () => {
  it('coupling above the basin mean → endo flows (κ-prox × sigmoid)', () => {
    const nc = computeNeurochemicals(inputs(COUPLING_ABOVE_MEAN));
    const z = (COUPLING_ABOVE_MEAN - COUPLING_MEAN) / COUPLING_SIGMA;
    // κ=64=κ*, so κ-prox = 1; endo = 1 × sigmoid(z)
    expect(nc.endorphins).toBeCloseTo(sigmoid(z), 5);
  });

  it('coupling AT the basin mean → endo flows at 0.5 (not 0 anymore)', () => {
    // Pre-strip pinned this case to 0; post-strip the sigmoid produces
    // 0.5 — the kernel always gets some peak-state reinforcement when
    // κ is near κ*, scaled by recent coherence.
    expect(computeNeurochemicals(inputs(COUPLING_MEAN)).endorphins).toBeCloseTo(0.5, 5);
  });

  it('coupling below the basin mean → endo non-zero (not pinned at 0)', () => {
    const nc = computeNeurochemicals(inputs(COUPLING_BELOW_MEAN));
    expect(nc.endorphins).toBeGreaterThan(0);
    expect(nc.endorphins).toBeLessThan(0.5);  // below-mean side of sigmoid
  });

  it('coupling far above mean → asymptotes toward 1 via sigmoid', () => {
    // mean + 3σ → sigmoid(3) ≈ 0.953
    const nc = computeNeurochemicals(inputs(COUPLING_HIGH));
    expect(nc.endorphins).toBeGreaterThan(0.9);
    expect(nc.endorphins).toBeLessThan(1.0);
  });

  it('endo responds continuously to coupling around the mean', () => {
    const lo = computeNeurochemicals(inputs(COUPLING_LOW_RAMP)).endorphins;
    const hi = computeNeurochemicals(inputs(COUPLING_HIGH_RAMP)).endorphins;
    expect(lo).toBeGreaterThan(0);
    expect(hi).toBeGreaterThan(lo);
    expect(hi).toBeLessThan(1);
  });
});
