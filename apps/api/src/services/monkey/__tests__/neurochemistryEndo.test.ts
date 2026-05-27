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

describe('neurochemistry — endorphin κ-proximity canonical SIGMA (#934 fix)', () => {
  // 2026-05-26: pin canonical ENDORPHIN_KAPPA_SIGMA = 16.0 behaviour.
  // The prior implementation used stddev(kappaHistory) for σ in the
  // κ-proximity exp envelope, which collapsed to ~3e-11 in production
  // because the basin's rolling σ_κ (~0.09) is much smaller than |κ-κ*|
  // (~2.18). These tests pin the canonical scale.
  function inputsAtKappa(kappa: number): NeurochemicalInputs {
    return {
      isAwake: true,
      phiDelta: 0,
      basinVelocity: 0.1,
      surprise: 0,
      quantumWeight: 0.5,
      kappa,
      externalCoupling: COUPLING_MEAN,  // sophiaGate = sigmoid(0) = 0.5
      observables: {
        kappaHistory: [63.8, 64.0, 64.2],  // mean 64, σ ≈ 0.2 — would have collapsed exp envelope
        externalCouplingHistory: [
          COUPLING_MEAN - COUPLING_SIGMA,
          COUPLING_MEAN,
          COUPLING_MEAN + COUPLING_SIGMA,
        ],
      },
    };
  }

  it('|κ−κ*|=2.18 produces healthy endo signal under canonical SIGMA (~0.44 not 1e-11)', () => {
    // Production-typical κ-distance ≈ 2.18 (observed κ ≈ 66.18).
    // Pre-fix: exp(-2.18/0.2) ≈ 2e-5 (basin σ_κ from inputsAtKappa's kappaHistory)
    // Post-fix: exp(-2.18/16) ≈ 0.873 × sigmoid(0)=0.5 ≈ 0.44
    const endo = computeNeurochemicals(inputsAtKappa(66.18)).endorphins;
    expect(endo).toBeGreaterThan(0.30);
    expect(endo).toBeLessThan(0.50);
  });

  it('|κ−κ*|=0 (at κ*) produces endo = sophia_gate (κ-prox saturates at 1)', () => {
    // At κ=κ*, exp(0)=1, so endo = 1 × sigmoid(0) = 0.5
    const endo = computeNeurochemicals(inputsAtKappa(64.0)).endorphins;
    expect(endo).toBeCloseTo(0.5, 4);
  });

  it('|κ−κ*|=16 (one canonical SIGMA away) produces endo ≈ sophia_gate / e', () => {
    // exp(-16/16) = 1/e ≈ 0.368; with sophia_gate at 0.5 → endo ≈ 0.184
    const endo = computeNeurochemicals(inputsAtKappa(80.0)).endorphins;
    expect(endo).toBeGreaterThan(0.15);
    expect(endo).toBeLessThan(0.22);
  });

  it('|κ−κ*|=32 (2σ away) produces small but non-zero endo', () => {
    // exp(-32/16) = e^-2 ≈ 0.135; with sophia_gate at 0.5 → endo ≈ 0.068
    const endo = computeNeurochemicals(inputsAtKappa(96.0)).endorphins;
    expect(endo).toBeGreaterThan(0.05);
    expect(endo).toBeLessThan(0.10);
  });

  it('does NOT pin at floor across the basin\'s production κ range', () => {
    // Sample 10 kappa values spanning production observed range
    const samples = [65.5, 65.8, 66.0, 66.18, 66.3, 66.5, 67.0, 68.0, 70.0, 75.0];
    const endos = samples.map(k => computeNeurochemicals(inputsAtKappa(k)).endorphins);
    // Pre-fix: all values would be ~0.01 (rolling stddev collapse)
    // Post-fix: all values should be in [0.1, 0.5] (canonical scale)
    expect(Math.min(...endos)).toBeGreaterThan(0.05);
    // Monotonic decrease as |κ-κ*| increases
    for (let i = 1; i < endos.length; i++) {
      expect(endos[i]).toBeLessThanOrEqual(endos[i-1]! + 1e-9);
    }
  });
});
