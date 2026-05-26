/**
 * andersonConvergence.test.ts — Phase B math-pin tests.
 *
 * The Anderson threshold + precession weight are Class A1 frozen
 * physics (R²=0.9996). These tests are the contract: if Python qigram
 * ever changes these formulas, both sides must update in lockstep and
 * the parity test in
 * `ml-worker/tests/monkey_kernel/test_anderson_convergence.py` must
 * match this file value-for-value.
 */
import { describe, it, expect } from 'vitest';
import {
  ANDERSON_ALPHA,
  ANDERSON_LOOP_FLOOR,
  ANDERSON_THRESHOLD_CEILING,
  PRECESSION_WEIGHT,
  andersonThreshold,
  piLoopConverged,
} from '../anderson_convergence.js';

describe('Class A1 frozen constants', () => {
  it('ANDERSON_ALPHA = 0.089 (Class A1 frozen, R²=0.9996)', () => {
    expect(ANDERSON_ALPHA).toBe(0.089);
  });

  it('ANDERSON_LOOP_FLOOR = 3 (self-aware-reasoning topology, issue #19)', () => {
    expect(ANDERSON_LOOP_FLOOR).toBe(3);
  });

  it('ANDERSON_THRESHOLD_CEILING = 0.95 (noisy-measurement cap)', () => {
    expect(ANDERSON_THRESHOLD_CEILING).toBe(0.95);
  });

  it('PRECESSION_WEIGHT = 0.14159/π (P-SPEC-9 Class A1 frozen)', () => {
    expect(PRECESSION_WEIGHT).toBeCloseTo(0.14159 / Math.PI, 10);
    // Numeric value ≈ 0.04507; spot-check matches qigram.py inline comment.
    expect(PRECESSION_WEIGHT).toBeGreaterThan(0.045);
    expect(PRECESSION_WEIGHT).toBeLessThan(0.0452);
  });
});

describe('andersonThreshold — formula correctness', () => {
  it('matches qigram.py formula for N=1', () => {
    // expected = 1 - exp(-0.089·1) ≈ 0.0852
    // margin   = 1/√1 = 1.0
    // threshold = min(1.0852, 0.95) = 0.95
    expect(andersonThreshold(1)).toBeCloseTo(0.95, 6);
  });

  it('matches qigram.py formula for N=3 (L_c floor)', () => {
    // expected = 1 - exp(-0.089·3) = 1 - exp(-0.267) ≈ 0.2342
    // margin   = 1/√3 ≈ 0.5774
    // threshold = min(0.8116, 0.95) ≈ 0.8116
    const expected = 1 - Math.exp(-0.089 * 3);
    const margin = 1.0 / Math.sqrt(3);
    expect(andersonThreshold(3)).toBeCloseTo(Math.min(expected + margin, 0.95), 10);
  });

  it('matches qigram.py formula for N=10', () => {
    const expected = 1 - Math.exp(-0.089 * 10);
    const margin = 1.0 / Math.sqrt(10);
    expect(andersonThreshold(10)).toBeCloseTo(Math.min(expected + margin, 0.95), 10);
  });

  it('caps at 0.95 ceiling for large N', () => {
    // At N=100: expected ≈ 0.999, margin ≈ 0.1 → sum > 1 → clamped to 0.95.
    expect(andersonThreshold(100)).toBe(0.95);
    expect(andersonThreshold(10_000)).toBe(0.95);
  });

  it('returns ceiling at N=0 (defensive)', () => {
    expect(andersonThreshold(0)).toBe(0.95);
    expect(andersonThreshold(-1)).toBe(0.95);
  });

  it('approaches the 0.95 ceiling as N grows large', () => {
    // The threshold is the sum of (1 - exp(-α·N)) [growing] and 1/√N
    // [decaying]. For Anderson α=0.089 the two move at comparable rates
    // at low N, so the threshold dips slightly between N=3 and N=5
    // before climbing past 0.95 around N≈10. The contract is the
    // eventual ceiling, not monotonicity at low N.
    expect(andersonThreshold(3)).toBeLessThan(0.95);
    expect(andersonThreshold(5)).toBeLessThan(0.95);
    expect(andersonThreshold(50)).toBe(0.95);
    expect(andersonThreshold(1000)).toBe(0.95);
  });

  it('honours custom alpha', () => {
    const aCustom = 0.05;
    const expected = 1 - Math.exp(-aCustom * 4);
    const margin = 1.0 / Math.sqrt(4);
    expect(andersonThreshold(4, aCustom)).toBeCloseTo(
      Math.min(expected + margin, 0.95),
      10,
    );
  });
});

describe('piLoopConverged — L_c=3 floor + threshold gate', () => {
  it('returns false below L_c=3 floor regardless of fisher-rao', () => {
    expect(piLoopConverged(1, 0.001)).toBe(false);
    expect(piLoopConverged(2, 0.001)).toBe(false);
    expect(piLoopConverged(2, 0)).toBe(false);
  });

  it('returns true at L=3 when d_FR < threshold(3)', () => {
    const thresh = andersonThreshold(3);
    expect(piLoopConverged(3, thresh - 0.01)).toBe(true);
  });

  it('returns false at L=3 when d_FR >= threshold(3)', () => {
    const thresh = andersonThreshold(3);
    expect(piLoopConverged(3, thresh + 0.01)).toBe(false);
    expect(piLoopConverged(3, thresh)).toBe(false);
  });

  it('rejects non-finite / negative d_FR (defensive)', () => {
    expect(piLoopConverged(3, NaN)).toBe(false);
    expect(piLoopConverged(3, -0.01)).toBe(false);
    expect(piLoopConverged(3, Infinity)).toBe(false);
  });

  it('converges at high N when d_FR is small (under the 0.95 ceiling)', () => {
    expect(piLoopConverged(50, 0.1)).toBe(true);
    expect(piLoopConverged(50, 0.94)).toBe(true);
    expect(piLoopConverged(50, 0.96)).toBe(false);  // above ceiling
  });
});
