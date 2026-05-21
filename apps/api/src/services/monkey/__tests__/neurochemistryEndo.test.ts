/**
 * neurochemistryEndo.test.ts — endorphin Sophia-gate onset.
 *
 * Production review (2026-05-21) found `endo` pinned at 0.00 on ~80%
 * of ticks: the smooth Sophia gate had its ONSET threshold at
 * `couplingMean + 1σ`, which coupling clears only ~16% of the time.
 *
 * Fix: onset lowered to `couplingMean`. The gate now opens whenever
 * coupling is above the basin's own baseline and ramps to full at
 * mean + 1σ. These tests pin that onset so it cannot silently drift
 * back to a >1σ-outlier gate.
 */

import { describe, expect, it } from 'vitest';

import { computeNeurochemicals, type NeurochemicalInputs } from '../neurochemistry.js';

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
      externalCouplingHistory: [0.10, 0.20, 0.30], // mean 0.20, σ 0.10
    },
  };
}

describe('neurochemistry — endorphin Sophia gate', () => {
  it('coupling above the basin mean → endo flows (the fixed bug)', () => {
    // coupling 0.25 sits above mean (0.20) but BELOW the old
    // mean+1σ (0.30) onset — under the old gate endo would be 0.00.
    const nc = computeNeurochemicals(inputs(0.25));
    expect(nc.endorphins).toBeGreaterThan(0);
    expect(nc.endorphins).toBeCloseTo(0.5, 5);  // (0.25-0.20)/0.10
  });

  it('coupling at/below the basin mean → endo stays 0', () => {
    expect(computeNeurochemicals(inputs(0.20)).endorphins).toBe(0);
    expect(computeNeurochemicals(inputs(0.15)).endorphins).toBe(0);
  });

  it('coupling at mean + 1σ → gate saturates → endo at κ-proximity max', () => {
    expect(computeNeurochemicals(inputs(0.30)).endorphins).toBeCloseTo(1.0, 5);
  });

  it('endo responds continuously to coupling between mean and mean+1σ', () => {
    const lo = computeNeurochemicals(inputs(0.22)).endorphins;
    const hi = computeNeurochemicals(inputs(0.26)).endorphins;
    expect(lo).toBeGreaterThan(0);
    expect(hi).toBeGreaterThan(lo);
    expect(hi).toBeLessThan(1);
  });
});
