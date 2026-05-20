/**
 * Tests for renyiTupleDistance — the Rényi-½ divergence used for
 * Agent L's inverse-distance vote weight (Improvement C, QIG-FR v4).
 *
 * Per scale: −log(BC), BC = cos(d_FR). Unbounded [0, ∞), monotone in
 * the Fisher-Rao distance — so it preserves neighbour ORDER while
 * decaying far neighbours' vote weight far more sharply than the
 * bounded FR distance does.
 */

import { describe, it, expect } from 'vitest';
import {
  renyiTupleDistance,
  fisherRaoTupleDistance,
  type BasinTuple,
} from '../services/monkey/agent_L_classifier.js';
import { toSimplex, type Basin } from '../services/monkey/basin.js';

function basin(...v: number[]): Basin {
  return toSimplex(v);
}
function tuple(c: Basin, m: Basin, l: Basin): BasinTuple {
  return { current: c, medium: m, long: l };
}

describe('renyiTupleDistance', () => {
  it('is 0 between identical tuples (BC=1, −log(1)=0)', () => {
    const t = tuple(
      basin(0.4, 0.3, 0.2, 0.1),
      basin(0.25, 0.25, 0.25, 0.25),
      basin(0.7, 0.1, 0.1, 0.1),
    );
    expect(renyiTupleDistance(t, t)).toBeCloseTo(0, 9);
  });

  it('is strictly positive between distinct tuples', () => {
    const a = tuple(
      basin(0.7, 0.1, 0.1, 0.1),
      basin(0.7, 0.1, 0.1, 0.1),
      basin(0.7, 0.1, 0.1, 0.1),
    );
    const b = tuple(
      basin(0.1, 0.1, 0.1, 0.7),
      basin(0.1, 0.1, 0.1, 0.7),
      basin(0.1, 0.1, 0.1, 0.7),
    );
    expect(renyiTupleDistance(a, b)).toBeGreaterThan(0);
  });

  it('is monotone with Fisher-Rao distance — preserves neighbour order', () => {
    const ref = tuple(
      basin(0.7, 0.1, 0.1, 0.1),
      basin(0.7, 0.1, 0.1, 0.1),
      basin(0.7, 0.1, 0.1, 0.1),
    );
    const near = tuple(
      basin(0.6, 0.2, 0.1, 0.1),
      basin(0.6, 0.2, 0.1, 0.1),
      basin(0.6, 0.2, 0.1, 0.1),
    );
    const far = tuple(
      basin(0.1, 0.1, 0.1, 0.7),
      basin(0.1, 0.1, 0.1, 0.7),
      basin(0.1, 0.1, 0.1, 0.7),
    );
    const frNear = fisherRaoTupleDistance(ref, near);
    const frFar = fisherRaoTupleDistance(ref, far);
    const reNear = renyiTupleDistance(ref, near);
    const reFar = renyiTupleDistance(ref, far);
    // FR says near < far; Rényi must agree (monotone transform).
    expect(frNear).toBeLessThan(frFar);
    expect(reNear).toBeLessThan(reFar);
  });

  it('decays far neighbours harder than Fisher-Rao (unbounded vs π/2)', () => {
    // Near-orthogonal tuples: FR saturates ≈ π/2 per scale (~1.57),
    // Rényi keeps climbing — so the Rényi distance exceeds the FR one
    // for a far pair, which is what sharpens the inverse-distance vote.
    const a = tuple(
      basin(0.97, 0.01, 0.01, 0.01),
      basin(0.97, 0.01, 0.01, 0.01),
      basin(0.97, 0.01, 0.01, 0.01),
    );
    const b = tuple(
      basin(0.01, 0.01, 0.01, 0.97),
      basin(0.01, 0.01, 0.01, 0.97),
      basin(0.01, 0.01, 0.01, 0.97),
    );
    expect(renyiTupleDistance(a, b)).toBeGreaterThan(fisherRaoTupleDistance(a, b));
  });
});
