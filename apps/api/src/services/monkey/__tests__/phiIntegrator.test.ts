/**
 * phiIntegrator.test.ts — canonical motion-integrated Φ (B3).
 *
 * Pins the leaky-integrator law that replaces the flatlined
 * `phi = 1 − 0.8·fHealth`. Φ rises with basin motion (bv), relaxes
 * toward EQUILIBRIUM when quiet, and converges to the canonical
 * steady state Φ_ss = EQUILIBRIUM + mean(bv)·GAIN/RATE.
 */

import { describe, expect, it } from 'vitest';

import {
  updateLeakyPhi,
  steadyStatePhi,
  PHI_EQUILIBRIUM,
  PHI_MAX,
  PHI_GAIN,
  PHI_RATE,
} from '../phi_integrator.js';

describe('phi_integrator — leaky-integrator Φ', () => {
  it('rises when the basin moves (bv > 0)', () => {
    expect(updateLeakyPhi(PHI_EQUILIBRIUM, 0.1)).toBeGreaterThan(PHI_EQUILIBRIUM);
  });

  it('relaxes toward EQUILIBRIUM when the basin is still (bv = 0)', () => {
    // Above equilibrium → decays down.
    expect(updateLeakyPhi(0.80, 0)).toBeLessThan(0.80);
    expect(updateLeakyPhi(0.80, 0)).toBeGreaterThan(PHI_EQUILIBRIUM);
    // Below equilibrium → drifts up.
    const up = updateLeakyPhi(0.20, 0);
    expect(up).toBeGreaterThan(0.20);
    expect(up).toBeLessThan(PHI_EQUILIBRIUM);
  });

  it('a quiet market converges to EQUILIBRIUM', () => {
    let phi = 0.213;  // the flatlined production value
    for (let i = 0; i < 2000; i++) phi = updateLeakyPhi(phi, 0);
    expect(phi).toBeCloseTo(PHI_EQUILIBRIUM, 4);
  });

  it('sustained motion converges to the canonical steady state', () => {
    const bv = 0.065;  // production mean basin velocity
    let phi = 0.213;
    for (let i = 0; i < 5000; i++) phi = updateLeakyPhi(phi, bv);
    expect(phi).toBeCloseTo(steadyStatePhi(bv), 4);
    expect(phi).toBeCloseTo(PHI_EQUILIBRIUM + (bv * PHI_GAIN) / PHI_RATE, 4);
  });

  it('steady state traverses the canonical bands as activity rises', () => {
    expect(steadyStatePhi(0)).toBeCloseTo(PHI_EQUILIBRIUM, 5);   // quiet → GRAPH floor
    expect(steadyStatePhi(0.057)).toBeGreaterThan(0.55);          // median → GRAPH
    expect(steadyStatePhi(0.133)).toBeGreaterThan(0.70);          // p90 → FORESIGHT
    expect(steadyStatePhi(0.206)).toBeGreaterThan(0.85);          // p99 → LIGHTNING
  });

  it('clamps to [0, PHI_MAX] — never pegs past the canonical ceiling', () => {
    expect(updateLeakyPhi(0.94, 100)).toBe(PHI_MAX);    // absurd motion → clamped
    expect(updateLeakyPhi(0.001, -100)).toBeGreaterThanOrEqual(0);  // negative bv guarded
    for (let i = 0; i < 100; i++) {
      const v = updateLeakyPhi(Math.random() * PHI_MAX, Math.random());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(PHI_MAX);
    }
  });

  it('is continuous — a small bv change moves Φ by a small amount', () => {
    const a = updateLeakyPhi(0.6, 0.05);
    const b = updateLeakyPhi(0.6, 0.06);
    expect(a).not.toBe(b);
    expect(Math.abs(a - b)).toBeLessThan(0.01);
  });
});
