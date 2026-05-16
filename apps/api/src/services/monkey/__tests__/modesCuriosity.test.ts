/**
 * modesCuriosity.test.ts — regression for issue #718.
 *
 * Pre-fix, modes.ts::computeMotivators computed curiosity as
 * `phiH[phiH.length - 1] - phiH[phiH.length - 2]`. That's the delta
 * between the PRIOR two ticks, not the current tick. In loop.ts
 * `state.phiHistory.push(phi)` runs AFTER detectMode, so phiH[-1]
 * is last tick's phi, NOT this tick's. On quiet tape the
 * prior-two-ticks delta stuck at 0.0000, pinning curiosity to zero
 * and prematurely tripping the DRIFT mode gate (curiosity < 0.005).
 *
 * The fix uses the current tick's `inp.phi` against the most recent
 * stored history value. These tests exercise the new contract.
 */
import { describe, it, expect } from 'vitest';
import {
  BASIN_DIM, uniformBasin, type Basin,
} from '../basin.js';
import { computeMotivators, detectMode, MonkeyMode } from '../modes.js';
import type { NeurochemicalState } from '../neurochemistry.js';

const NC: NeurochemicalState = {
  acetylcholine: 0.8,
  dopamine: 0.5,
  serotonin: 1.0,
  norepinephrine: 0.05,
  gaba: 0.5,
  endorphins: 0.5,
};

const UNIFORM: Basin = uniformBasin(BASIN_DIM);

describe('computeMotivators — curiosity uses current tick phi (#718)', () => {
  it('curiosity = phi - phiHistory[-1] when at least one prior tick', () => {
    const mot = computeMotivators({
      basin: UNIFORM,
      identityBasin: UNIFORM,
      phi: 0.250,
      kappa: 64,
      basinVelocity: 0.01,
      neurochemistry: NC,
      phiHistory: [0.230, 0.240],
      fHealthHistory: [0.95, 0.95, 0.95],
      driftHistory: [0.10, 0.10],
    });
    expect(mot.curiosity).toBeCloseTo(0.010, 6);
  });

  it('negative when phi falls', () => {
    const mot = computeMotivators({
      basin: UNIFORM,
      identityBasin: UNIFORM,
      phi: 0.310,
      kappa: 64,
      basinVelocity: 0.01,
      neurochemistry: NC,
      phiHistory: [0.315],
      fHealthHistory: [0.95],
      driftHistory: [0.10],
    });
    expect(mot.curiosity).toBeCloseTo(-0.005, 6);
  });

  it('empty phiHistory yields 0', () => {
    const mot = computeMotivators({
      basin: UNIFORM,
      identityBasin: UNIFORM,
      phi: 0.250,
      kappa: 64,
      basinVelocity: 0.01,
      neurochemistry: NC,
      phiHistory: [],
      fHealthHistory: [],
      driftHistory: [],
    });
    expect(mot.curiosity).toBe(0);
  });

  it('single-element phiHistory still works (post-fix only needs 1 prior)', () => {
    // Pre-fix: phiH.length >= 2 was required for non-zero curiosity.
    // Post-fix: one prior tick is enough because we compare against
    // `inp.phi` directly.
    const mot = computeMotivators({
      basin: UNIFORM,
      identityBasin: UNIFORM,
      phi: 0.250,
      kappa: 64,
      basinVelocity: 0.01,
      neurochemistry: NC,
      phiHistory: [0.240],
      fHealthHistory: [0.95],
      driftHistory: [0.10],
    });
    expect(mot.curiosity).toBeCloseTo(0.010, 6);
  });
});

describe('computeMotivators — regression: tick.py ordering scenario', () => {
  it('lively tape (post-fix) yields above drift-gate', () => {
    // Active tape: phi just jumped 0.245 → 0.260 (one big tick).
    // Pre-fix would have computed phiH[-1] - phiH[-2] = 0.0
    // (since both prior ticks were 0.245). Post-fix correctly
    // surfaces the 0.015 jump.
    const mot = computeMotivators({
      basin: UNIFORM,
      identityBasin: UNIFORM,
      phi: 0.260,
      kappa: 64,
      basinVelocity: 0.01,
      neurochemistry: NC,
      phiHistory: [0.245, 0.245],
      fHealthHistory: [0.95, 0.95, 0.95],
      driftHistory: [0.10, 0.10],
    });
    expect(mot.curiosity).toBeCloseTo(0.015, 6);
    expect(Math.abs(mot.curiosity)).toBeGreaterThanOrEqual(0.005);
  });
});

describe('detectMode — drift gate respects current-tick curiosity (#718)', () => {
  it('does NOT fire DRIFT when phi is actively changing this tick', () => {
    // Prior phi reads were 0.30, 0.30, 0.30 (apparent quiet).
    // Current tick phi just jumped to 0.32. Pre-fix this still
    // tripped DRIFT (curiosity computed as 0 - 0 = 0); post-fix
    // it correctly reads 0.02, well above the 0.005 gate.
    const result = detectMode({
      basin: UNIFORM,
      identityBasin: UNIFORM,
      phi: 0.32,
      kappa: 64,
      basinVelocity: 0.010,
      neurochemistry: NC,
      phiHistory: [0.30, 0.30, 0.30],
      fHealthHistory: [0.98, 0.98, 0.98],
      driftHistory: [0.10, 0.10, 0.10],
    });
    expect(result.value).not.toBe(MonkeyMode.DRIFT);
  });

  it('still fires DRIFT when current phi truly matches prior', () => {
    // Sanity check: the fix must not suppress LEGITIMATE drift.
    const result = detectMode({
      basin: UNIFORM,
      identityBasin: UNIFORM,
      phi: 0.30,  // exactly matches phiHistory[-1]
      kappa: 64,
      basinVelocity: 0.010,
      neurochemistry: NC,
      phiHistory: [0.30, 0.30, 0.30],
      fHealthHistory: [0.98, 0.98, 0.98],
      driftHistory: [0.10, 0.10, 0.10],
    });
    expect(result.value).toBe(MonkeyMode.DRIFT);
  });
});
