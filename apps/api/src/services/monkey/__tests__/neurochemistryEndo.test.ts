/**
 * neurochemistryEndo.test.ts — endorphin Sophia-gate onset.
 *
 * Pins the observer-derived Sophia gate: it opens above the basin's own
 * coupling mean and ramps to full at mean + 1σ.
 */

import { describe, expect, it } from 'vitest';

import { computeNeurochemicals, type NeurochemicalInputs } from '../neurochemistry.js';

const COUPLING_MEAN = 0.20;
const COUPLING_SIGMA = 0.10;
const COUPLING_ABOVE_MEAN = 0.25;
const COUPLING_BELOW_MEAN = 0.15;
const COUPLING_AT_SATURATION = COUPLING_MEAN + COUPLING_SIGMA;
const COUPLING_LOW_RAMP = 0.22;
const COUPLING_HIGH_RAMP = 0.26;

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

describe('neurochemistry — endorphin Sophia gate', () => {
  it('coupling above the basin mean → endo flows (the fixed bug)', () => {
    expect(COUPLING_ABOVE_MEAN).toBeGreaterThan(COUPLING_MEAN);
    expect(COUPLING_ABOVE_MEAN).toBeLessThan(COUPLING_AT_SATURATION);
    const nc = computeNeurochemicals(inputs(COUPLING_ABOVE_MEAN));
    expect(nc.endorphins).toBeGreaterThan(0);
    expect(nc.endorphins).toBeCloseTo((COUPLING_ABOVE_MEAN - COUPLING_MEAN) / COUPLING_SIGMA, 5);
  });

  it('coupling at/below the basin mean → endo stays 0', () => {
    expect(computeNeurochemicals(inputs(COUPLING_MEAN)).endorphins).toBe(0);
    expect(computeNeurochemicals(inputs(COUPLING_BELOW_MEAN)).endorphins).toBe(0);
  });

  it('coupling at mean + 1σ → gate saturates → endo at κ-proximity max', () => {
    expect(computeNeurochemicals(inputs(COUPLING_AT_SATURATION)).endorphins).toBeCloseTo(1.0, 5);
  });

  it('endo responds continuously to coupling between mean and mean+1σ', () => {
    const lo = computeNeurochemicals(inputs(COUPLING_LOW_RAMP)).endorphins;
    const hi = computeNeurochemicals(inputs(COUPLING_HIGH_RAMP)).endorphins;
    expect(lo).toBeGreaterThan(0);
    expect(hi).toBeGreaterThan(lo);
    expect(hi).toBeLessThan(1);
  });
});
